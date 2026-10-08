/**
 * Settings → Tools → VS Code: the opt-in switch and executable for the Work pane's VS Code view, what the gateway
 * found (name, version, path or why nothing fits) and its one server's state, with Stop. Saving goes through the
 * shared settings store; the status comes from the gateway, polled while this section is open.
 */
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { DEFAULT_VSCODE_SETTINGS, type VscodeSettings } from "../lib/settings.ts";
import { loadVscodeStatus, stopVscode } from "../lib/vscode-store.ts";
import type { VscodeStatus } from "../../shared/vscode.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";
import { loadViewAssets } from "../lib/view-assets.ts";

loadViewAssets(() => import("../styles/tools.css"));

const POLL_MS = 4_000;

/** The pill: what the operator most needs to know at a glance. */
export function vscodeStatusLabel(status: VscodeStatus | undefined): { kind: "muted" | "ok" | "warn" | "danger"; label: string } {
  if (!status) return { kind: "muted", label: "Checking…" };
  switch (status.state) {
    case "off": return { kind: "muted", label: "Off" };
    case "unavailable": return { kind: "danger", label: "Not found" };
    case "starting": return { kind: "warn", label: "Starting" };
    case "running": return { kind: "ok", label: "Running" };
    case "failed": return { kind: "danger", label: "Stopped after an error" };
    default: return { kind: "ok", label: "Ready" };
  }
}

export class HuiVscodeSettings extends LitElement {
  static override properties = {
    settings: { attribute: false },
    onChange: { attribute: false },
  };
  declare settings: VscodeSettings;
  declare onChange: (next: VscodeSettings) => Promise<unknown> | void;
  #status?: VscodeStatus;
  #error = "";
  #busy = false;
  #request = 0;
  #poll?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.settings = DEFAULT_VSCODE_SETTINGS;
    this.onChange = () => undefined;
  }

  override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    void this.#refresh();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#request++;
    if (this.#poll) clearTimeout(this.#poll);
    this.#poll = undefined;
  }

  override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("settings") && !this.settings) this.settings = DEFAULT_VSCODE_SETTINGS;
  }

  async #refresh(keepError = false) {
    const request = ++this.#request;
    try {
      const status = await loadVscodeStatus();
      if (request !== this.#request) return;
      this.#status = status;
      if (!keepError) this.#error = "";
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "VS Code status could not be loaded.";
    } finally {
      if (request === this.#request) {
        this.requestUpdate();
        if (this.#poll) clearTimeout(this.#poll);
        this.#poll = this.isConnected ? setTimeout(() => void this.#refresh(), POLL_MS) : undefined;
      }
    }
  }

  async #save(next: VscodeSettings) {
    this.#error = "";
    this.requestUpdate();
    try { await this.onChange(next); } finally { await this.#refresh(); }
  }

  async #stop() {
    this.#busy = true;
    this.requestUpdate();
    try {
      this.#status = await stopVscode();
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "VS Code could not stop.";
    } finally {
      this.#busy = false;
      await this.#refresh(true);
    }
  }

  #renderExecutable(status: VscodeStatus | undefined) {
    const settings = this.settings;
    const detail = !status
      ? "Leave empty to find openvscode-server on PATH."
      : status.executable
        ? html`${status.executable.source === "configured" ? "Using" : "Detected"} ${status.executable.name} ${status.executable.version} · <code class="browser-settings__path">${status.executable.path}</code>`
        : html`<span class="browser-settings__problem" data-vscode-executable-error>${status.executableError}</span>`;
    return html`<form class="settings-row pi-install-form browser-settings__executable" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const value = String(new FormData(event.currentTarget as HTMLFormElement).get("vscodeExecutable") ?? "").trim();
      void this.#save({ ...settings, executable: value });
    }}>
      <div class="settings-row__text">
        <span class="settings-row__title">VS Code server</span>
        <span class="settings-row__desc">${detail}</span>
      </div>
      <div class="settings-row__control">
        <input class="settings-input" name="vscodeExecutable" aria-label="VS Code server executable" spellcheck="false" autocomplete="off"
          placeholder="Auto-detect" .value=${settings.executable} />
        <button type="submit" class="btn">Save</button>
      </div>
    </form>`;
  }

  #renderProcess(status: VscodeStatus) {
    const running = status.state === "running" || status.state === "starting";
    const started = status.startedAt ? new Date(status.startedAt) : undefined;
    const connections = `${status.connections} open connection${status.connections === 1 ? "" : "s"}`;
    const description = running
      ? `${started ? `Started ${started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ` : ""}${connections} · stops ${status.idleMinutes} minutes after the last one closes`
      : `Starts when a VS Code view opens, on 127.0.0.1 behind HUI only. It stops ${status.idleMinutes} minutes after its last connection closes, and with the gateway.`;
    return html`<div class="settings-row" data-vscode-process=${status.state}>
      <div class="settings-row__text">
        <span class="settings-row__title">Server</span>
        <span class="settings-row__desc">${description}</span>
        ${!running && status.lastError ? html`<span class="settings-row__desc browser-settings__problem">${status.lastError}</span>` : nothing}
      </div>
      <div class="settings-row__control jira-settings__actions">
        ${running
          ? html`<button type="button" class="btn btn--sm" ?disabled=${this.#busy} @click=${() => void this.#stop()}>Stop</button>`
          : html`<span class="settings-row__desc">${status.state === "failed" ? "The next VS Code view starts it again." : "Not running"}</span>`}
      </div>
    </div>`;
  }

  override render() {
    const status = this.#status;
    const settings = this.settings;
    const pill = vscodeStatusLabel(status);
    return html`
      <section class="settings-section browser-settings" id="vscode" data-settings-section="vscode">
        <div class="settings-section__header">
          <div class="settings-section__copy">
            <h2 class="settings-section__heading">VS Code</h2>
            <p class="settings-section__desc">Open a conversation's folder in VS Code inside the Work pane. HUI runs one openvscode-server on this machine, reachable only through HUI.</p>
          </div>
          <div class="settings-section__actions">
            <span class="settings-status ${pill.kind === "muted" ? "" : `settings-status--${pill.kind}`}" data-vscode-status=${pill.kind} role="status">
              <span class="settings-status__dot" aria-hidden="true"></span>${pill.label}
            </span>
          </div>
        </div>
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">VS Code view</span>
              <span class="settings-row__desc">Off by default. On, the Work pane can open VS Code; off, open views close and the server stops.</span>
            </div>
            <div class="settings-row__control">${renderSettingsToggle("VS Code view", settings.enabled, (checked) => void this.#save({ ...settings, enabled: checked }))}</div>
          </div>
          ${this.#renderExecutable(status)}
          ${status && status.state !== "off" && status.state !== "unavailable" ? this.#renderProcess(status) : nothing}
          ${status?.dataDir ? html`<div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">Data</span>
              <span class="settings-row__desc">VS Code's settings, extensions and state stay in this HUI-only directory.</span>
            </div>
            <div class="settings-row__control"><code class="settings-row__value settings-row__value--mono browser-settings__path">${status.dataDir}</code></div>
          </div>` : nothing}
        </div>
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-vscode-settings")) customElements.define("hui-vscode-settings", HuiVscodeSettings);
