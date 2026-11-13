/**
 * Settings → Models → Local model servers: the custom providers PI's models.json defines, whether their machine
 * answers, and the operator's one start command per provider. The command runs only when Start is pressed here;
 * model requests never start a machine. While a start runs, the section polls so Starting becomes Online or Failed.
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
  #confirm = "";
  #poll?: ReturnType<typeof setTimeout>;
  #generation = 0;

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.#poll); this.#generation++; }

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
      if (this.#editing && !next.providers.some((provider) => provider.id === this.#editing)) this.#closeEditor();
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

  #edit(provider: LocalProvider) {
    this.#editing = provider.id;
    this.#draft = { startCommand: provider.startCommand ?? "", healthUrl: provider.healthUrl ?? "", timeout: String(timeoutSeconds(provider)) };
    this.#error = "";
    this.#notice = "";
    this.#confirm = "";
    this.requestUpdate();
  }

  #closeEditor() { this.#editing = undefined; this.#draft = undefined; this.requestUpdate(); }

  async #start(provider: LocalProvider) {
    if (this.#busy) return;
    this.#busy = provider.id; this.#error = ""; this.#notice = ""; this.requestUpdate();
    try {
      this.#replace(await startLocalProvider(provider.id));
      this.#notice = `Starting ${provider.name}…`;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The start command could not run.";
    } finally {
      this.#busy = ""; this.#schedule(); this.requestUpdate();
    }
  }

  async #save(provider: LocalProvider, event: SubmitEvent) {
    event.preventDefault();
    if (this.#busy) return;
    const draft = this.#draft;
    if (!draft) return;
    const seconds = Number(draft.timeout);
    if (!Number.isInteger(seconds) || seconds < MIN_TIMEOUT_SECONDS || seconds > MAX_TIMEOUT_SECONDS) {
      this.#error = `Use a ready timeout from ${MIN_TIMEOUT_SECONDS} seconds to ${MAX_TIMEOUT_SECONDS / 60} minutes.`;
      this.requestUpdate();
      return;
    }
    const startCommand = draft.startCommand.trim();
    if (!startCommand) {
      this.#error = "Enter a start command.";
      this.requestUpdate();
      return;
    }
    const healthUrl = draft.healthUrl.trim();
    this.#busy = provider.id; this.#error = ""; this.#notice = ""; this.requestUpdate();
    try {
      this.#replace(await saveLocalProvider(provider.id, {
        startCommand,
        ...(healthUrl ? { healthUrl } : {}),
        readyTimeoutMs: seconds * 1_000,
      }));
      this.#editing = undefined; this.#draft = undefined;
      this.#notice = `Start command saved for ${provider.name}.`;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The start command could not be saved.";
    } finally {
      this.#busy = ""; this.#schedule(); this.requestUpdate();
    }
  }

  async #remove(provider: LocalProvider) {
    if (this.#busy) return;
    this.#busy = provider.id; this.#error = ""; this.#notice = ""; this.requestUpdate();
    try {
      await removeLocalProvider(provider.id);
      this.#confirm = "";
      this.#notice = `Start command removed for ${provider.name}.`;
      await this.#refresh();
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The start command could not be removed.";
    } finally {
      this.#busy = ""; this.requestUpdate();
    }
  }

  #statusLabel(status: LocalProvider["status"]): string {
    return status === "online" ? "Online" : status === "offline" ? "Offline" : status === "starting" ? "Starting…" : status === "failed" ? "Failed" : "Unknown";
  }

  #message(provider: LocalProvider): string {
    if (provider.message) return provider.message;
    if (provider.status === "online") return "The server answers.";
    if (provider.status === "offline") return "The server did not answer.";
    if (provider.status === "starting") return "Starting the server…";
    return "Set a health URL, or a baseUrl for this provider in PI's models.json, to check the server.";
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
        <button class="btn" type="button" ?disabled=${busy} @click=${() => this.#closeEditor()}>Cancel</button>
      </div>
    </form>`;
  }

  #card(provider: LocalProvider) {
    const busy = this.#busy === provider.id;
    const startable = provider.configured && provider.status !== "online" && provider.status !== "starting";
    return html`<article class="hui-local-provider" data-testid="local-provider" data-status=${provider.status} aria-label=${provider.name}>
      <div class="hui-provider-heading">
        <div>
          <h3>${provider.name}</h3>
          <p><code>${provider.id}</code> · ${modelCount(provider.models)} · ${provider.inPi ? "From PI's models.json" : "Not in PI's models.json"}</p>
        </div>
        <span class="hui-local-provider-status" data-status=${provider.status}>${this.#statusLabel(provider.status)}</span>
      </div>
      <p class="hui-local-provider-message" role="status">${this.#message(provider)}</p>
      ${provider.checkedAt && provider.status !== "starting" ? html`<small class="hui-local-provider-checked">Checked ${new Date(provider.checkedAt).toLocaleTimeString()}</small>` : nothing}
      ${!provider.inPi ? html`<p class="hui-provider-error">This provider is not in PI's models.json. Add it there for its models to run, or remove this command.</p>` : nothing}
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${!startable || busy} @click=${() => void this.#start(provider)}>${provider.status === "starting" ? "Starting…" : provider.status === "online" ? "Running" : "Start server"}</button>
        <button class="btn" ?disabled=${busy} @click=${() => this.#edit(provider)}>${provider.configured ? "Edit command" : "Set up start command"}</button>
        ${provider.configured ? html`<button class="btn" ?disabled=${busy} @click=${() => { this.#confirm = provider.id; this.#error = ""; this.requestUpdate(); }}>Remove command</button>` : nothing}
      </div>
      ${this.#confirm === provider.id ? html`<div class="hui-local-provider-confirm">
        <p>Remove the start command? ${provider.name} and its models stay configured in PI.</p>
        <div class="hui-provider-actions"><button class="btn" ?disabled=${busy} @click=${() => void this.#remove(provider)}>Confirm removal</button> <button class="btn" ?disabled=${busy} @click=${() => { this.#confirm = ""; this.requestUpdate(); }}>Keep command</button></div>
      </div>` : nothing}
      ${this.#editing === provider.id ? this.#form(provider) : nothing}
    </article>`;
  }

  override render() {
    const providers = this.#snapshot?.providers ?? [];
    return html`<section class="settings-section hui-local-providers">
      <div class="settings-section__header">
        <div class="settings-section__copy">
          <h2 class="settings-section__heading">Local model servers</h2>
          <p class="settings-section__desc">Custom providers from PI's models.json. Save how to start one, then start it here before using its models; a request waits while a start is in progress but never starts one.</p>
        </div>
        <button class="btn" ?disabled=${this.#busy !== "" || !this.#snapshot} @click=${() => void this.#refresh()}>Check again</button>
      </div>
      ${this.#error ? html`<p role="alert" class="hui-provider-error">${this.#error}</p>` : nothing}
      ${this.#notice ? html`<p role="status" class="hui-provider-notice">${this.#notice}</p>` : nothing}
      ${!this.#snapshot ? html`<p>Loading local model servers…</p>` : providers.length ? html`<div class="hui-local-provider-cards">${repeat(providers, (provider) => provider.id, (provider) => this.#card(provider))}</div>` : html`<p class="hui-local-provider-empty">No custom providers yet. Add one with its base URL and models to PI's <code>models.json</code> (usually <code>~/.pi/agent/models.json</code>), then come back here to give it a start command.</p>`}
    </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-local-provider-settings")) customElements.define("hui-local-provider-settings", HuiLocalProviderSettings);
