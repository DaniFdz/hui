/**
 * The Datadog section of Settings → Integrations: the orgs HUI reads Datadog links through (a pup session name and
 * the Datadog host its links use), their status, and pup's sign-in. Everything goes through the gateway's `pup`;
 * this view never sees a token. While a sign-in runs, the section polls for its result and, once it succeeds, tells
 * the chat's Datadog cards to load again.
 */
import { LitElement, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { DATADOG_APP_HOSTS, DATADOG_CLI_URL, DEFAULT_DATADOG_SITE, type DatadogConnection, type DatadogOrg, type DatadogOrgStatus } from "../../shared/datadog.ts";
import {
  addDatadogOrg,
  cancelDatadogLogin,
  DATADOG_CHANGED,
  datadogOrgLabel,
  datadogStatusLabel,
  loadDatadogConnection,
  notifyDatadogChanged,
  removeDatadogOrg,
  startDatadogLogin,
} from "../lib/datadog.ts";
import { icons } from "../lib/icons.ts";

const POLL_MS = 1_500;
const STATUS_LABELS: Record<DatadogOrgStatus["status"], string> = { connected: "Connected", signed_out: "Sign in needed", unknown: "Status unknown" };
const sameOrg = (a: DatadogOrg, b: DatadogOrg) => a.name === b.name && a.site === b.site;

export class HuiDatadogSettings extends LitElement {
  #connection?: DatadogConnection;
  #loading = true;
  #busy = false;
  #error = "";
  #notice = "";
  #name = "";
  #site = DEFAULT_DATADOG_SITE;
  #request = 0;
  #poll?: ReturnType<typeof setTimeout>;
  /** A sign-in finished from a chat card: show its org as connected. */
  readonly #changed = () => void this.#refresh();

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); window.addEventListener(DATADOG_CHANGED, this.#changed); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener(DATADOG_CHANGED, this.#changed); this.#request++; this.#stopPolling(); }

  #stopPolling() {
    if (this.#poll) clearTimeout(this.#poll);
    this.#poll = undefined;
  }

  /** Applies a gateway view; keeps polling while pup waits for the browser. */
  #apply(next: DatadogConnection) {
    const previous = this.#connection?.login;
    this.#connection = next;
    if (previous?.phase === "pending" && next.login.phase === "idle") {
      const org = next.orgs.find((entry) => sameOrg(entry, previous.org));
      if (org?.status === "connected") {
        this.#notice = `Signed in to ${datadogOrgLabel(org)}.`;
        notifyDatadogChanged();
      }
    }
    this.#stopPolling();
    if (next.login.phase === "pending") this.#poll = setTimeout(() => void this.#refresh(), POLL_MS);
  }

  async #refresh() {
    const request = ++this.#request;
    try {
      const next = await loadDatadogConnection();
      if (request !== this.#request) return;
      this.#apply(next);
      this.#error = "";
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "Datadog status could not be loaded.";
      // A dropped poll must not strand a pending sign-in on screen.
      if (this.#connection?.login.phase === "pending") this.#poll = setTimeout(() => void this.#refresh(), POLL_MS * 2);
    } finally {
      if (request === this.#request) { this.#loading = false; this.requestUpdate(); }
    }
  }

  /** `changesOrgs`: an add or a removal, after which the chat's cards load again. */
  async #run(action: () => Promise<DatadogConnection>, notice = "", changesOrgs = false) {
    const request = ++this.#request;
    this.#stopPolling();
    this.#busy = true;
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      const next = await action();
      if (request !== this.#request) return false;
      this.#apply(next);
      this.#notice = notice;
      if (changesOrgs) notifyDatadogChanged();
      return true;
    } catch (error) {
      if (request === this.#request) {
        this.#error = error instanceof Error ? error.message : "The Datadog request failed.";
        void this.#refresh();
      }
      return false;
    } finally {
      this.#busy = false;
      this.requestUpdate();
    }
  }

  async #add(event: SubmitEvent) {
    event.preventDefault();
    const org = { name: this.#name.trim(), site: this.#site.trim() };
    if (await this.#run(() => addDatadogOrg(org), `Added ${datadogOrgLabel(org)}.`, true)) {
      this.#name = "";
      this.#site = DEFAULT_DATADOG_SITE;
      this.requestUpdate();
    }
  }

  /** Picking one of pup's own session names fills in its site. */
  #onName(value: string) {
    this.#name = value;
    const matches = this.#connection?.pupOrgs.filter((org) => org.name === value.trim()) ?? [];
    if (matches.length === 1) this.#site = matches[0]!.site;
    this.requestUpdate();
  }

  #renderStatus(connection: DatadogConnection | undefined) {
    const { kind, label } = datadogStatusLabel(this.#loading ? undefined : connection);
    return html`<span class="settings-status ${kind === "muted" ? "" : `settings-status--${kind}`}" data-datadog-status=${kind}><span class="settings-status__dot" aria-hidden="true"></span>${label}</span>`;
  }

  #renderLogin(connection: DatadogConnection) {
    const login = connection.login;
    if (login.phase === "pending") {
      return html`<div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__title">Signing in to ${datadogOrgLabel(login.org)}</span>
          <span class="settings-row__desc" role="status">Approve the sign-in in your browser… pup opened it on the computer running HUI and waits up to five minutes.</span>
        </div>
        <div class="settings-row__control jira-settings__actions">
          ${login.url ? html`<a class="btn primary btn--sm" href=${login.url} target="_blank" rel="noopener noreferrer">Open sign-in page ${icons.externalLink}</a>` : nothing}
          <button type="button" class="btn btn--sm" ?disabled=${this.#busy} @click=${() => void this.#run(cancelDatadogLogin)}>Cancel</button>
        </div>
      </div>`;
    }
    if (login.phase === "failed") {
      return html`<div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__title">Sign-in to ${datadogOrgLabel(login.org)} did not finish</span>
          <span class="settings-row__desc datadog-settings__failure" role="alert">${login.message}</span>
        </div>
        <div class="settings-row__control jira-settings__actions">
          <button type="button" class="btn btn--sm" ?disabled=${this.#busy} @click=${() => void this.#run(() => startDatadogLogin(login.org))}>Try again</button>
          <button type="button" class="btn btn--sm" ?disabled=${this.#busy} @click=${() => void this.#run(cancelDatadogLogin)}>Dismiss</button>
        </div>
      </div>`;
    }
    return nothing;
  }

  #renderOrg(connection: DatadogConnection, org: DatadogOrgStatus) {
    const label = datadogOrgLabel(org);
    const signingIn = connection.login.phase === "pending";
    return html`<div class="settings-row" data-datadog-org=${`${org.site}/${org.name}`}>
      <div class="settings-row__text">
        <span class="settings-row__title">${org.name || "Default session"}</span>
        <span class="settings-row__desc">${org.site} · <span class="datadog-settings__status" data-status=${org.status}>${STATUS_LABELS[org.status]}</span></span>
      </div>
      <div class="settings-row__control jira-settings__actions">
        ${org.status === "signed_out" && connection.cli.installed
          ? html`<button type="button" class="btn primary btn--sm" ?disabled=${this.#busy || signingIn} @click=${() => void this.#run(() => startDatadogLogin(org))}>Sign in</button>`
          : nothing}
        <button type="button" class="btn btn--sm" aria-label=${`Remove ${label}`} ?disabled=${this.#busy} @click=${() => void this.#run(() => removeDatadogOrg(org), `Removed ${label} from HUI. pup keeps its session.`, true)}>Remove</button>
      </div>
    </div>`;
  }

  #renderForm(connection: DatadogConnection) {
    const names = [...new Set(connection.pupOrgs.map((org) => org.name).filter(Boolean))];
    return html`<form class="settings-row datadog-settings__form" @submit=${(event: SubmitEvent) => void this.#add(event)}>
      <label class="field"><span>Org name</span>
        <input class="input" name="name" list="datadog-pup-orgs" autocomplete="off" spellcheck="false" maxlength="100"
          placeholder="prod" .value=${live(this.#name)} @input=${(event: Event) => this.#onName((event.target as HTMLInputElement).value)} /></label>
      <label class="field"><span>Site</span>
        <input class="input" name="site" list="datadog-sites" autocomplete="off" spellcheck="false" required
          .value=${live(this.#site)} @input=${(event: Event) => { this.#site = (event.target as HTMLInputElement).value; }} /></label>
      <datalist id="datadog-pup-orgs">${names.map((name) => html`<option value=${name}></option>`)}</datalist>
      <datalist id="datadog-sites">${DATADOG_APP_HOSTS.map((host) => html`<option value=${host}></option>`)}</datalist>
      <button type="submit" class="btn btn--sm" ?disabled=${this.#busy || connection.login.phase === "pending"}>Add org</button>
      <p class="settings-row__desc datadog-settings__hint">The org name is pup's session name (<code>pup auth login --org &lt;name&gt;</code>); leave it empty for pup's default session. The site is the host in your Datadog links.</p>
    </form>`;
  }

  #renderBody(connection: DatadogConnection) {
    if (!connection.cli.installed) {
      return html`<div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__title">Datadog CLI not found</span>
          <span class="settings-row__desc">HUI signs in and reads Datadog through <code>pup</code> on the machine running the HUI gateway. Install it, make sure it is on the gateway's <code>PATH</code>, then check again.</span>
        </div>
        <div class="settings-row__control jira-settings__actions">
          <a class="btn btn--sm" href=${DATADOG_CLI_URL} target="_blank" rel="noopener noreferrer">Install pup ${icons.externalLink}</a>
          <button type="button" class="btn btn--sm" @click=${() => void this.#refresh()}>Check again</button>
        </div>
      </div>`;
    }
    return html`
      ${this.#renderLogin(connection)}
      ${connection.orgs.length
        ? connection.orgs.map((org) => this.#renderOrg(connection, org))
        : html`<div class="settings-row"><div class="settings-row__text">
            <span class="settings-row__title">No orgs yet</span>
            <span class="settings-row__desc">Share links preview without one. Add the pup orgs whose dashboard links HUI should draw; a link tries the orgs of its site in this order.</span>
          </div></div>`}
      ${this.#renderForm(connection)}`;
  }

  override render() {
    const connection = this.#connection;
    return html`
      <section class="settings-section" data-integration="datadog">
        <div class="settings-section__header"><div class="settings-section__copy">
          <h2 class="settings-section__heading">Datadog</h2>
          <p class="settings-section__desc">Chat cards for Datadog share links and dashboard widgets come from the Datadog CLI (<code>pup</code>) of the machine running HUI. Tokens stay in pup; HUI keeps only org names and sites.</p>
        </div>
        <div class="settings-section__actions">${this.#renderStatus(connection)}</div></div>
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        ${this.#notice ? html`<p class="jira-settings__notice" role="status">${this.#notice}</p>` : nothing}
        <div class="settings-group">${this.#loading || !connection ? nothing : this.#renderBody(connection)}</div>
      </section>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-datadog-settings")) customElements.define("hui-datadog-settings", HuiDatadogSettings);
