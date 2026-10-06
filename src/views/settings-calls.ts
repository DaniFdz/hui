import { LitElement, html, nothing } from "lit";
import { GPT_LIVE_VOICES, gptLiveVoiceLabel, type CallEngine, type CallsStatus, type GptLiveVoice } from "../../shared/calls.ts";
import type { Settings } from "../lib/settings.ts";
import { loadCallsStatus } from "../lib/live-call-platform.ts";
import { renderSettingsPicker } from "./settings-picker.ts";

const ENGINES: readonly { value: CallEngine; label: string }[] = [
  { value: "gpt-live", label: "GPT-Live (ChatGPT subscription)" },
  { value: "voicestudio", label: "VoiceStudio (speech chain)" },
];

/** "Signed in as Account 2 (dani@example.com)", or why calls cannot use ChatGPT now. */
export function chatGptLoginSummary(status: CallsStatus["chatgpt"] | undefined, now = Date.now()): string {
  if (!status) return "Checking the ChatGPT login…";
  if (status.account) return `Calls use ${status.account.name}${status.account.email ? ` (${status.account.email})` : ""}, the first ChatGPT account not waiting for its quota.`;
  if (status.signedIn && status.waitingUntil && status.waitingUntil > now) return `Every ChatGPT account is waiting for its quota until ${new Date(status.waitingUntil).toLocaleString()}.`;
  return "No ChatGPT login yet. Sign in under Providers above: OpenAI Codex, with your ChatGPT Plus or Pro account.";
}

/**
 * Settings → Models → Calls (HUI-18): how calls with bots run, GPT-Live's default voice, and which ChatGPT login
 * calls use. The page passes the setting in and saves it; the login status comes from `/__hui/calls` and never
 * carries a token.
 */
export class HuiCallSettings extends LitElement {
  #calls: Settings["calls"] = { engine: "voicestudio", voice: "cove" };
  #status: CallsStatus | undefined;
  #error = "";
  #request = 0;
  onChange: ((next: Settings["calls"]) => void) | undefined;

  get calls(): Settings["calls"] { return this.#calls; }
  set calls(value: Settings["calls"]) {
    this.#calls = value;
    this.requestUpdate();
  }

  override createRenderRoot() { return this; }
  override connectedCallback() {
    super.connectedCallback();
    // A sign-in or sign-out in Providers changes which account calls use.
    window.addEventListener("providers-changed", this.#refresh);
    void this.#load();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("providers-changed", this.#refresh);
    this.#request++;
  }

  readonly #refresh = () => { void this.#load(); };

  async #load() {
    const request = ++this.#request;
    try {
      const status = await loadCallsStatus();
      if (request !== this.#request) return;
      this.#status = status;
      this.#error = "";
    } catch (error) {
      if (request === this.#request) this.#error = error instanceof Error ? error.message : "The ChatGPT login could not be read.";
    }
    this.requestUpdate();
  }

  #set(next: Partial<Settings["calls"]>) {
    this.onChange?.({ ...this.#calls, ...next });
  }

  override render() {
    const calls = this.#calls;
    const live = calls.engine === "gpt-live";
    const chatgpt = this.#status?.chatgpt;
    const options = GPT_LIVE_VOICES.map((voice) => ({ value: voice, label: `${gptLiveVoiceLabel(voice)}${voice === "cove" ? " (GPT-Live's default)" : ""}` }));
    return html`<section class="settings-section hui-call-settings">
      <div class="settings-section__header"><div class="settings-section__copy">
        <h2 class="settings-section__heading">Calls</h2>
        <p class="settings-section__desc">How calls with bots run. GPT-Live talks in real time through your ChatGPT subscription; the bot's utility model answers its quick questions and real work goes to the bot's chat. VoiceStudio is the speech chain through your own VoiceStudio.</p>
      </div></div>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row__text"><span class="settings-row__title">Conversation model</span>
            <span class="settings-row__desc">Made for phone calls: quick to respond. ${live
              ? "GPT-Live's audio goes to OpenAI under your ChatGPT account; each call ends as one card in the bot's chat."
              : "Your VoiceStudio transcribes and speaks; every sentence is a turn of the bot."}</span></div>
          <div class="settings-row__control">${renderSettingsPicker("Conversation model", calls.engine, ENGINES, (value) => this.#set({ engine: value as CallEngine }))}</div>
        </div>
        <div class="settings-row">
          <div class="settings-row__text"><span class="settings-row__title">Default GPT-Live voice</span>
            <span class="settings-row__desc">For bots without a call voice of their own (set one in a bot's dialog).</span></div>
          <div class="settings-row__control">${renderSettingsPicker("Default GPT-Live voice", calls.voice, options, (value) => this.#set({ voice: value as GptLiveVoice }))}</div>
        </div>
        <div class="settings-row">
          <div class="settings-row__text"><span class="settings-row__title">ChatGPT login</span>
            <span class="settings-row__desc hui-call-settings__login" data-ready=${String(Boolean(chatgpt?.account))} role=${this.#error ? "alert" : nothing}>${this.#error || chatGptLoginSummary(chatgpt)}</span></div>
          <div class="settings-row__control"><button type="button" class="btn btn--sm" @click=${this.#refresh}>Check again</button></div>
        </div>
      </div>
    </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-call-settings")) customElements.define("hui-call-settings", HuiCallSettings);
