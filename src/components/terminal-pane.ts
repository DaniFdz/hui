/**
 * A panel showing one of a session's shared terminals, drawn with ghostty-web. The PTY lives in the gateway: this
 * element replays its snapshot, streams output and input over the terminal socket, reconnects with backoff and resizes
 * the PTY to fit. Hiding the panel leaves the terminal running; only "End terminal" stops it.
 */
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Terminal, FitAddon } from "ghostty-web";
import { DEFAULT_TERMINAL_FONT, loadTerminalFont, terminalFontStack } from "../lib/terminal-font.ts";
import { HuiElement } from "../lit/hui-element.ts";
import { icons } from "../lib/icons.ts";
import { connectTerminal, createTerminal, endTerminal, listTerminals } from "../lib/terminals-store.ts";
import type { TerminalEvent, TerminalInput, TerminalView } from "../lib/terminal-types.ts";
import type { SplitDirection } from "../lib/session-multiplexer.ts";
import { toggleNavigationDrawer } from "../views/shell.ts";
import { renderPaneMoveHandle } from "../views/pane-move-handle.ts";
import { renderPicker } from "../views/settings-picker.ts";
import { terminalPickerOptions } from "../lib/terminal-picker-options.ts";
import { writeTerminal } from "../lib/terminal-write.ts";

let initialize: Promise<typeof import("ghostty-web")> | undefined;
function loadTerminal() {
  initialize ??= import("ghostty-web").catch((error: unknown) => { initialize = undefined; throw error; });
  return initialize;
}

@customElement("hui-terminal-pane")
export class TerminalPane extends HuiElement {
  @property() fontFamily = DEFAULT_TERMINAL_FONT;
  @property() ownerSessionId = "";
  @property() terminalId = "";
  @property({ type: Boolean }) visible = true;
  @property({ type: Boolean }) active = true;
  @property({ type: Boolean }) mobileNav = false;
  @property({ type: Boolean }) movable = false;
  @property({ attribute: false }) onClosePane: (() => void) | undefined;
  @property({ attribute: false }) onSelectTerminal!: (id: string) => void;
  @property({ attribute: false }) onSplitTerminal!: (direction: SplitDirection) => Promise<void>;
  @state() private entries: TerminalView[] = [];
  @state() private terminalView: TerminalView | undefined;
  @state() private status = "Connecting…";
  @state() private error = "";
  @state() private truncated = false;
  @state() private busy = false;
  private terminal: Terminal | undefined;
  private fit: FitAddon | undefined;
  private socket: WebSocket | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private generation = 0;
  private replaying = false;
  private ready = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  override updated(changed: PropertyValues) {
    if (changed.has("terminalId") || changed.has("ownerSessionId")) void this.start();
    else if (changed.has("visible") && this.visible) this.fitTerminal();
    if (changed.has("fontFamily")) void this.applyFont();
  }

  override disconnectedCallback() { this.cleanup(); super.disconnectedCallback(); }

  private cleanup() {
    ++this.generation;
    clearTimeout(this.retry);
    this.ready = false;
    if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = undefined; }
    this.resizeObserver?.disconnect();
    this.terminal?.dispose();
    this.terminal = undefined;
    this.fit = undefined;
  }

  private async applyFont() {
    const terminal = this.terminal;
    const font = terminalFontStack(this.fontFamily);
    if (!terminal) return;
    await loadTerminalFont(this.fontFamily);
    if (this.terminal !== terminal || font !== terminalFontStack(this.fontFamily)) return;
    terminal.options.fontFamily = font;
    this.fitTerminal();
  }

  private async refreshList() { this.entries = await listTerminals(this.ownerSessionId); }

  private fitTerminal = () => {
    if (!this.visible || !this.ready || !this.fit || !this.terminal) return;
    const size = this.fit.proposeDimensions();
    if (size && size.cols >= 2 && size.rows >= 1) this.terminal.resize(Math.min(500, size.cols), Math.min(300, size.rows));
  };

  private send(input: TerminalInput) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN || this.terminalView?.status !== "running" || this.replaying) return;
    this.socket.send(JSON.stringify(input));
  }

  private async start() {
    this.cleanup();
    const generation = this.generation;
    this.status = "Connecting…";
    this.error = "";
    this.terminalView = undefined;
    try {
      const module = await loadTerminal();
      // Ghostty 0.4.0 can expose stale cells when free/new reuse one WASM heap.
      // Give each view its own heap; never share screen memory across PTYs.
      const [ghostty] = await Promise.all([module.Ghostty.load(), loadTerminalFont(this.fontFamily)]);
      if (generation !== this.generation || !this.isConnected) return;
      const surface = this.querySelector<HTMLElement>(".hui-terminal-surface")!;
      const colors = getComputedStyle(this);
      const terminal = new module.Terminal({ ghostty, fontSize: 13, fontFamily: terminalFontStack(this.fontFamily), cursorBlink: true, scrollback: 5000, theme: { background: colors.backgroundColor, foreground: colors.color } });
      this.terminal = terminal;
      this.fit = new module.FitAddon();
      terminal.loadAddon(this.fit);
      // Ghostty 0.4 open() calls its public focus(), which also schedules a
      // second focus. It has no focus-on-open option. Suppress that one call
      // for background panes so neither event changes the active pane/route;
      // restoring body focus afterward is too late and fails on reload.
      const focus = terminal.focus;
      if (!this.active) terminal.focus = () => {};
      try { terminal.open(surface); }
      finally { terminal.focus = focus; }
      void this.applyFont();
      terminal.textarea?.setAttribute("aria-label", "Shared terminal input");
      terminal.onData((data) => {
        // Paste is chunked on Unicode boundaries; a large paste never exceeds
        // the server's per-message limit or splits a surrogate pair.
        let chunk = "";
        for (const character of data) {
          chunk += character;
          if (chunk.length >= 4000) { this.send({ action: "input", data: chunk }); chunk = ""; }
        }
        if (chunk) this.send({ action: "input", data: chunk });
      });
      terminal.onResize(({ cols, rows }) => this.send({ action: "resize", cols, rows }));
      this.resizeObserver = new ResizeObserver(this.fitTerminal);
      this.resizeObserver.observe(surface);
      await this.refreshList();
      if (generation !== this.generation) return;
      await this.connect(generation);
    } catch (error) {
      if (generation === this.generation) { this.error = error instanceof Error ? error.message : "Terminal unavailable."; this.status = "Disconnected"; }
    }
  }

  private async connect(generation: number) {
    const socket = await connectTerminal(this.ownerSessionId, this.terminalId);
    if (generation !== this.generation || !this.isConnected) { socket.close(); return; }
    this.socket = socket;
    socket.onmessage = (message) => {
      if (generation !== this.generation || !this.terminal) return;
      const event = JSON.parse(String(message.data)) as TerminalEvent;
      if (event.type === "snapshot") {
        this.retries = 0;
        this.replaying = true;
        // RIS resets the existing parser without freeing the handle still
        // referenced by Ghostty's selection manager. Also retire scrollback.
        this.terminal.write("\u001bc\u001b[3J\u001b[2J\u001b[H");
        this.terminal.resize(event.terminal.cols, event.terminal.rows);
        this.terminalView = event.terminal;
        this.truncated = event.truncated;
        writeTerminal(this.terminal, event.data, () => {
          if (generation !== this.generation) return;
          this.replaying = false;
          this.ready = true;
          this.fitTerminal();
        });
        this.status = event.terminal.status === "running" ? "Connected" : "Exited";
        this.error = "";
      } else if (event.type === "data") writeTerminal(this.terminal, event.data);
      else if (event.type === "state") {
        this.terminalView = event.terminal;
        this.status = event.terminal.status === "running" ? "Connected" : "Exited";
        this.replaying = true;
        this.terminal.resize(event.terminal.cols, event.terminal.rows);
        this.replaying = false;
      } else this.error = event.error;
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      this.ready = false;
      this.status = "Disconnected";
      if (++this.retries <= 5) {
        this.status = "Reconnecting…";
        this.retry = setTimeout(() => { void this.connect(generation).catch((error: unknown) => {
          if (generation !== this.generation) return;
          this.status = "Disconnected";
          this.error = error instanceof Error ? error.message : "Reconnect failed.";
        }); }, Math.min(1000 * 2 ** (this.retries - 1), 10_000));
      }
    };
    socket.onerror = () => {
      if (generation === this.generation) this.error = "Terminal connection lost. Input is disabled until reconnected.";
    };
  }

  private run = async (operation: () => Promise<void>) => {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try { await operation(); } catch (error) { this.error = error instanceof Error ? error.message : "Terminal operation failed."; }
    finally { this.busy = false; }
  };

  override render() {
    return html`<header class="chat-pane__header hui-terminal-header" tabindex="-1" draggable=${this.movable ? "true" : "false"}>
      <div class="hui-terminal-title">
        ${renderPaneMoveHandle(this.movable)}
        ${this.mobileNav ? html`<button class="btn btn--ghost btn--icon" aria-label="Open navigation" @click=${toggleNavigationDrawer}>${icons.menu}</button>` : nothing}
        <span aria-hidden="true">${icons.squareTerminal}</span>
        ${renderPicker({
          label: "Terminal",
          value: this.terminalId,
          options: terminalPickerOptions(this.entries, this.terminalId),
          className: "hui-terminal-picker",
          showOptionTooltips: false,
          onOpen: () => void this.refreshList().catch(() => {}),
          onChange: (id) => { if (id !== this.terminalId) this.onSelectTerminal(id); },
        })}
      </div>
      <div class="hui-terminal-actions">
        <button class="btn btn--ghost btn--icon" title="New terminal" aria-label="New terminal" ?disabled=${this.busy} @click=${() => this.run(async () => { const terminal = await createTerminal(this.ownerSessionId); this.onSelectTerminal(terminal.id); })}>${icons.plus}</button>
        <wa-dropdown placement="bottom-end" @wa-select=${(event: CustomEvent<{ item: HTMLElement }>) => {
          const action = event.detail.item.getAttribute("value");
          queueMicrotask(() => {
            if (action === "down" || action === "right") void this.run(() => this.onSplitTerminal(action));
            if (action === "end") void this.run(async () => {
              await endTerminal(this.ownerSessionId, this.terminalId);
              await this.refreshList();
              const next = this.entries[0];
              if (next) this.onSelectTerminal(next.id); else { this.cleanup(); this.status = "Ended"; this.onClosePane?.(); }
            });
          });
        }}>
          <button slot="trigger" class="btn btn--ghost btn--icon" aria-label="Terminal actions" title="Terminal actions" ?disabled=${this.busy}>${icons.moreHorizontal}</button>
          <wa-dropdown-item value="right">Split terminal right</wa-dropdown-item>
          <wa-dropdown-item value="down">Split terminal down</wa-dropdown-item>
          <wa-dropdown-item value="end">End terminal</wa-dropdown-item>
        </wa-dropdown>
        ${this.onClosePane ? html`<button class="btn btn--ghost btn--icon" title="Hide terminal panel (keep running)" aria-label="Hide terminal panel" @click=${this.onClosePane}>${icons.close}</button>` : nothing}
      </div>
    </header>
    <div class="hui-terminal-meta"><span title=${this.terminalView?.cwd ?? ""}>${this.terminalView?.cwd ?? "Terminal"}</span><span role="status" title="Shared with the agent in this conversation">Shared · ${this.status}${this.terminalView?.exitCode !== undefined ? ` · ${this.terminalView.exitCode}` : ""}</span></div>
    ${this.error ? html`<div class="hui-terminal-error" role="alert">${this.error}</div>` : nothing}
    ${this.status === "Disconnected" ? html`<button class="btn" @click=${() => { this.retries = 0; void this.start(); }}>Reconnect terminal</button>` : nothing}
    ${this.truncated ? html`<div class="hui-terminal-notice">Older output was trimmed from the replay.</div>` : nothing}
    <div class="hui-terminal-surface" @keydown=${(event: KeyboardEvent) => event.stopPropagation()}></div>
    <div class="hui-terminal-keys" aria-label="Terminal keys">
      ${[["Esc", "\u001b"], ["Tab", "\t"], ["Ctrl+C", "\u0003"], ["Enter", "\r"]].map(([label, data]) => html`<button class="btn btn--ghost btn--sm" ?disabled=${this.status !== "Connected"} @click=${() => { this.send({ action: "input", data: data! }); this.terminal?.focus(); }}>${label}</button>`)}
    </div>`;
  }
}
