/**
 * <hui-vscode-view>: the Work pane's VS Code view, a frame of the gateway's openvscode-server opened on the
 * conversation's folder. It starts VS Code the first time it is shown, says why when it cannot (off in Settings, no
 * executable, a remote conversation), shows a crash with Retry, reloads, and opens the same folder in a new tab
 * through a fresh one-use ticket. It stays mounted while hidden so the editor keeps its state.
 */
import { LitElement, html, nothing, svg, type PropertyValues } from "lit";
import { icons } from "../lib/icons.ts";
import { writeClipboardText } from "../lib/clipboard.ts";
import { connectVscode, loadVscodeStatus, onVscodeStatus, readVscodeTheme, VscodeConnectError } from "../lib/vscode-store.ts";
import { vscodeUnavailableReason, type VscodeConnection, type VscodeStatus } from "../../shared/vscode.ts";
import { loadViewAssets } from "../lib/view-assets.ts";

loadViewAssets(() => import("../styles/vscode-view.css"));

/** VS Code's mark is not an OpenClaw icon, so it lives here, in the shared stroke shell (lucide "code"). */
export const vscodeIcon = html`<svg class="hui-vscode-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg`<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>`}</svg>`;

/** While shown and open, how often the view checks that its server is still the one it loaded. */
const WATCH_MS = 10_000;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string; settings: boolean }
  | { kind: "error"; title: string; message: string };

export class HuiVscodeView extends LitElement {
  static override properties = {
    sessionId: {},
    visible: { type: Boolean },
    narrow: { type: Boolean },
  };
  declare sessionId: string;
  declare visible: boolean;
  declare narrow: boolean;
  #phase: Phase = { kind: "idle" };
  #connection: VscodeConnection | undefined;
  #request = 0;
  #watch: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;
  #copied = false;

  constructor() {
    super();
    this.sessionId = "";
    this.visible = false;
    this.narrow = false;
  }

  override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe = onVscodeStatus((status) => this.#follow(status));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#request++;
    this.#stopWatching();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("sessionId") && changed.get("sessionId") !== undefined) {
      this.#request++;
      this.#connection = undefined;
      this.#phase = { kind: "idle" };
    }
    if (this.visible && this.sessionId && this.#phase.kind === "idle") void this.#open();
  }

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has("visible")) {
      if (this.visible && this.#phase.kind === "ready") this.#scheduleWatch();
      if (!this.visible) this.#stopWatching();
    }
  }

  #set(phase: Phase) {
    this.#phase = phase;
    if (phase.kind === "ready" && this.visible) this.#scheduleWatch();
    if (phase.kind !== "ready") this.#stopWatching();
    this.requestUpdate();
  }

  /** Asks the gateway for a frame URL, starting VS Code if it is not running. */
  async #open() {
    const request = ++this.#request;
    this.#set({ kind: "starting" });
    try {
      const status = await loadVscodeStatus();
      if (request !== this.#request) return;
      const reason = vscodeUnavailableReason(status);
      if (reason) { this.#connection = undefined; this.#set({ kind: "unavailable", reason, settings: true }); return; }
      const connection = await connectVscode(this.sessionId, readVscodeTheme());
      if (request !== this.#request) return;
      this.#connection = connection;
      this.requestUpdate();
    } catch (error) {
      if (request !== this.#request) return;
      this.#connection = undefined;
      if (error instanceof VscodeConnectError && error.code !== "failed" && error.code !== "busy") {
        this.#set({ kind: "unavailable", reason: error.message, settings: error.code === "disabled" || error.code === "not-found" });
      } else {
        this.#set({ kind: "error", title: "VS Code could not open", message: error instanceof Error ? error.message : "VS Code could not open." });
      }
    }
  }

  /** The frame finished loading: VS Code's workbench, or one of the proxy's own refusal pages. */
  #loaded(event: Event) {
    const frame = event.currentTarget as HTMLIFrameElement;
    if (!this.#connection || frame.dataset["url"] !== this.#connection.url) return;
    let refusal: Element | null | undefined;
    try { refusal = frame.contentDocument?.querySelector('meta[name="hui-vscode-error"]'); } catch { refusal = undefined; }
    if (refusal) {
      this.#set({ kind: "error", title: "VS Code could not open", message: refusal.getAttribute("data-message") || "The gateway refused the VS Code frame." });
      return;
    }
    this.#set({ kind: "ready" });
  }

  /** A status from anywhere (Settings in this tab, this view's own watch) can end or revive the frame. */
  #follow(status: VscodeStatus) {
    const reason = vscodeUnavailableReason(status);
    if (reason && (this.#connection || this.#phase.kind === "ready")) {
      this.#request++;
      this.#connection = undefined;
      this.#set({ kind: "unavailable", reason, settings: true });
      return;
    }
    if (!reason && this.#phase.kind === "unavailable" && this.#phase.settings) {
      this.#phase = { kind: "idle" };
      if (this.visible) void this.#open();
      else this.requestUpdate();
      return;
    }
    const connection = this.#connection;
    if (connection && this.#phase.kind === "ready" && (status.state !== "running" || status.instance !== connection.instance)) {
      this.#set({
        kind: "error",
        title: status.state === "failed" ? "VS Code stopped unexpectedly" : "VS Code stopped",
        message: status.state === "failed" && status.lastError ? status.lastError : "Its server is no longer running. Retry starts it again; unsaved changes VS Code backed up come back.",
      });
    }
  }

  #scheduleWatch() {
    this.#stopWatching();
    this.#watch = setTimeout(() => {
      this.#watch = undefined;
      void loadVscodeStatus().catch(() => undefined).finally(() => { if (this.visible && this.#phase.kind === "ready") this.#scheduleWatch(); });
    }, WATCH_MS);
  }

  #stopWatching() {
    if (this.#watch) clearTimeout(this.#watch);
    this.#watch = undefined;
  }

  /** The same folder in a browser tab, through its own ticket. The tab opens inside the click so no popup blocker
   * stops it, and loses its opener before it navigates. */
  async #openTab() {
    const tab = window.open("about:blank", "_blank");
    try {
      const connection = await connectVscode(this.sessionId, readVscodeTheme());
      if (!tab) { window.location.assign(connection.url); return; }
      tab.opener = null;
      tab.location.href = connection.url;
    } catch (error) {
      tab?.close();
      this.#set({ kind: "error", title: "VS Code could not open in a new tab", message: error instanceof Error ? error.message : "VS Code could not open." });
    }
  }

  async #copyPath() {
    const folder = this.#connection?.folder;
    if (!folder) return;
    this.#copied = await writeClipboardText(folder);
    this.requestUpdate();
    setTimeout(() => { this.#copied = false; this.requestUpdate(); }, 1_500);
  }

  #openSettings(event: MouseEvent) {
    const request = new CustomEvent("hui-open-settings", { bubbles: true, composed: true, cancelable: true, detail: { page: "tools", section: "vscode" } });
    // The app navigates in place; without one (a standalone page) the link loads Settings itself.
    if (!this.dispatchEvent(request)) event.preventDefault();
  }

  #renderOverlay() {
    const phase = this.#phase;
    if (phase.kind === "ready" || phase.kind === "idle") return nothing;
    if (phase.kind === "starting") {
      return html`<div class="hui-vscode-view__overlay" role="status" aria-live="polite">
        <div class="hui-vscode-view__card">
          <span class="hui-vscode-view__spinner" aria-hidden="true"></span>
          <div class="hui-vscode-view__copy">
            <strong>Starting VS Code</strong>
            ${this.#connection ? html`<span>Opening ${this.#connection.label}</span>` : nothing}
          </div>
        </div>
      </div>`;
    }
    if (phase.kind === "unavailable") {
      return html`<div class="hui-vscode-view__overlay hui-vscode-view__overlay--solid">
        <div class="hui-vscode-view__card hui-vscode-view__card--stacked" data-vscode-unavailable>
          <div class="hui-vscode-view__card-head">${vscodeIcon}<strong>VS Code is not available</strong></div>
          <p class="hui-vscode-view__message">${phase.reason}</p>
          ${phase.settings ? html`<a class="btn btn--sm" href="/settings/tools" @click=${(event: MouseEvent) => this.#openSettings(event)}>
            ${icons.settings}<span>Open Settings → Tools → VS Code</span></a>` : nothing}
        </div>
      </div>`;
    }
    return html`<div class="hui-vscode-view__overlay hui-vscode-view__overlay--solid">
      <div class="hui-vscode-view__card hui-vscode-view__card--stacked" role="alert" data-vscode-error>
        <div class="hui-vscode-view__card-head">${icons.alertTriangle}<strong>${phase.title}</strong></div>
        <p class="hui-vscode-view__message">${phase.message}</p>
        <button type="button" class="btn btn--sm" @click=${() => void this.#open()}>${icons.refresh}<span>Retry</span></button>
      </div>
    </div>`;
  }

  override render() {
    const connection = this.#connection;
    const phase = this.#phase.kind;
    const actionable = phase !== "unavailable" && phase !== "idle";
    return html`<div class="hui-vscode-view ${this.narrow ? "hui-vscode-view--narrow" : ""}" data-phase=${phase}>
      <div class="hui-vscode-view__bar">
        <span class="hui-vscode-view__title">${vscodeIcon}<span>VS Code</span></span>
        ${connection ? html`<span class="hui-vscode-view__path" data-hui-tooltip=${connection.folder}><bdi dir="ltr">${connection.label}</bdi></span>
          <button type="button" class="btn btn--icon btn--sm hui-vscode-view__action" aria-label="Copy folder path" data-hui-tooltip=${this.#copied ? "Copied" : "Copy folder path"}
            @click=${() => void this.#copyPath()}>${this.#copied ? icons.check : icons.copy}</button>` : html`<span class="hui-vscode-view__path"></span>`}
        ${actionable ? html`<span class="hui-vscode-view__actions">
          <button type="button" class="btn btn--icon btn--sm hui-vscode-view__action" aria-label="Reload VS Code" data-hui-tooltip="Reload VS Code"
            @click=${() => void this.#open()}>${icons.refresh}</button>
          <button type="button" class="btn btn--icon btn--sm hui-vscode-view__action" aria-label="Open VS Code in a new tab" data-hui-tooltip="Open in a new tab"
            @click=${() => void this.#openTab()}>${icons.externalLink}</button>
        </span>` : nothing}
      </div>
      <div class="hui-vscode-view__body">
        ${connection ? html`<iframe class="hui-vscode-view__frame" title="VS Code" src=${connection.url} data-url=${connection.url}
          allow="clipboard-read; clipboard-write; fullscreen" allowfullscreen @load=${(event: Event) => this.#loaded(event)}></iframe>` : nothing}
        ${this.#renderOverlay()}
      </div>
    </div>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-vscode-view")) customElements.define("hui-vscode-view", HuiVscodeView);
