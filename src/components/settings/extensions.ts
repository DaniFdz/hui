/**
 * Settings → Extensions: the installed gateway modules, their state and their enable switch. The gateway owns the
 * list and the enable store; this page reads them, toggles one, and shows the state that came back.
 */
import { LitElement, html, nothing } from "lit";

import { loadExtensions, setExtensionEnabled } from "../../api/extensions.ts";
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
    if (!requestOpenExtensionPanel(this, { id: extension.id })) this.#error = "Open a conversation first.";
  }

  async #toggle(extension: ExtensionStatus, enabled: boolean) {
    this.#busy.add(extension.id);
    this.#error = "";
    this.requestUpdate();
    try {
      const status = await setExtensionEnabled(extension.id, enabled);
      this.#extensions = this.#extensions.map((entry) => entry.id === status.id ? status : entry);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "That extension could not be changed.";
    } finally {
      this.#busy.delete(extension.id);
      this.requestUpdate();
    }
  }

  #renderExtension(extension: ExtensionStatus) {
    const tone = TONE[extension.state];
    return html`<div class="settings-row" data-extension-row=${extension.id} data-testid="extension-row">
      <div class="settings-row__text">
        <span class="settings-row__title">${extension.name}
          <span class="settings-status ${tone ? `settings-status--${tone}` : ""}" data-extension-state=${extension.state} data-testid="extension-state"><span class="settings-status__dot" aria-hidden="true"></span>${EXTENSION_STATE_LABEL[extension.state]}</span>
        </span>
        <span class="settings-row__desc"><code>${extension.id}</code>${extension.description ? html` · ${extension.description}` : nothing}</span>
        <span class="settings-row__desc" data-extension-routes>${extensionRoutesSummary(extension.routes)}</span>
        ${extension.error ? html`<span class="settings-row__desc" role="alert" data-extension-error data-testid="extension-error">${extension.error}</span>` : nothing}
      </div>
      <div class="settings-row__control jira-settings__actions">
        ${extension.panel ? html`<button type="button" class="btn btn--sm" data-extension-open=${extension.id}
          ?disabled=${!this.panelAvailable || extension.state !== "loaded"}
          title=${this.panelAvailable ? `Open ${extension.panel.title}` : "Open a conversation first"}
          @click=${() => this.#openPanel(extension)}>Open panel</button>` : nothing}
        ${renderSettingsToggle(extensionToggleLabel(extension), extension.enabled, (checked) => void this.#toggle(extension, checked), this.#busy.has(extension.id))}
      </div>
    </div>`;
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
