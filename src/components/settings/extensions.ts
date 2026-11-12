/**
 * Settings → Extensions: the installed gateway modules, their state and their enable switch. The gateway owns the
 * list and the enable store; this page reads them, toggles one, and shows the state that came back.
 */
import { LitElement, html, nothing } from "lit";

import { loadExtensions, reloadExtension, setExtensionEnabled } from "../../api/extensions.ts";
import type { ExtensionStatus } from "../../api/schema/extensions.ts";
import {
  EXTENSION_EMPTY_NOTE, EXTENSION_STATE_LABEL, EXTENSION_TRUST_NOTE, extensionRoutesSummary, extensionToggleLabel,
} from "../../lib/extensions/presentation.ts";
import { requestOpenExtensionPanel } from "../../lib/extensions/open-panel.ts";
import { renderSettingsToggle } from "../../views/settings-toggle.ts";

const TONE: Readonly<Record<ExtensionStatus["state"], string>> = {
  loaded: "ok",
  disabled: "",
  failed: "danger",
  missing: "warn",
};

export class HuiExtensionsSettings extends LitElement {
  static override properties = { panelAvailable: { type: Boolean } };
  declare panelAvailable: boolean;

  #extensions: ExtensionStatus[] = [];
  #storeError = "";
  #loading = true;
  #error = "";
  #busy = new Set<string>();
  #request = 0;

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.#request++; }

  async #refresh() {
    const request = ++this.#request;
    try {
      const { extensions, storeError } = await loadExtensions();
      if (request !== this.#request) return;
      this.#extensions = extensions;
      this.#storeError = storeError ?? "";
      this.#error = "";
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "Extensions could not be loaded.";
    }
    if (request !== this.#request) return;
    this.#loading = false;
    this.requestUpdate();
  }

  #openPanel(extension: ExtensionStatus) {
    const icon = extension.panel?.icon;
    if (!requestOpenExtensionPanel(this, { id: extension.id, ...(icon ? { icon } : {}) })) this.#error = "Open a conversation first.";
  }

  async #reload(extension: ExtensionStatus) {
    this.#busy.add(extension.id);
    this.#error = "";
    this.requestUpdate();
    try {
      const status = await reloadExtension(extension.id);
      this.#extensions = this.#extensions.map((entry) => entry.id === status.id ? status : entry);
      this.dispatchEvent(new CustomEvent("hui-extensions-changed", { bubbles: true, composed: true }));
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "That extension could not be reloaded.";
    } finally {
      this.#busy.delete(extension.id);
      this.requestUpdate();
    }
  }

  async #toggle(extension: ExtensionStatus, enabled: boolean) {
    this.#busy.add(extension.id);
    this.#error = "";
    this.requestUpdate();
    try {
      const status = await setExtensionEnabled(extension.id, enabled);
      this.#extensions = this.#extensions.map((entry) => entry.id === status.id ? status : entry);
      this.dispatchEvent(new CustomEvent("hui-extensions-changed", { bubbles: true, composed: true }));
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "That extension could not be changed.";
    } finally {
      this.#busy.delete(extension.id);
      this.requestUpdate();
    }
  }

  #contributions(extension: ExtensionStatus) {
    const prompt = extension.prompt ?? [];
    const tools = extension.tools ?? [];
    if (prompt.length === 0 && tools.length === 0) return nothing;
    return html`<div class="settings-row settings-row--stacked" data-testid="extension-contributions">
      <details>
        <summary class="settings-row__title">Prompt and tools</summary>
        ${prompt.map((section) => html`<details data-testid="extension-prompt">
          <summary class="settings-row__desc">${section.title} · ${section.text.length} characters</summary>
          <pre class="extension-contributions__text">${section.text}</pre>
        </details>`)}
        ${tools.map((tool) => html`<span class="settings-row__desc" data-testid="extension-tool"><code>${tool.runtimeName}</code> · ${tool.description}</span>`)}
      </details>
    </div>`;
  }

  #renderExtension(extension: ExtensionStatus) {
    const tone = TONE[extension.state];
    return html`<div class="settings-row" data-extension-row=${extension.id} data-testid="extension-row">
      <div class="settings-row__text">
        <span class="settings-row__title">${extension.name}
          <span class="settings-status ${tone ? `settings-status--${tone}` : ""}" data-extension-state=${extension.state} data-testid="extension-state"><span class="settings-status__dot" aria-hidden="true"></span>${EXTENSION_STATE_LABEL[extension.state]}</span>
        </span>
        <span class="settings-row__desc"><code>${extension.id}</code>${extension.description ? html` · ${extension.description}` : nothing}${extension.version ? html` · v${extension.version}` : nothing}${extension.engines ? html` · HUI ${[extension.engines.min ? `>=${extension.engines.min}` : "", extension.engines.max ? `<=${extension.engines.max}` : ""].filter(Boolean).join(" ")}` : nothing}${extension.mode === "process" ? html` · process${extension.restarts ? ` · ${extension.restarts} restart${extension.restarts === 1 ? "" : "s"}` : ""}` : nothing}</span>
        ${extension.reloadedAt ? html`<span class="settings-row__desc" data-extension-reloaded>Reloaded ${new Date(extension.reloadedAt).toLocaleTimeString()}</span>` : nothing}
        ${extension.page ? html`<span class="settings-row__desc" data-extension-page data-testid="extension-page-info">Page · ${extension.page.title}</span>` : nothing}
        <span class="settings-row__desc" data-extension-routes>${extensionRoutesSummary(extension.routes)}</span>
        ${extension.error ? html`<span class="settings-row__desc" role="alert" data-extension-error data-testid="extension-error">${extension.error}</span>` : nothing}
      </div>
      <div class="settings-row__control jira-settings__actions">
        ${extension.enabled && (extension.state === "loaded" || extension.state === "failed") ? html`<button type="button" class="btn btn--sm" data-extension-reload=${extension.id}
          ?disabled=${this.#busy.has(extension.id)}
          @click=${() => void this.#reload(extension)}>Reload</button>` : nothing}
        ${extension.panel ? html`<button type="button" class="btn btn--sm" data-extension-open=${extension.id}
          ?disabled=${!this.panelAvailable || extension.state !== "loaded"}
          title=${this.panelAvailable ? `Open ${extension.panel.title}` : "Open a conversation first"}
          @click=${() => this.#openPanel(extension)}>Open panel</button>` : nothing}
        ${renderSettingsToggle(extensionToggleLabel(extension), extension.enabled, (checked) => void this.#toggle(extension, checked), this.#busy.has(extension.id))}
      </div>
    </div>
    ${this.#contributions(extension)}`;
  }

  override render() {
    return html`
      <section class="settings-section" data-settings-extensions data-testid="settings-extensions">
        <div class="settings-section__header"><div class="settings-section__copy">
          <h2 class="settings-section__heading">Gateway extensions</h2>
          <p class="settings-section__desc">Local modules that add JSON routes to the gateway, installed under <code>~/.config/hui/extensions</code> and off until enabled. ${EXTENSION_TRUST_NOTE}</p>
        </div><button type="button" class="btn btn--sm" ?disabled=${this.#loading} @click=${() => void this.#refresh()}>Refresh</button></div>
        ${this.#storeError ? html`<p class="jira-settings__error" role="alert" data-extensions-store-error data-testid="extensions-store-error">The enable list could not be read: ${this.#storeError}</p>` : nothing}
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        ${this.#loading
          ? html`<p class="settings-row__desc" role="status">Reading extensions…</p>`
          : this.#extensions.length === 0
            ? html`<p class="settings-row__desc" data-extensions-empty data-testid="extensions-empty">${EXTENSION_EMPTY_NOTE}</p>`
            : this.#extensions.map((extension) => this.#renderExtension(extension))}
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-extensions-settings")) {
  customElements.define("hui-extensions-settings", HuiExtensionsSettings);
}
