/**
 * Settings → Models → Model providers → Local model servers: the custom providers PI's models.json defines,
 * whether their machine answers, and the operator's one start command per provider. The group is folded with the
 * other model provider configuration; each provider is a compact row and the command form opens in a dialog. The
 * command runs only when Start is pressed here; model requests never start a machine. While a start runs, the group
 * polls so Starting becomes Online or Failed.
 */
import { LitElement, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { LocalProvider, LocalProviderSnapshot } from "../../api/schema/local-providers.ts";
import { loadLocalProviders, removeLocalProvider, saveLocalProvider, startLocalProvider } from "../../api/local-providers.ts";
import { loadViewAssets } from "../../lib/view-assets.ts";

loadViewAssets(() => import("../../styles/providers.css"), () => import("../../styles/local-providers.css"));
const DEFAULT_TIMEOUT_SECONDS = 180;
const MIN_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 900;
type Draft = { startCommand: string; healthUrl: string; timeout: string };

function timeoutSeconds(provider: LocalProvider): number {
  return Math.round((provider.readyTimeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000) / 1000);
}

function modelCount(count: number): string {
  return count === 0 ? "Models from PI's catalog" : count === 1 ? "1 model" : `${count} models`;
}

export class HuiLocalProviderSettings extends LitElement {
  #snapshot?: LocalProviderSnapshot;
  #error = "";
  #notice = "";
  #busy = "";
  #editing?: string;
  #draft?: Draft;
  #dialogError = "";
  #confirm = "";
  #poll?: ReturnType<typeof setTimeout>;
  #generation = 0;

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.#poll); this.#generation++; }

  #dialog() { return this.querySelector<HTMLDialogElement>(".hui-local-provider-dialog"); }

  #schedule() {
    clearTimeout(this.#poll);
    if (this.isConnected && this.#snapshot?.providers.some((provider) => provider.status === "starting")) {
      this.#poll = setTimeout(() => void this.#refresh(), 1_200);
    }
  }

  async #refresh() {
    const generation = this.#generation;
    try {
      const next = await loadLocalProviders();
      if (generation !== this.#generation || !this.isConnected) return;
      this.#snapshot = next;
      this.#error = "";
      // A provider that disappeared from the list closes its editor.
      if (this.#editing && !next.providers.some((provider) => provider.id === this.#editing)) this.#closeDialog();
    } catch (error) {
      if (generation === this.#generation) this.#error = error instanceof Error ? error.message : "Local model servers could not be loaded.";
    } finally {
      if (generation === this.#generation && this.isConnected) { this.#schedule(); this.requestUpdate(); }
    }
  }

  #replace(provider: LocalProvider) {
    this.#snapshot = this.#snapshot
      ? { providers: this.#snapshot.providers.some((entry) => entry.id === provider.id) ? this.#snapshot.providers.map((entry) => entry.id === provider.id ? provider : entry) : [...this.#snapshot.providers, provider] }
      : { providers: [provider] };
  }

  async #edit(provider: LocalProvider) {
    if (this.#busy || !provider.inPi) return;
    this.#editing = provider.id;
    this.#draft = { startCommand: provider.startCommand ?? "", healthUrl: provider.healthUrl ?? "", timeout: String(timeoutSeconds(provider)) };
    this.#dialogError = "";
    this.#error = "";
    this.#notice = "";
    this.#confirm = "";
    this.requestUpdate();
    await this.updateComplete;
    const dialog = this.#dialog();
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  #closeDialog() {
    const id = this.#editing;
    this.#dialog()?.close();
    this.#editing = undefined;
    this.#draft = undefined;
    this.#dialogError = "";
    this.requestUpdate();
    if (id) void this.updateComplete.then(() => {
      if (this.isConnected) this.querySelector<HTMLButtonElement>(`[data-edit="${id}"]`)?.focus();
    });
  }

  async #start(provider: LocalProvider) {
    if (this.#busy || !provider.configured || !provider.inPi || provider.status === "online" || provider.status === "starting") return;
    this.#busy = provider.id;
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      this.#replace(await startLocalProvider(provider.id));
      this.#notice = `Starting ${provider.name}…`;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The start command could not run.";
    } finally {
      this.#busy = "";
      this.#schedule();
      this.requestUpdate();
    }
  }

  async #save(provider: LocalProvider, event: SubmitEvent) {
    event.preventDefault();
    if (this.#busy) return;
    const draft = this.#draft;
    if (!draft) return;
    const seconds = Number(draft.timeout);
    if (!Number.isInteger(seconds) || seconds < MIN_TIMEOUT_SECONDS || seconds > MAX_TIMEOUT_SECONDS) {
      this.#dialogError = `Use a ready timeout from ${MIN_TIMEOUT_SECONDS} seconds to ${MAX_TIMEOUT_SECONDS / 60} minutes.`;
      this.requestUpdate();
      return;
    }
    const startCommand = draft.startCommand.trim();
    if (!startCommand) {
      this.#dialogError = "Enter a start command.";
      this.requestUpdate();
      return;
    }
    const healthUrl = draft.healthUrl.trim();
    this.#busy = provider.id;
    this.#dialogError = "";
    this.requestUpdate();
    try {
      this.#replace(await saveLocalProvider(provider.id, {
        startCommand,
        ...(healthUrl ? { healthUrl } : {}),
        readyTimeoutMs: seconds * 1_000,
      }));
      this.#notice = `Start command saved for ${provider.name}.`;
      this.#closeDialog();
    } catch (error) {
      this.#dialogError = error instanceof Error ? error.message : "The start command could not be saved.";
    } finally {
      this.#busy = "";
      this.#schedule();
      this.requestUpdate();
    }
  }

  async #remove(provider: LocalProvider) {
    if (this.#busy) return;
    this.#busy = provider.id;
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      await removeLocalProvider(provider.id);
      this.#confirm = "";
      this.#notice = `Start command removed for ${provider.name}.`;
      await this.#refresh();
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The start command could not be removed.";
    } finally {
      this.#busy = "";
      this.requestUpdate();
    }
  }

  #statusLabel(status: LocalProvider["status"]): string {
    return status === "online" ? "Online" : status === "offline" ? "Offline" : status === "starting" ? "Starting…" : status === "failed" ? "Failed" : "Unknown";
  }

  #note(provider: LocalProvider): string {
    const checked = provider.checkedAt && provider.status !== "starting" ? `Checked ${new Date(provider.checkedAt).toLocaleTimeString()}` : "";
    const message = provider.message
      ?? (provider.status === "offline" ? "The server did not answer."
        : provider.status === "starting" ? "Starting the server…"
          : provider.status === "failed" ? "The start command failed."
            : provider.status === "unknown" ? "Set a health URL, or a baseUrl for this provider in PI's models.json, to check the server."
              : "");
    return [message, checked].filter(Boolean).join(" · ");
  }

  #summary(providers: readonly LocalProvider[]): string {
    if (!this.#snapshot) return "Loading…";
    if (!providers.length) return "No custom providers";
    const online = providers.filter((provider) => provider.status === "online").length;
    const starting = providers.filter((provider) => provider.status === "starting").length;
    const failed = providers.filter((provider) => provider.status === "failed").length;
    return [
      `${providers.length} provider${providers.length === 1 ? "" : "s"}`,
      online ? `${online} online` : "",
      starting ? `${starting} starting` : "",
      failed ? `${failed} failed` : "",
    ].filter(Boolean).join(" · ");
  }

  #form(provider: LocalProvider) {
    const draft = this.#draft;
    if (!draft) return nothing;
    const busy = this.#busy === provider.id;
    return html`<form class="hui-local-provider-form" @submit=${(event: SubmitEvent) => void this.#save(provider, event)}>
      <label class="hui-provider-field">Start command
        <textarea name="startCommand" rows="3" maxlength="4000" required placeholder="wakeonlan aa:bb:cc:dd:ee:ff&#10;ssh model-host 'sudo systemctl start ollama'"
          .value=${draft.startCommand}
          @input=${(event: Event) => { draft.startCommand = (event.target as HTMLTextAreaElement).value; }}></textarea>
        <small class="hui-local-provider-help">Runs once, as your user, on the machine that runs this gateway. It must not ask for input; use SSH keys rather than a password prompt. HUI never stops what it starts.</small>
      </label>
      <label class="hui-provider-field"><span>Health URL <span class="hui-local-provider-optional">optional</span></span>
        <input name="healthUrl" type="url" maxlength="2048" placeholder="Uses this provider's base URL from PI's models.json"
          .value=${draft.healthUrl}
          @input=${(event: Event) => { draft.healthUrl = (event.target as HTMLInputElement).value; }} />
        <small class="hui-local-provider-help">HUI requests this URL until the server answers. Any HTTP answer counts as ready except 502, 503 and 504.</small>
      </label>
      <label class="hui-provider-field">Ready timeout (seconds)
        <input name="timeout" type="number" inputmode="numeric" min=${MIN_TIMEOUT_SECONDS} max=${MAX_TIMEOUT_SECONDS} step="1" required
          .value=${draft.timeout}
          @input=${(event: Event) => { draft.timeout = (event.target as HTMLInputElement).value; }} />
        <small class="hui-local-provider-help">How long Start waits for the machine to boot and the server to answer.</small>
      </label>
      <div class="hui-provider-actions">
        <button class="btn primary" type="submit" ?disabled=${busy}>Save command</button>
        <button class="btn" type="button" ?disabled=${busy} @click=${() => this.#closeDialog()}>Cancel</button>
      </div>
    </form>`;
  }

  #dialogTemplate() {
    const provider = this.#snapshot?.providers.find((entry) => entry.id === this.#editing);
    if (!provider || !this.#draft) return nothing;
    const busy = this.#busy === provider.id;
    return html`<dialog class="hui-provider-dialog hui-local-provider-dialog" data-testid="local-provider-dialog" aria-labelledby="hui-local-provider-dialog-title"
      @cancel=${(event: Event) => { event.preventDefault(); this.#closeDialog(); }}>
      <div class="hui-provider-heading">
        <h3 id="hui-local-provider-dialog-title">${provider.configured ? `Start command · ${provider.name}` : `Set up ${provider.name}`}</h3>
        <button class="btn" aria-label="Close start command dialog" ?disabled=${busy} @click=${() => this.#closeDialog()}>✕</button>
      </div>
      <p class="settings-section__desc">HUI runs this once when you press Start server; it never starts a machine from a model request.</p>
      ${this.#dialogError ? html`<p role="alert" class="hui-provider-error">${this.#dialogError}</p>` : nothing}
      ${this.#form(provider)}
    </dialog>`;
  }

  #entry(provider: LocalProvider) {
    const busy = this.#busy === provider.id;
    const startable = provider.configured && provider.inPi && provider.status !== "online" && provider.status !== "starting";
    return html`<div class="hui-local-provider-entry" role="listitem" data-testid="local-provider" data-status=${provider.status}>
      <div class="hui-local-provider-row">
        <div class="hui-local-provider-row__name">
          <strong>${provider.name}</strong>
          <small><code>${provider.id}</code> · ${modelCount(provider.models)}</small>
        </div>
        <div class="hui-local-provider-row__status" role="status">
          <span class="hui-local-provider-status" data-status=${provider.status}>${this.#statusLabel(provider.status)}</span>
          <small class="hui-local-provider-note">${this.#note(provider)}</small>
        </div>
        <div class="hui-local-provider-row__actions">
          <button class="btn primary" ?disabled=${!startable || busy} @click=${() => void this.#start(provider)}>${provider.status === "starting" ? "Starting…" : provider.status === "online" ? "Running" : "Start server"}</button>
          <button class="btn" data-edit=${provider.id} ?disabled=${busy || !provider.inPi} @click=${() => void this.#edit(provider)}>${provider.configured ? "Edit command" : "Set up start command"}</button>
          ${provider.configured ? html`<button class="btn" ?disabled=${busy} @click=${() => { this.#confirm = provider.id; this.#error = ""; this.requestUpdate(); }}>Remove command</button>` : nothing}
        </div>
      </div>
      ${!provider.inPi ? html`<p class="hui-provider-error hui-local-provider-warning">This provider is not in PI's models.json. Add it there for its models to run, or remove this command.</p>` : nothing}
      ${this.#confirm === provider.id ? html`<div class="hui-local-provider-confirm">
        <p>Remove the start command? ${provider.name} and its models stay configured in PI.</p>
        <div class="hui-provider-actions"><button class="btn" ?disabled=${busy} @click=${() => void this.#remove(provider)}>Confirm removal</button> <button class="btn" ?disabled=${busy} @click=${() => { this.#confirm = ""; this.requestUpdate(); }}>Keep command</button></div>
      </div>` : nothing}
    </div>`;
  }

  override render() {
    const providers = this.#snapshot?.providers ?? [];
    return html`<details class="hui-provider-configuration hui-local-servers">
      <summary><span>Local model servers</span><span class="hui-local-servers__count">${this.#summary(providers)}</span></summary>
      <div class="hui-local-servers__body">
        <div class="hui-local-servers__head">
          <p class="settings-section__desc">Custom providers from PI's models.json. Save how to start one, then start it here before using its models; a request waits while a start is in progress but never starts one.</p>
          <button class="btn" ?disabled=${this.#busy !== "" || !this.#snapshot} @click=${() => void this.#refresh()}>Check again</button>
        </div>
        ${this.#error ? html`<p role="alert" class="hui-provider-error">${this.#error}</p>` : nothing}
        ${this.#notice ? html`<p role="status" class="hui-provider-notice">${this.#notice}</p>` : nothing}
        ${!this.#snapshot ? html`<p>Loading local model servers…</p>` : providers.length
          ? html`<div class="hui-local-provider-list" role="list">${repeat(providers, (provider) => provider.id, (provider) => this.#entry(provider))}</div>`
          : html`<p class="hui-local-provider-empty">No custom providers yet. Add one with its base URL and models to PI's <code>models.json</code> (usually <code>~/.pi/agent/models.json</code>), then come back here to give it a start command.</p>`}
      </div>
    </details>
    ${this.#dialogTemplate()}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-local-provider-settings")) customElements.define("hui-local-provider-settings", HuiLocalProviderSettings);
