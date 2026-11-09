/**
 * Settings → Tools → Browser. The switches, the path and the origin allowlist save through the shared settings store;
 * the gateway reports the process, its tabs and previews, which this page polls and captures while it is open. Site
 * secrets are their own list: names and origins come back from the gateway, values only ever go one way.
 */
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { BrowserSecretView, BrowserStatus, BrowserTabView } from "../../api/schema/browser.ts";
import { browserStatusLabel, browserVersionLabel } from "../../lib/browser-status.ts";
import { controlBrowser, loadBrowserSecrets, loadBrowserStatus, previewBrowserTab, removeBrowserSecret, saveBrowserSecret } from "../../api/browser.ts";
import { DEFAULT_BROWSER_SETTINGS, type BrowserSettings } from "../../lib/settings/settings.ts";
import { renderSettingsToggle } from "../../views/settings-toggle.ts";
import { loadViewAssets } from "../../lib/view-assets.ts";

loadViewAssets(() => import("../../styles/tools.css"));

/** Tabs and state change as agents work; this page is the only reader. */
const POLL_MS = 4_000;

export class HuiBrowserSettings extends LitElement {
  static override properties = {
    settings: { attribute: false },
    onChange: { attribute: false },
  };
  declare settings: BrowserSettings;
  declare onChange: (next: BrowserSettings) => Promise<unknown> | void;
  #status?: BrowserStatus;
  #loading = true;
  #busy = false;
  #error = "";
  #request = 0;
  #poll?: ReturnType<typeof setTimeout>;
  #secrets: BrowserSecretView[] | undefined;
  #secretError = "";
  /** Remounts the add form after a save so its value field is empty again. */
  #secretForm = 0;
  /** Preview data URLs keyed by tab id, with the URL they were captured for. */
  readonly #previews = new Map<string, { url: string; image?: string; error?: string }>();

  constructor() {
    super();
    this.settings = DEFAULT_BROWSER_SETTINGS;
    this.onChange = () => undefined;
  }

  override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    void this.#refresh();
    void this.#refreshSecrets();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#request++;
    if (this.#poll) clearTimeout(this.#poll);
    this.#poll = undefined;
  }

  override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("settings") && !this.settings) this.settings = DEFAULT_BROWSER_SETTINGS;
  }

  #schedule() {
    if (this.#poll) clearTimeout(this.#poll);
    this.#poll = this.isConnected ? setTimeout(() => void this.#refresh(), POLL_MS) : undefined;
  }

  /** keepError preserves the message of the action that triggered this read. */
  async #refresh(keepError = false) {
    const request = ++this.#request;
    try {
      const status = await loadBrowserStatus();
      if (request !== this.#request) return;
      this.#status = status;
      if (!keepError) this.#error = "";
      this.#syncPreviews(status.tabs);
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "Browser status could not be loaded.";
    } finally {
      if (request === this.#request) {
        this.#loading = false;
        this.requestUpdate();
        this.#schedule();
      }
    }
  }

  /** Capture a tab when it first appears or navigates; drop closed tabs. */
  #syncPreviews(tabs: readonly BrowserTabView[]) {
    const open = new Set(tabs.map((tab) => tab.id));
    for (const id of this.#previews.keys()) if (!open.has(id)) this.#previews.delete(id);
    for (const tab of tabs) {
      if (this.#previews.get(tab.id)?.url !== tab.url) void this.#capture(tab);
    }
  }

  async #capture(tab: BrowserTabView) {
    const previous = this.#previews.get(tab.id);
    this.#previews.set(tab.id, { url: tab.url, ...(previous?.image ? { image: previous.image } : {}) });
    try {
      const image = await previewBrowserTab(tab.id);
      if (this.#previews.get(tab.id)?.url === tab.url) this.#previews.set(tab.id, { url: tab.url, image });
    } catch (error) {
      if (this.#previews.get(tab.id)?.url === tab.url) {
        this.#previews.set(tab.id, { url: tab.url, error: error instanceof Error ? error.message : "Preview unavailable." });
      }
    }
    this.requestUpdate();
  }

  async #save(next: BrowserSettings) {
    this.#error = "";
    this.requestUpdate();
    try {
      await this.onChange(next);
    } finally {
      await this.#refresh();
    }
  }

  async #control(action: "start" | "stop") {
    const request = ++this.#request;
    this.#busy = true;
    this.#error = "";
    this.requestUpdate();
    try {
      const status = await controlBrowser(action);
      if (request === this.#request) {
        this.#status = status;
        this.#syncPreviews(status.tabs);
      }
    } catch (error) {
      if (request === this.#request) {
        this.#error = error instanceof Error ? error.message : `The browser could not ${action}.`;
        // The gateway recorded the failure too; show its current state.
        void this.#refresh(true);
      }
    } finally {
      this.#busy = false;
      this.#loading = false;
      this.requestUpdate();
      if (request === this.#request) this.#schedule();
    }
  }

  #renderExecutable(status: BrowserStatus | undefined) {
    const settings = this.settings;
    const detail = !status
      ? "Leave empty to auto-detect Google Chrome, Brave, Microsoft Edge or Chromium."
      : status.executable
        ? html`${status.executable.source === "configured" ? "Using" : "Detected"} ${status.executable.name} · <code class="browser-settings__path">${status.executable.path}</code>`
        : html`<span class="browser-settings__problem">${status.executableError}</span>`;
    return html`<form class="settings-row pi-install-form browser-settings__executable" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const value = String(new FormData(event.currentTarget as HTMLFormElement).get("executablePath") ?? "").trim();
      void this.#save({ ...settings, executablePath: value });
    }}>
      <div class="settings-row__text">
        <span class="settings-row__title">Browser executable</span>
        <span class="settings-row__desc">${detail}</span>
      </div>
      <div class="settings-row__control">
        <input class="settings-input" name="executablePath" aria-label="Browser executable" spellcheck="false" autocomplete="off"
          placeholder="Auto-detect" .value=${settings.executablePath} />
        <button type="submit" class="btn">Save</button>
      </div>
    </form>`;
  }

  /** The list is the browser's whole reach: a page outside it is refused, and a link that leaves it is stopped. */
  #renderOrigins() {
    const settings = this.settings;
    const count = settings.allowedOrigins.length;
    const description = count
      ? `${count} pattern${count === 1 ? "" : "s"}. A page outside them is refused, a link or redirect that leaves them is stopped and the tab is left blank, and a local file is refused. Subresources a page loads are not filtered.`
      : "Empty lets agents browse anywhere, which is the default. One pattern per line: example.com, example.com:8443, https://app.example.com, or *.example.com for subdomains only.";
    return html`<form class="settings-row browser-settings__origins" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const raw = new FormData(event.currentTarget as HTMLFormElement).get("allowedOrigins");
      const patterns = String(raw ?? "").split(/[\n,]/u).map((pattern) => pattern.trim()).filter(Boolean);
      void this.#save({ ...settings, allowedOrigins: patterns });
    }}>
      <div class="settings-row__text">
        <label class="settings-row__title" for="browser-allowed-origins">Allowed origins</label>
        <span class="settings-row__desc">${description}</span>
      </div>
      <div class="settings-row__control">
        <textarea class="settings-input browser-settings__origins-input" id="browser-allowed-origins" name="allowedOrigins"
          rows="4" spellcheck="false" autocomplete="off" placeholder="example.com&#10;*.example.com"
          .value=${settings.allowedOrigins.join("\n")}></textarea>
        <button type="submit" class="btn">Save origins</button>
      </div>
    </form>`;
  }

  async #refreshSecrets() {
    try {
      this.#secrets = await loadBrowserSecrets();
      this.#secretError = "";
    } catch (error) {
      this.#secretError = error instanceof Error ? error.message : "The site secrets could not be loaded.";
    } finally {
      this.requestUpdate();
    }
  }

  async #addSecret(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const origin = String(data.get("origin") ?? "").trim();
    const value = String(data.get("value") ?? "");
    try {
      this.#secrets = await saveBrowserSecret({ name, origin, value });
      this.#secretError = "";
      this.#secretForm += 1;
    } catch (error) {
      this.#secretError = error instanceof Error ? error.message : "The secret could not be saved.";
    } finally {
      this.requestUpdate();
    }
  }

  async #removeSecret(name: string) {
    try {
      this.#secrets = await removeBrowserSecret(name);
      this.#secretError = "";
    } catch (error) {
      this.#secretError = error instanceof Error ? error.message : "The secret could not be removed.";
    } finally {
      this.requestUpdate();
    }
  }

  /** What is stored is a name and an origin; a value is write-only from here. */
  #renderSecrets() {
    const secrets = this.#secrets;
    return html`<h3 class="browser-settings__subheading">Site secrets</h3>
      <div class="settings-group browser-settings__secrets">
        ${secrets === undefined
          ? html`<div class="settings-row"><div class="settings-row__text"><span class="settings-row__desc">Loading…</span></div></div>`
          : secrets.length === 0
            ? html`<div class="settings-row"><div class="settings-row__text"><span class="settings-row__desc">None stored. An agent can type one into a login field without ever seeing it, and this machine keeps it in a file only you can read.</span></div></div>`
            : secrets.map((secret) => html`<div class="settings-row">
                <div class="settings-row__text">
                  <span class="settings-row__title">${secret.name}</span>
                  <span class="settings-row__desc">${secret.origin}${secret.createdAt ? ` · stored ${new Date(secret.createdAt).toLocaleDateString()}` : ""}</span>
                </div>
                <div class="settings-row__control"><button type="button" class="btn btn--sm" @click=${() => void this.#removeSecret(secret.name)}>Delete ${secret.name}</button></div>
              </div>`)}
        <form class="settings-row browser-settings__secret-form" @submit=${(event: SubmitEvent) => void this.#addSecret(event)}>
          <div class="settings-row__text">
            <span class="settings-row__title">Add a site secret</span>
            <span class="settings-row__desc">The agent types it into a field whose page is exactly this origin, and its value never appears in the chat, a tool result or a log. Page script on that origin can still read the field once it is filled, so keep the origin allowlist narrow.</span>
            ${this.#secretError ? html`<span class="settings-row__desc browser-settings__problem">${this.#secretError}</span>` : nothing}
          </div>
          <div class="settings-row__control browser-settings__secret-fields">
            ${keyed(this.#secretForm, html`
              <label class="browser-settings__label" for="browser-secret-name">Secret name</label>
              <input class="settings-input" id="browser-secret-name" name="name" spellcheck="false" autocomplete="off" placeholder="github">
              <label class="browser-settings__label" for="browser-secret-origin">Secret origin</label>
              <input class="settings-input" id="browser-secret-origin" name="origin" spellcheck="false" autocomplete="off" placeholder="https://github.com">
              <label class="browser-settings__label" for="browser-secret-value">Secret value</label>
              <input class="settings-input" id="browser-secret-value" name="value" type="password" autocomplete="new-password">
            `)}
            <button type="submit" class="btn">Add secret</button>
          </div>
        </form>
      </div>`;
  }

  #renderProcess(status: BrowserStatus) {
    const running = status.state === "running";
    const pending = status.state === "starting" || status.state === "stopping";
    const started = status.startedAt ? new Date(status.startedAt) : undefined;
    const description = running
      ? `${browserVersionLabel(status)} · ${status.mode === "windowed" ? "visible window" : "headless, no window"}${started ? ` · started ${started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
      : "Starts when an agent opens a page and stops when its last tab closes. Stopping a turn closes its tabs; unused tabs close after 10 minutes.";
    return html`<div class="settings-row" data-browser-process=${status.state}>
      <div class="settings-row__text">
        <span class="settings-row__title">Managed browser</span>
        <span class="settings-row__desc">${description}</span>
        ${!running && status.lastError && status.lastError !== this.#error ? html`<span class="settings-row__desc browser-settings__problem">${status.lastError}</span>` : nothing}
      </div>
      <div class="settings-row__control jira-settings__actions">
        ${running || status.state === "stopping"
          ? html`<button type="button" class="btn btn--sm" ?disabled=${this.#busy || pending} @click=${() => void this.#control("stop")}>Stop</button>`
          : html`<button type="button" class="btn btn--sm" ?disabled=${this.#busy || pending || !status.enabled || !status.executable} @click=${() => void this.#control("start")}>Start</button>`}
      </div>
    </div>`;
  }

  #renderTab(tab: BrowserTabView) {
    const preview = this.#previews.get(tab.id);
    return html`<div class="settings-row browser-tab" data-browser-tab=${tab.id}>
      <div class="settings-row__text">
        <span class="settings-row__title">${tab.id} · ${tab.title || "Untitled"}</span>
        <span class="settings-row__desc"><span class="browser-tab__url">${tab.url}</span></span>
        <span class="settings-row__desc">Opened by ${tab.ownerTitle || "a removed conversation"}</span>
      </div>
      <div class="settings-row__control">
        <button type="button" class="btn btn--sm" aria-label=${`Refresh preview of ${tab.id}`} @click=${() => void this.#capture(tab)}>Refresh preview</button>
      </div>
      ${preview?.image
        ? html`<img class="browser-tab__preview" src=${preview.image} alt=${`Preview of ${tab.title || tab.url}`} />`
        : preview?.error ? html`<p class="browser-tab__preview-note">${preview.error}</p>` : nothing}
    </div>`;
  }

  override render() {
    const status = this.#status;
    const settings = this.settings;
    const pill = browserStatusLabel(this.#loading ? undefined : status);
    return html`
      <section class="settings-section browser-settings" data-settings-section="browser">
        <div class="settings-section__header">
          <div class="settings-section__copy">
            <h2 class="settings-section__heading">Browser</h2>
            <p class="settings-section__desc">Agents get a dedicated Chromium-family browser with its own HUI profile. It never uses your browser windows, tabs, cookies or passwords.</p>
          </div>
          <div class="settings-section__actions">
            <span class="settings-status ${pill.kind === "muted" ? "" : `settings-status--${pill.kind}`}" data-browser-status=${pill.kind} role="status">
              <span class="settings-status__dot" aria-hidden="true"></span>${pill.label}
            </span>
          </div>
        </div>
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">Browser tool</span>
              <span class="settings-row__desc">Offer the browser tool to new and restarted sessions. Off, calls from sessions that are already running are refused too.</span>
            </div>
            <div class="settings-row__control">${renderSettingsToggle("Browser tool", settings.enabled, (checked) => void this.#save({ ...settings, enabled: checked }))}</div>
          </div>
          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">Run headless</span>
              <span class="settings-row__desc">No window, Dock icon or focus change while you work. Turn off to watch the agent in a visible window; a running browser restarts in the new mode on its next use.</span>
            </div>
            <div class="settings-row__control">${renderSettingsToggle("Run headless", settings.headless, (checked) => void this.#save({ ...settings, headless: checked }))}</div>
          </div>
          ${this.#renderOrigins()}
          ${this.#renderSecrets()}
          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">Mirror browser state</span>
              <span class="settings-row__desc">A session on a worker starts with the cookies, localStorage and IndexedDB this machine's browser holds, and the worker's own state comes back here. Log in once instead of twice; signing out on one machine does not sign out the other.</span>
            </div>
            <div class="settings-row__control">${renderSettingsToggle("Mirror browser state", settings.mirrorState, (checked) => void this.#save({ ...settings, mirrorState: checked }))}</div>
          </div>
          ${this.#renderExecutable(status)}
          ${status ? this.#renderProcess(status) : nothing}
          ${status?.profileDir ? html`<div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__title">Profile</span>
              <span class="settings-row__desc">Cookies and logins created by agents stay in this HUI-only directory.</span>
            </div>
            <div class="settings-row__control"><code class="settings-row__value settings-row__value--mono browser-settings__path">${status.profileDir}</code></div>
          </div>` : nothing}
        </div>
        ${status && status.tabs.length > 0 ? html`
          <h3 class="browser-settings__subheading">Open tabs · ${status.tabs.length}</h3>
          <div class="settings-group browser-settings__tabs">${status.tabs.map((tab) => this.#renderTab(tab))}</div>` : nothing}
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-browser-settings")) customElements.define("hui-browser-settings", HuiBrowserSettings);
