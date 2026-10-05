import { LitElement, html, nothing } from "lit";
import type { VoiceConnection } from "../../shared/voice.ts";
import { icons } from "../lib/icons.ts";
import { connectVoice, disconnectVoice, loadVoiceConnection, voiceConnectionSummary } from "../lib/voice.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";

// Node's focused view tests import views without a CSS loader.
if (typeof document !== "undefined") {
  await import("../styles/voice.css");
}

/** Announced (bubbling) after a connect, change or disconnect, so the app updates what bot chats offer. */
export const VOICE_CONNECTION_EVENT = "hui-voice-connection";

/**
 * The VoiceStudio section of Settings → Integrations: the speech service bots
 * listen and speak through (HUI-18). Owns only this section; the key is
 * write-only here and never returned by the gateway. The "send voice notes
 * immediately" switch is a HUI setting the page passes in.
 */
export class HuiVoiceSettings extends LitElement {
  #connection?: VoiceConnection;
  #loading = true;
  #saving = false;
  #checking = false;
  #editing = false;
  #error = "";
  #notice = "";
  #request = 0;
  #sendNotes = false;
  /** Settings.voice.sendNotesImmediately; the page saves it. */
  onSendNotes: ((on: boolean) => void) | undefined;

  get sendNotes(): boolean {
    return this.#sendNotes;
  }

  set sendNotes(value: boolean) {
    this.#sendNotes = value;
    this.requestUpdate();
  }

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#load(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.#request++; }

  #announce(connection: VoiceConnection) {
    this.dispatchEvent(new CustomEvent<VoiceConnection>(VOICE_CONNECTION_EVENT, { detail: connection, bubbles: true, composed: true }));
  }

  async #load(manual = false) {
    const request = ++this.#request;
    if (manual) this.#checking = true;
    else this.#loading = true;
    this.requestUpdate();
    try {
      this.#connection = await loadVoiceConnection();
      if (request === this.#request) {
        this.#error = "";
        if (manual) this.#announce(this.#connection);
      }
    } catch (error) {
      if (request === this.#request) this.#error = error instanceof Error ? error.message : "VoiceStudio settings could not be loaded.";
    } finally {
      if (request === this.#request) {
        this.#loading = false;
        this.#checking = false;
        this.requestUpdate();
      }
    }
  }

  #submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    this.#saving = true;
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      this.#connection = await connectVoice({ url: String(data.get("url") ?? ""), apiKey: String(data.get("apiKey") ?? "") });
      this.#editing = false;
      this.#notice = `Connected to ${[this.#connection.service ?? "VoiceStudio", this.#connection.version].filter(Boolean).join(" ")}.`;
      form.reset();
      this.#announce(this.#connection);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "VoiceStudio could not be connected.";
    } finally {
      this.#saving = false;
      this.requestUpdate();
    }
  };

  async #disconnect() {
    this.#error = "";
    try {
      this.#connection = await disconnectVoice();
      this.#notice = "VoiceStudio disconnected. Its address and API key were removed from this machine.";
      this.#announce(this.#connection);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "VoiceStudio could not be disconnected.";
    }
    this.requestUpdate();
  }

  #renderForm(connection: VoiceConnection | undefined) {
    const reconnecting = Boolean(connection?.configured);
    return html`<form class="voice-settings__form" @submit=${this.#submit}>
      <ol class="voice-settings__steps">
        <li>Run <a href="https://github.com/debpalash/VoiceStudio" target="_blank" rel="noopener noreferrer">VoiceStudio ${icons.externalLink}</a> on this machine or on a GPU box you reach over Tailscale.</li>
        <li>On another machine, start it with an API key (<code>OMNIVOICE_API_KEY</code>) and serve it over HTTPS (Tailscale Serve), or reach it at its Tailscale address.</li>
        <li>Enter its address below. On this machine no key is needed.</li>
      </ol>
      <label class="field"><span>VoiceStudio address</span>
        <input class="input" name="url" required autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:3900" .value=${connection?.url ?? ""} /></label>
      <label class="field"><span>API key (optional)</span>
        <input class="input" name="apiKey" type="password" autocomplete="off" spellcheck="false"
          placeholder=${connection?.keySet ? "Leave empty to keep the saved key" : "OMNIVOICE_API_KEY of a remote VoiceStudio"} /></label>
      <p class="settings-row__desc">HUI checks VoiceStudio's discovery document and model list before saving. The key stays in <code>~/.config/hui/voicestudio.json</code> (readable by you only), never reaches the browser, and is sent only over HTTPS, to this machine or to a Tailscale address. Recordings and speech go only to this VoiceStudio; HUI stores no audio.</p>
      <div class="voice-settings__actions">
        <button type="submit" class="btn primary" ?disabled=${this.#saving}>${this.#saving ? "Testing…" : "Test & save"}</button>
        ${reconnecting ? html`<button type="button" class="btn" ?disabled=${this.#saving} @click=${() => { this.#editing = false; this.#error = ""; this.requestUpdate(); }}>Cancel</button>` : nothing}
      </div>
    </form>`;
  }

  override render() {
    const connection = this.#connection;
    const connected = connection?.configured === true;
    const status = this.#loading ? "Checking…" : connection ? voiceConnectionSummary(connection) : "";
    return html`
      <section class="settings-section" data-integration="voicestudio">
        <div class="settings-section__header"><div class="settings-section__copy">
          <h2 class="settings-section__heading">VoiceStudio</h2>
          <p class="settings-section__desc">Talk to bots: voice notes, read-aloud and calls through your own VoiceStudio speech service. ${connected ? "" : status}</p>
        </div></div>
        ${this.#error ? html`<p class="voice-settings__error" role="alert">${this.#error}</p>` : nothing}
        ${this.#notice ? html`<p class="voice-settings__notice" role="status">${this.#notice}</p>` : nothing}
        <div class="settings-group">
          ${this.#loading ? nothing : connected && !this.#editing ? html`
            <div class="settings-row">
              <div class="settings-row__text">
                <span class="settings-row__title voice-settings__address">${connection.url.replace(/^https?:\/\//u, "")}</span>
                <span class="settings-row__desc voice-settings__status" data-reachable=${String(connection.reachable ?? "unknown")}>${this.#checking ? "Checking…" : status}</span>
              </div>
              <div class="settings-row__control voice-settings__actions">
                <button type="button" class="btn btn--sm" ?disabled=${this.#checking} @click=${() => void this.#load(true)}>Check again</button>
                <button type="button" class="btn btn--sm" @click=${() => { this.#editing = true; this.#notice = ""; this.requestUpdate(); }}>Change</button>
                <button type="button" class="btn btn--sm danger" @click=${() => void this.#disconnect()}>Disconnect</button>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row__text">
                <span class="settings-row__title">Send voice notes immediately</span>
                <span class="settings-row__desc">A bot chat's microphone records a note and VoiceStudio writes it down. Off, the text waits in the composer for you to check; on, it is sent at once, marked [voice].</span>
              </div>
              <div class="settings-row__control">${renderSettingsToggle("Send voice notes immediately", this.#sendNotes, (on) => this.onSendNotes?.(on))}</div>
            </div>` : html`<div class="settings-row settings-row--stacked">${this.#renderForm(connection)}</div>`}
        </div>
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-voice-settings")) customElements.define("hui-voice-settings", HuiVoiceSettings);
