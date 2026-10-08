/**
 * The Slack section of Settings → Integrations (HUI-18, Slack triggers). Owns only this section: the connection's
 * status, the steps to create the Slack app from HUI's manifest, a masked token field (write-only: the gateway never
 * returns the token), Connect, which the gateway verifies with Slack's auth.test, and Disconnect.
 */
import { LitElement, html, nothing } from "lit";
import { SLACK_APPS_URL, SLACK_USER_SCOPES, slackManifestJson, type SlackConnection } from "../../shared/slack.ts";
import { writeClipboardText } from "../lib/clipboard.ts";
import { icons } from "../lib/icons.ts";
import { connectSlack, disconnectSlack, loadSlackConnection, slackHost, slackStatusLabel } from "../lib/slack.ts";

/** How often the open section reads the connection again: the Slack poller's last read moves by itself. */
const REFRESH_MS = 20_000;

/** `just now`, `3 min ago`, `2 h ago`. */
function ago(at: string | undefined, now = Date.now()): string {
  const time = Date.parse(at ?? "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1_000));
  if (seconds < 45) return "just now";
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  return `${Math.round(seconds / 3_600)} h ago`;
}

export class HuiSlackSettings extends LitElement {
  #connection?: SlackConnection;
  #loading = true;
  #saving = false;
  #replacing = false;
  #error = "";
  #notice = "";
  #copied = false;
  #request = 0;
  #timer?: ReturnType<typeof setInterval>;

  override createRenderRoot() { return this; }
  override connectedCallback() {
    super.connectedCallback();
    void this.#load(true);
    this.#timer = setInterval(() => { if (!this.#saving) void this.#load(false); }, REFRESH_MS);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#request++;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #load(verify: boolean) {
    const request = ++this.#request;
    try {
      const next = await loadSlackConnection(verify);
      if (request !== this.#request) return;
      this.#connection = next;
      this.#error = "";
    } catch (error) {
      if (request === this.#request) this.#error = error instanceof Error ? error.message : "Slack settings could not be loaded.";
    } finally {
      if (request === this.#request) { this.#loading = false; this.requestUpdate(); }
    }
  }

  #submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const token = String(new FormData(form).get("token") ?? "");
    const request = ++this.#request;
    this.#saving = true;
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      const next = await connectSlack(token);
      form.reset();
      if (request !== this.#request) return;
      this.#connection = next;
      this.#replacing = false;
      this.#notice = `${next.message} The token is saved on this machine only.`;
    } catch (error) {
      if (request === this.#request) this.#error = error instanceof Error ? error.message : "Slack could not be connected.";
    } finally {
      this.#saving = false;
      this.requestUpdate();
    }
  };

  async #disconnect() {
    const request = ++this.#request;
    this.#error = "";
    try {
      const next = await disconnectSlack();
      if (request !== this.#request) return;
      this.#connection = next;
      this.#replacing = false;
      this.#notice = "Slack disconnected. The token was removed from this machine; Slack triggers stop reading until you connect again.";
    } catch (error) {
      if (request === this.#request) this.#error = error instanceof Error ? error.message : "Slack could not be disconnected.";
    }
    this.requestUpdate();
  }

  async #copyManifest() {
    this.#copied = await writeClipboardText(slackManifestJson());
    this.requestUpdate();
  }

  #renderStatus() {
    const { kind, label } = slackStatusLabel(this.#loading ? undefined : this.#connection);
    return html`<span class="settings-status ${kind === "muted" ? "" : `settings-status--${kind}`}" data-slack-status=${kind}><span class="settings-status__dot" aria-hidden="true"></span>${label}</span>`;
  }

  #renderForm(connection: SlackConnection | undefined) {
    const replacing = Boolean(connection?.configured);
    return html`<form class="jira-settings__form slack-settings__form" @submit=${this.#submit}>
      ${replacing ? nothing : html`<ol class="jira-settings__steps">
        <li>Open <a href=${SLACK_APPS_URL} target="_blank" rel="noopener noreferrer">Slack apps ${icons.externalLink}</a>, choose <strong>Create New App → From a manifest</strong>, pick your workspace and paste HUI's manifest. It asks for read-only user scopes and has no bot.
          <div class="slack-settings__manifest"><button type="button" class="btn btn--sm slack-settings__copy" @click=${() => void this.#copyManifest()}>${this.#copied ? icons.check : icons.copy}<span>${this.#copied ? "Copied" : "Copy manifest"}</span></button></div></li>
        <li>Choose <strong>Install to Workspace</strong> and allow it. Many company workspaces need an admin to approve apps first; Slack then asks you to request it.</li>
        <li>Copy the <strong>User OAuth Token</strong> (it starts with <code>xoxp-</code>) from <strong>OAuth &amp; Permissions</strong> and paste it below.</li>
      </ol>`}
      <label class="field"><span>User OAuth Token</span>
        <input class="input" name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="xoxp-…" /></label>
      <p class="settings-row__desc">HUI checks the token with Slack, then keeps it only in <code>~/.config/hui/slack.json</code> (readable by you only). It is never sent to the browser or to any host but Slack.</p>
      <div class="jira-settings__actions">
        <button type="submit" class="btn primary" ?disabled=${this.#saving}>${this.#saving ? "Checking…" : replacing ? "Connect this token" : "Connect Slack"}</button>
        ${replacing && connection?.status !== "revoked" ? html`<button type="button" class="btn" @click=${() => { this.#replacing = false; this.requestUpdate(); }}>Cancel</button>` : nothing}
      </div>
    </form>`;
  }

  #renderConnected(connection: SlackConnection) {
    const host = slackHost(connection.url);
    const watch = connection.watch;
    const reading = connection.status === "revoked" ? "Slack triggers wait until you connect again."
      : watch.error ? watch.error
        : watch.active ? (watch.polledAt ? `Slack read ${ago(watch.polledAt)}.` : "Reading starts in a moment.")
          : "Not reading: no enabled Slack trigger (or bots are off).";
    const status = connection.status === "revoked" ? "Token revoked or expired: connect again." : connection.message;
    return html`
      <div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__title">${connection.team || connection.teamId || "Slack"}${host ? html` <span class="slack-settings__host">· ${host}</span>` : nothing}</span>
          ${connection.status === "connected" ? nothing : html`<span class="settings-row__desc slack-settings__problem" data-slack-message>${status}</span>`}
          <span class="settings-row__desc">${connection.user ? `@${connection.user}` : connection.userId ?? ""}${connection.checkedAt ? ` · checked ${ago(connection.checkedAt)}` : ""} · ${reading}</span>
        </div>
        <div class="settings-row__control jira-settings__actions">
          <button type="button" class="btn btn--sm" @click=${() => { this.#replacing = true; this.#notice = ""; this.requestUpdate(); }}>${connection.status === "revoked" ? "Connect again" : "Replace token"}</button>
          <button type="button" class="btn btn--sm danger" @click=${() => void this.#disconnect()}>Disconnect</button>
        </div>
      </div>`;
  }

  override render() {
    const connection = this.#connection;
    const connected = connection?.configured === true;
    return html`
      <section class="settings-section" data-integration="slack">
        <div class="settings-section__header"><div class="settings-section__copy">
          <h2 class="settings-section__heading">Slack</h2>
          <p class="settings-section__desc">Bots' Slack triggers wake on the messages that mention you or are sent to you, read as you about once a minute through a Slack app you create in your own workspace. Read-only: HUI never posts, reacts or edits in Slack.</p>
        </div>
        <div class="settings-section__actions">${this.#renderStatus()}</div></div>
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        ${this.#notice ? html`<p class="jira-settings__notice" role="status">${this.#notice}</p>` : nothing}
        <div class="settings-group">
          ${this.#loading ? nothing : html`
            ${connected ? this.#renderConnected(connection) : nothing}
            ${!connected || this.#replacing || connection.status === "revoked" ? html`<div class="settings-row settings-row--stacked">${this.#renderForm(connection)}</div>` : nothing}
            <details class="settings-row settings-row--stacked slack-settings__scopes">
              <summary class="settings-row__title">What HUI may read, and why</summary>
              <ul class="slack-settings__scope-list">${SLACK_USER_SCOPES.map((entry) => html`<li><code>${entry.scope}</code> ${entry.why}</li>`)}</ul>
            </details>`}
        </div>
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-slack-settings")) customElements.define("hui-slack-settings", HuiSlackSettings);
