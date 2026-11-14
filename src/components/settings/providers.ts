/**
 * Settings → Models → Providers: the model providers the gateway can sign in to and the setup wizard that connects
 * one (provider → account → sign-in → model → check), plus the models chosen per provider, account priority and
 * quotas, all through `/__hui/providers`. A sign-in or sign-out is announced with a `providers-changed` event so
 * sections that depend on a login can refresh. The folded local model servers group shares this section, so the
 * Models page has one provider area.
 */
import { LitElement, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { ProviderLogin, ProviderLoginFlow, ProviderQuota, ProviderSnapshot, ProviderSummary, ProviderTest } from "../../api/schema/providers.ts";
import { loadProviderQuota, loadProviders, providerRequest, startProviderLogin, testProviderModel } from "../../api/providers.ts";
import { renderProviderBrandIcon } from "../../lib/provider-icons.ts";
import { writeClipboardText } from "../../lib/clipboard.ts";
import {
  alternateFlow,
  brandHint,
  connectionMethods,
  connectionName,
  defaultFlow,
  expiresInMinutes,
  filterModels,
  flowSwitchLabel,
  loginFailure,
  manualEntryCopy,
  modelsForStep,
  providerBrand,
  providerBrands,
  signInHost,
  testFailure,
  type ModelUseReport,
  type ProviderBrand,
} from "../../lib/provider-choices.ts";
import { loadViewAssets } from "../../lib/view-assets.ts";
import { renderPicker } from "../../views/settings-picker.ts";

loadViewAssets(() => import("../../styles/providers.css"));
type AccountDrag = { provider: string; id: string; name: string; order: string[]; from: number; to: number; handle: HTMLElement; pointer?: number; y: number; startY: number; moved: boolean };
type ModelDraft = { models: Set<string>; query: string };
/** The wizard's screens. A sign-in's own state comes from the gateway's login payload, not from a step. */
type WizardStep = "provider" | "account" | "signin" | "model" | "checking" | "verified" | "test-failed";

export class HuiProviderSettings extends LitElement {
  /** Fills the model roles new sessions use with the model this check verified. Without it, only the provider's own
   * model selection is saved. */
  onUseModel: ((target: string) => ModelUseReport | void) | undefined;
  /** Opens New Session the way the app's own New Session control does. */
  onStartChat: (() => void) | undefined;
  #snapshot?: ProviderSnapshot;
  #drag?: AccountDrag;
  #dragFrame = 0;
  #dragNotice = "";
  #step: WizardStep = "provider";
  #brand = "";
  #providerId = "";
  #method: "oauth" | "api_key" = "oauth";
  #flow: ProviderLoginFlow | "" = "";
  #attempt = "";
  #completed = "";
  /** The gateway stopped holding the sign-in this dialog started (it restarted, or the start's own read failed), so
   * the step says so instead of spinning on "Starting…" forever. */
  #ended = false;
  #accountId?: string;
  #accountName = "";
  #providerQuery = "";
  #modelQuery = "";
  #chosen = "";
  #check?: ProviderTest;
  #report?: ModelUseReport;
  #confirmClose = false;
  #manualOpen = false;
  #startedAt = 0;
  #copied = "";
  #copiedTimer?: ReturnType<typeof setTimeout>;
  #busy = false;
  #error = "";
  #notice = "";
  #confirm = "";
  #drafts = new Map<string, ModelDraft>();
  #quotas = new Map<string, ProviderQuota>();
  #quotaLoading = new Set<string>();
  #poll?: ReturnType<typeof setTimeout>;
  #generation = 0;
  /** The screen whose first control already got focus, so polling never moves it. */
  #focusedScreen = "";
  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.#endDrag(false); clearTimeout(this.#poll); clearTimeout(this.#copiedTimer); this.#generation++; }
  #dialog() { return this.querySelector<HTMLDialogElement>(".hui-provider-dialog:not(.hui-local-provider-dialog)"); }
  override updated() {
    const dialog = this.#dialog();
    // A new step replaces the focused button. Move focus to its first control and
    // keep keyboard input (including Escape) inside the modal at every other time.
    if (dialog?.open && (this.#screen() !== this.#focusedScreen || !dialog.contains(document.activeElement))) this.#focusFirst(dialog);
  }
  #screen() { return `${this.#step}|${this.#confirmClose}`; }
  #focusFirst(dialog: HTMLDialogElement) {
    this.#focusedScreen = this.#screen();
    // A closed disclosure hides its paste field; never move focus into it.
    const candidates = [...dialog.querySelectorAll<HTMLElement>('input, .hui-provider-choice, [role="radio"], .btn')]
      .filter((element) => element.offsetParent !== null && !(element as HTMLButtonElement).disabled);
    const target = candidates.find((element) => element.matches('input, .hui-provider-choice, [role="radio"]'))
      ?? candidates.find((element) => element.classList.contains("primary"))
      ?? candidates[0];
    target?.focus();
  }
  #changed() { this.dispatchEvent(new CustomEvent("providers-changed", { bubbles: true, composed: true })); }
  #schedule() {
    clearTimeout(this.#poll);
    if (this.isConnected && this.#snapshot?.login?.phase === "pending") this.#poll = setTimeout(() => void this.#refresh(), 1200);
  }
  #origin() { return globalThis.location?.origin ?? ""; }
  #providers(): readonly ProviderSummary[] { return this.#snapshot?.providers ?? []; }
  #provider(): ProviderSummary | undefined { return this.#providers().find((provider) => provider.id === this.#providerId); }
  #brandInfo(): ProviderBrand | undefined {
    return providerBrands.find((brand) => brand.id === this.#brand) ?? providerBrand(this.#providerId);
  }
  /** The login this dialog owns; a stopped one from an earlier visit is not shown again. */
  #currentLogin(): ProviderLogin | undefined {
    const login = this.#snapshot?.login;
    return login && login.id === this.#attempt ? login : undefined;
  }
  #showDialog() {
    const dialog = this.#dialog();
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    this.#focusFirst(dialog);
  }
  async #refresh() {
    const generation = this.#generation;
    try {
      const next = await loadProviders();
      if (generation !== this.#generation || !this.isConnected) return;
      this.#snapshot = next;
      this.#error = "";
      const login = next.login;
      // A reload (or a sign-in that finished while Settings was elsewhere) resumes the host's login: a pending one
      // reopens the sign-in step, a completed one continues with the model step so its model is saved.
      if (login && login.id !== this.#attempt && (login.phase === "pending" || login.phase === "complete")) await this.#adopt(login);
      else if (login && login.id === this.#attempt) {
        if (login.phase === "pending") this.#step = "signin";
        if (login.phase === "complete" && this.#step === "signin") this.#enterModels(login);
      } else if (this.#attempt && this.#step === "signin" && !this.#busy) {
        // The snapshot no longer carries this sign-in: the gateway restarted or dropped it. Polling stops here, so the
        // step must not keep promising a start that already happened.
        this.#attempt = "";
        this.#ended = true;
      }
      for (const provider of next.providers) {
        if (provider.configured && provider.authenticated) {
          for (const account of provider.accounts ?? []) if (account.authenticated && !this.#quotas.has(`${provider.id}/accounts/${account.id}`)) void this.#loadQuota(`${provider.id}/accounts/${account.id}`);
        }
      }
    } catch (error) { if (generation === this.#generation) this.#error = error instanceof Error ? error.message : "Providers could not be loaded."; }
    finally { if (generation === this.#generation && this.isConnected) { this.#schedule(); this.requestUpdate(); } }
  }
  /** Takes over a login the snapshot reports, so a reload lands on the same screen the operator left. */
  async #adopt(login: ProviderLogin) {
    this.#attempt = login.id;
    this.#providerId = login.provider;
    this.#brand = providerBrand(login.provider)?.id ?? login.provider;
    this.#flow = login.flow ?? "";
    // A resumed login no longer says which method started it; only an OAuth flow is recorded.
    this.#method = login.flow ? "oauth" : "api_key";
    this.#startedAt = Date.now();
    this.#ended = false;
    this.#step = "signin";
    this.requestUpdate();
    await this.updateComplete;
    this.#showDialog();
    if (login.phase === "complete") this.#enterModels(login);
  }
  /** The sign-in succeeded: the account exists, so the wizard always continues with one model preselected. */
  #enterModels(login: ProviderLogin) {
    const provider = this.#providers().find((entry) => entry.id === login.provider);
    if (!provider?.authenticated) return;
    this.#completed = login.id;
    // Remember the account this sign-in created: saving the model clears the gateway's login, so every later check of
    // this sign-in reads it from here instead of falling back to the provider's first account.
    if (login.accountId) this.#accountId = login.accountId;
    this.#chosen = modelsForStep(provider.models, provider.selected, this.#chosen).selected;
    this.#check = undefined;
    this.#report = undefined;
    this.#confirmClose = false;
    this.#step = "model";
    this.#error = "";
    this.requestUpdate();
  }
  async #mutate(path: string, method: string, body?: unknown, notice = "") {
    clearTimeout(this.#poll);
    this.#busy = true; this.#error = ""; this.#notice = ""; this.requestUpdate();
    let success = false;
    try {
      await providerRequest(path, method, body);
      this.#notice = notice;
      await this.#refresh();
      this.#changed();
      success = true;
    } catch (error) { this.#error = error instanceof Error ? error.message : "Provider operation failed."; }
    finally { this.#busy = false; this.#schedule(); this.requestUpdate(); }
    return success;
  }
  async #open(brand = "", providerId = "", accountId?: string) {
    this.#step = providerId ? "account" : "provider";
    this.#brand = brand; this.#providerId = providerId; this.#accountId = accountId;
    this.#accountName = providerId === "opencode-go" && accountId ? this.#accountLabelById(providerId, accountId) : "";
    this.#providerQuery = ""; this.#modelQuery = ""; this.#chosen = ""; this.#check = undefined; this.#report = undefined;
    this.#attempt = ""; this.#completed = ""; this.#flow = ""; this.#method = "oauth"; this.#manualOpen = false; this.#ended = false;
    this.#confirm = ""; this.#confirmClose = false; this.#error = ""; this.#notice = ""; this.#copied = "";
    this.requestUpdate(); await this.updateComplete; this.#showDialog();
  }
  #accountLabelById(providerId: string, accountId: string) {
    return this.#providers().find((provider) => provider.id === providerId)?.accounts?.find((account) => account.id === accountId)?.name ?? "";
  }
  #dismiss() {
    this.#dialog()?.close();
    this.#step = "provider"; this.#brand = ""; this.#providerId = ""; this.#accountId = undefined; this.#accountName = "";
    this.#providerQuery = ""; this.#modelQuery = ""; this.#chosen = ""; this.#check = undefined; this.#report = undefined;
    this.#attempt = ""; this.#completed = ""; this.#flow = ""; this.#confirmClose = false; this.#manualOpen = false; this.#ended = false;
    this.#error = ""; this.#copied = ""; this.requestUpdate();
    void this.updateComplete.then(() => this.#focusOpener());
  }
  /** Returns focus to the control that opened the wizard. The empty state's own button disappears once the first
   * provider is added, so the page's header button takes its place instead of focus falling to the page. */
  #focusOpener() {
    if (!this.isConnected || this.#dialog()?.open) return;
    const opener = this.querySelector<HTMLElement>(".hui-provider-empty .btn")
      ?? this.querySelector<HTMLElement>(".settings-section__header .btn");
    opener?.focus();
  }
  async #close() {
    if (this.#busy) return;
    const login = this.#currentLogin();
    if (login?.phase === "pending") {
      this.#confirmClose = true; this.#error = ""; this.requestUpdate();
      await this.updateComplete;
      this.querySelector<HTMLElement>(".hui-provider-confirm .btn.primary")?.focus();
      return;
    }
    if (!await this.#saveCompleted()) return;
    this.#dismiss();
  }
  #escape(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.#confirmClose) { this.#confirmClose = false; this.requestUpdate(); return; }
    void this.#close();
  }
  /** Writes the model selection a completed sign-in chose and reveals the card it configures. A provider that already
   * had models keeps them all and gains this one; a new connection saves exactly one. A completed sign-in is always
   * written, even when its selection is already saved, because that write is what clears it on the gateway. */
  async #persistModels(step: ReturnType<typeof modelsForStep>): Promise<boolean> {
    const provider = this.#provider();
    if (!provider || !step.saved.length) return true;
    const same = provider.selected.length === step.saved.length && step.saved.every((id) => provider.selected.includes(id));
    if (same && !this.#completed) return true;
    try {
      await providerRequest(provider.id, "PUT", { models: step.saved });
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The model selection could not be saved. Try again.";
      return false;
    }
    this.#completed = "";
    this.#notice = `${connectionName(provider)} added. You can change its models any time.`;
    const refreshed = await loadProviders().then((next) => next, () => undefined);
    this.#changed();
    // The selection is saved. A refresh that fails is reported on its own, so it is never mistaken for the write.
    if (!refreshed) {
      this.#error = "The model selection is saved, but the provider list could not be refreshed.";
      return false;
    }
    this.#snapshot = refreshed;
    this.querySelector("details.hui-provider-configuration")?.setAttribute("open", "");
    return true;
  }
  /** Saves the model after a completed sign-in before the dialog leaves it. A failed write keeps the dialog open so
   * it can be retried, and a completed sign-in always saves at least the one model it holds. */
  async #saveCompleted(): Promise<boolean> {
    if (!this.#completed) return true;
    const provider = this.#provider();
    if (!provider) return true;
    const step = modelsForStep(provider.models, provider.selected, this.#chosen);
    if (!step.saved.length) return true;
    this.#busy = true; this.#error = ""; this.requestUpdate();
    try { return await this.#persistModels(step); }
    finally { this.#busy = false; this.requestUpdate(); }
  }
  async #start(providerId: string, method: "oauth" | "api_key", flowOverride?: ProviderLoginFlow) {
    clearTimeout(this.#poll);
    const flow = method === "oauth" ? flowOverride ?? defaultFlow(providerId, this.#origin()) : undefined;
    this.#providerId = providerId; this.#method = method; this.#flow = flow ?? "";
    this.#chosen = ""; this.#check = undefined; this.#report = undefined; this.#confirmClose = false; this.#manualOpen = false; this.#ended = false;
    this.#step = "signin"; this.#startedAt = Date.now(); this.#error = ""; this.#busy = true; this.#copied = ""; this.requestUpdate();
    const name = this.#accountName.trim();
    try {
      const login = await startProviderLogin(providerId, { method, ...(flow ? { flow } : {}), ...(name ? { name } : {}), ...(this.#accountId ? { accountId: this.#accountId } : {}) });
      this.#attempt = login.id;
      await this.#refresh();
    } catch (error) {
      this.#attempt = "";
      this.#step = "account";
      this.#error = error instanceof Error ? error.message : "Sign-in could not start. Try again.";
    } finally { this.#busy = false; this.#schedule(); this.requestUpdate(); }
  }
  /** Restarts this provider's sign-in with another flow when asked for one, otherwise with the flow it was using. */
  async #restart(flow?: ProviderLoginFlow) {
    const login = this.#currentLogin();
    if (login?.phase === "pending" && !await this.#mutate(`login/${login.id}`, "DELETE")) return;
    await this.#start(this.#providerId, this.#method, flow ?? (this.#flow || undefined));
  }
  async #answer(login: ProviderLogin, prompt: NonNullable<ProviderLogin["prompt"]>, value: string) {
    await this.#mutate(`login/${login.id}`, "POST", { promptId: prompt.id, value });
  }
  async #cancelSignIn() {
    const login = this.#currentLogin();
    if (login?.phase !== "pending") return;
    await this.#mutate(`login/${login.id}`, "DELETE");
  }
  /** Cancels the pending sign-in the operator was closing, then closes once it stopped. */
  async #cancelAndClose() {
    const login = this.#currentLogin();
    if (login?.phase === "pending" && !await this.#mutate(`login/${login.id}`, "DELETE")) return;
    this.#confirmClose = false;
    if (!await this.#saveCompleted()) return;
    this.#dismiss();
  }
  async #backToProviders() {
    if (!await this.#saveCompleted()) return;
    this.#step = "provider"; this.#brand = ""; this.#providerId = ""; this.#accountId = undefined; this.#accountName = "";
    this.#attempt = ""; this.#flow = ""; this.#chosen = ""; this.#check = undefined; this.#error = ""; this.requestUpdate();
  }
  /** Leaves the sign-in step for another method, saving the model a completed sign-in chose first. */
  async #chooseMethod() {
    if (!await this.#saveCompleted()) return;
    this.#step = "account"; this.#error = ""; this.#check = undefined; this.requestUpdate();
  }
  async #runCheck() {
    const provider = this.#provider();
    if (!provider) return;
    const step = modelsForStep(provider.models, provider.selected, this.#chosen);
    if (!step.selected) return;
    // The account this sign-in created, recorded when the model step opened: saving the model clears the gateway's
    // login, so there is nothing left to read here.
    const accountId = this.#accountId;
    this.#chosen = step.selected;
    this.#step = "checking"; this.#busy = true; this.#error = ""; this.#check = undefined; this.#report = undefined; this.requestUpdate();
    try {
      // Persist before asking for a reply: the model must exist for the provider, and a closed dialog keeps it.
      if (this.#completed && !await this.#persistModels(step)) { this.#step = "model"; return; }
      const result = await testProviderModel(provider.id, { model: step.selected, ...(accountId ? { accountId } : {}) });
      this.#check = result;
      if (result.ok) {
        this.#report = this.onUseModel?.(`${provider.id}/${step.selected}`) || undefined;
        this.#step = "verified";
      } else {
        this.#step = "test-failed";
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "The model check could not run. Try again.";
      this.#step = "model";
    } finally { this.#busy = false; this.requestUpdate(); }
  }
  async #startChat() {
    if (!await this.#saveCompleted()) return;
    this.#dismiss();
    this.onStartChat?.();
  }
  async #stay() {
    if (!await this.#saveCompleted()) return;
    this.#dismiss();
  }
  #copy(text: string | undefined, kind: "link" | "code") {
    if (!text) return;
    void writeClipboardText(text).then((copied) => {
      if (!copied) { this.#error = "The clipboard is unavailable. Select the text and copy it yourself."; this.requestUpdate(); return; }
      this.#copied = kind;
      clearTimeout(this.#copiedTimer);
      this.#copiedTimer = setTimeout(() => { this.#copied = ""; this.requestUpdate(); }, 2500);
      this.requestUpdate();
    });
  }
  #openSignIn(url: string | undefined) {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  async #loadQuota(id: string) {
    if (this.#quotaLoading.has(id)) return;
    const generation = this.#generation;
    this.#quotaLoading.add(id); this.requestUpdate();
    try {
      const quota = await loadProviderQuota(id);
      if (generation === this.#generation) { this.#quotas.set(id, quota); await this.#refresh(); }
    } catch {
      if (generation === this.#generation) this.#quotas.set(id, { status: "unavailable", checkedAt: Date.now(), windows: [], message: "Usage could not be retrieved. Try refreshing limits." });
    } finally { this.#quotaLoading.delete(id); this.requestUpdate(); }
  }

  #title(): string {
    const login = this.#currentLogin();
    switch (this.#step) {
      case "account": return this.#brandInfo()?.name ?? this.#provider()?.name ?? "Sign in";
      case "signin":
        if (login && (login.phase === "failed" || login.phase === "cancelled")) return loginFailure(login.reason).title;
        return this.#brandInfo()?.name ?? this.#provider()?.name ?? "Sign in";
      case "model": return "Choose a model";
      case "checking": return "Check model";
      case "verified": return "Connection verified";
      case "test-failed": return testFailure(this.#check?.ok === false ? this.#check.reason : undefined).title;
      default: return "Connect a provider";
    }
  }
  #subtitle(): string {
    switch (this.#step) {
      case "provider": return "Sign in to a provider or add an API key.";
      case "account": return "Choose how you want to sign in.";
      case "model": return "Account connected. Choose a model when you want to test a reply.";
      default: return "";
    }
  }
  #providerChoices() {
    const query = this.#providerQuery.trim().toLowerCase();
    return providerBrands
      .filter((brand) => connectionMethods(brand.id, this.#providers()).length > 0)
      .filter((brand) => !query || `${brand.name} ${brandHint(brand.id, this.#providers())}`.toLowerCase().includes(query));
  }
  #providerStep() {
    const brands = this.#providerChoices();
    return html`<label class="hui-provider-field">Search providers
        <input type="search" autocomplete="off" spellcheck="false" placeholder="Search providers" .value=${this.#providerQuery}
          @input=${(event: Event) => { this.#providerQuery = (event.target as HTMLInputElement).value; this.requestUpdate(); }} />
      </label>
      ${brands.length ? html`<div class="hui-provider-choices">${brands.map((brand) => html`<button class="hui-provider-choice"
        @click=${() => { this.#brand = brand.id; this.#providerId = brand.providers[0] ?? brand.id; this.#step = "account"; this.#error = ""; this.requestUpdate(); }}>
        ${renderProviderBrandIcon(brand.providers[0] ?? brand.id, "hui-provider-icon")}
        <span><strong>${brand.name}</strong><small>${brandHint(brand.id, this.#providers())}</small></span>
        <span aria-hidden="true">›</span>
      </button>`)}</div>`
      : html`<p role="status" class="hui-provider-muted">No model providers match “${this.#providerQuery.trim()}”.</p>`}`;
  }
  #accountStep() {
    const nameRequired = this.#providerId === "opencode-go";
    return html`
      <div class="hui-provider-field">
        <label for="hui-provider-account-name">${nameRequired ? "Account name" : "Label when email is unavailable (optional)"}</label>
        <input id="hui-provider-account-name" maxlength="80" ?required=${nameRequired}
          aria-describedby=${nameRequired ? "hui-provider-account-name-help" : nothing} .value=${this.#accountName} placeholder="Personal, Work…"
          @input=${(event: Event) => { this.#accountName = (event.target as HTMLInputElement).value; }} />
        ${nameRequired ? html`<small id="hui-provider-account-name-help" class="hui-provider-field-help">A name is required because OpenCode does not report the account name or email.</small>` : nothing}
      </div>
      <div class="hui-provider-choices">${connectionMethods(this.#brand || this.#providerId, this.#providers()).map((choice) => html`<button class="hui-provider-choice" ?disabled=${this.#busy} @click=${() => {
        if (choice.provider.id === "opencode-go" && !this.#accountName.trim()) {
          this.#error = "Enter a name for this OpenCode account.";
          this.querySelector<HTMLInputElement>("#hui-provider-account-name")?.focus();
          this.requestUpdate(); return;
        }
        if (this.#providerId !== choice.provider.id) this.#accountId = undefined;
        void this.#start(choice.provider.id, choice.method);
      }}><span><strong>${choice.label}</strong><small>${choice.hint}</small></span><span aria-hidden="true">›</span></button>`)}</div>
      <div class="hui-provider-actions"><button class="btn" ?disabled=${this.#busy} @click=${() => void this.#backToProviders()}>Back</button></div>`;
  }
  #promptForm(login: ProviderLogin, prompt: NonNullable<ProviderLogin["prompt"]>) {
    return html`<form class="hui-provider-prompt" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const field = (event.currentTarget as HTMLFormElement).elements.namedItem("value");
      const value = field instanceof HTMLInputElement ? field.value.trim() : "";
      if (value) void this.#answer(login, prompt, value);
    }}>
      <label class="hui-provider-field">${prompt.message}
        <input name="value" type=${prompt.type === "secret" ? "password" : "text"} autocomplete="off" spellcheck="false" required />
      </label>
      <button class="btn primary" type="submit" ?disabled=${this.#busy}>Continue</button>
    </form>`;
  }
  #selectPrompt(login: ProviderLogin, prompt: NonNullable<ProviderLogin["prompt"]>) {
    return html`<div class="hui-provider-field hui-provider-select-field">
      <span class="hui-provider-field-label">${prompt.message}</span>
      ${renderPicker({
        label: prompt.message,
        value: "",
        options: (prompt.options ?? []).map((option) => ({ value: option.id, label: option.label })),
        disabled: this.#busy,
        onChange: (value) => void this.#answer(login, prompt, value),
      })}
    </div>`;
  }
  #manualForm(login: ProviderLogin, prompt: NonNullable<ProviderLogin["prompt"]>, copy: ReturnType<typeof manualEntryCopy>) {
    return html`<form class="hui-provider-manual-form" @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const field = (event.currentTarget as HTMLFormElement).elements.namedItem("value");
      const value = field instanceof HTMLInputElement ? field.value.trim() : "";
      if (value) void this.#answer(login, prompt, value);
    }}>
      <label class="hui-provider-field">${copy.label}
        <input name="value" type="text" class="hui-provider-code-input" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder=${copy.placeholder} />
      </label>
      <p class="hui-provider-field-help">${copy.hint}</p>
      <button class="btn primary" type="submit" ?disabled=${this.#busy}>Continue</button>
    </form>`;
  }
  #browserLogin(login: ProviderLogin) {
    const prompt = login.prompt;
    const copy = manualEntryCopy(this.#providerId, "browser");
    return html`
      <p>Complete sign-in in your browser, then return here.</p>
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${!login.url} @click=${() => this.#openSignIn(login.url)}>Open sign-in</button>
        <button class="btn" ?disabled=${!login.url} @click=${() => this.#copy(login.url, "link")}>Copy link</button>
      </div>
      ${this.#copied === "link" ? html`<p role="status" class="hui-provider-notice">Link copied.</p>` : nothing}
      ${prompt?.type === "manual_code" ? html`<details class="hui-provider-manual" ?open=${this.#manualOpen}
        @toggle=${(event: Event) => { this.#manualOpen = (event.currentTarget as HTMLDetailsElement).open; }}>
        <summary>Use manual entry</summary>
        ${this.#manualForm(login, prompt, copy)}
      </details>` : nothing}`;
  }
  #deviceLogin(login: ProviderLogin) {
    return html`
      <p>Enter this code at ${signInHost(login.url)}:</p>
      <p class="hui-provider-device-code"><code>${login.code ?? ""}</code></p>
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${!login.code} @click=${() => this.#copy(login.code, "code")}>Copy code</button>
        ${login.url ? html`<button class="btn" @click=${() => this.#openSignIn(login.url)}>Open sign-in</button>` : nothing}
      </div>
      ${this.#copied === "code" ? html`<p role="status" class="hui-provider-notice">Code copied.</p>` : nothing}
      ${login.code ? html`<p class="hui-provider-meta">Expires in ${expiresInMinutes(login, this.#startedAt)} minutes</p>` : nothing}
      <p class="hui-provider-warning" role="note">Continue only if you started this sign-in yourself. If a website or another person gave you this code, cancel.</p>`;
  }
  #copyCodeLogin(login: ProviderLogin) {
    const prompt = login.prompt;
    const copy = manualEntryCopy(this.#providerId, "copy_code");
    return html`
      <p>Complete sign-in in your browser, then paste the code Anthropic shows.</p>
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${!login.url} @click=${() => this.#openSignIn(login.url)}>Open sign-in</button>
        <button class="btn" ?disabled=${!login.url} @click=${() => this.#copy(login.url, "link")}>Copy link</button>
      </div>
      ${this.#copied === "link" ? html`<p role="status" class="hui-provider-notice">Link copied.</p>` : nothing}
      ${prompt?.type === "manual_code" ? this.#manualForm(login, prompt, copy) : nothing}`;
  }
  #pendingLogin(login: ProviderLogin) {
    const prompt = login.prompt;
    const flow = login.flow;
    // A select prompt is a choice the flow could not answer: it replaces the flow's own instructions.
    const choice = prompt?.type === "select" ? prompt : undefined;
    return html`
      ${choice ? html`<p>Choose how you want to sign in.</p>${this.#selectPrompt(login, choice)}` : html`
        ${flow === "browser" ? this.#browserLogin(login) : nothing}
        ${flow === "device_code" ? this.#deviceLogin(login) : nothing}
        ${flow === "copy_code" ? this.#copyCodeLogin(login) : nothing}
        ${prompt && prompt.type !== "manual_code" ? this.#promptForm(login, prompt) : nothing}
        ${!flow && prompt?.type === "manual_code" ? this.#manualForm(login, prompt, manualEntryCopy(this.#providerId, undefined)) : nothing}
      `}
      <p role="status" class="hui-provider-status">Waiting for sign-in…${login.message ? ` ${login.message}` : ""}</p>
      ${flow && alternateFlow(this.#providerId, flow) ? html`<button class="btn" ?disabled=${this.#busy} @click=${() => void this.#restart(alternateFlow(this.#providerId, flow))}>${flowSwitchLabel(flow)}</button>` : nothing}
      <div class="hui-provider-actions"><button class="btn" ?disabled=${this.#busy} @click=${() => void this.#cancelSignIn()}>Cancel sign-in</button></div>`;
  }
  #loginFailure(login: ProviderLogin) {
    const copy = loginFailure(login.reason);
    return html`
      <p role="alert">${copy.sentence}</p>
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${this.#busy} @click=${() => void this.#restart()}>Try again</button>
        <button class="btn" ?disabled=${this.#busy} @click=${() => void this.#chooseMethod()}>Choose another method</button>
      </div>`;
  }
  #signInEnded() {
    return html`<p role="alert">This sign-in session ended. Start it again to continue.</p>
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${this.#busy} @click=${() => void this.#restart()}>Try again</button>
        <button class="btn" ?disabled=${this.#busy} @click=${() => void this.#chooseMethod()}>Choose another method</button>
      </div>`;
  }
  #signInStep() {
    const login = this.#currentLogin();
    if (!login) {
      // Nothing to show progress for: either the start is still in flight, or the gateway no longer holds it.
      if (this.#ended || (this.#attempt && !this.#busy)) return this.#signInEnded();
      return html`<p role="status" class="hui-provider-status"><span class="hui-provider-spinner" aria-hidden="true"></span>Starting provider sign-in…</p>
        <div class="hui-provider-actions"><button class="btn" ?disabled=${this.#busy} @click=${() => void this.#chooseMethod()}>Back</button></div>`;
    }
    if (login.phase === "failed" || login.phase === "cancelled") return this.#loginFailure(login);
    return this.#pendingLogin(login);
  }
  #modelStep() {
    const provider = this.#provider();
    if (!provider) return html`<p role="status">Loading the provider's models…</p>`;
    const step = modelsForStep(provider.models, provider.selected, this.#chosen);
    const models = filterModels(step.options, this.#modelQuery);
    const selectedModel = step.options.find((model) => model.id === step.selected);
    return html`
      ${selectedModel && !models.some((model) => model.id === step.selected) ? html`<p class="hui-provider-meta">Chosen: <strong>${selectedModel.name}</strong></p>` : nothing}
      <label class="hui-provider-field">Search models
        <input type="search" autocomplete="off" spellcheck="false" placeholder="Name or model ID" .value=${this.#modelQuery}
          @input=${(event: Event) => { this.#modelQuery = (event.target as HTMLInputElement).value; this.requestUpdate(); }} />
      </label>
      ${models.length ? html`<fieldset class="hui-provider-model-list">
        <legend class="hui-provider-field-label">Model</legend>
        ${models.map((model) => html`<label class="hui-provider-model">
          <input type="radio" name="hui-provider-model" value=${model.id} .checked=${model.id === step.selected}
            @change=${() => { this.#chosen = model.id; this.requestUpdate(); }} />
          <span><strong>${model.name}</strong><code>${model.id}</code></span>
        </label>`)}
      </fieldset>` : html`<p role="status" class="hui-provider-muted">${step.options.length ? `No models match “${this.#modelQuery.trim()}”.` : "This provider lists no models yet. Its connection is saved without one."}</p>`}
      <div class="hui-provider-actions"><button class="btn primary" ?disabled=${this.#busy || !step.selected} @click=${() => void this.#runCheck()}>Check model</button></div>`;
  }
  #checkingStep() {
    const provider = this.#provider();
    return html`<p role="status" class="hui-provider-status"><span class="hui-provider-spinner" aria-hidden="true"></span>Checking — asking ${provider?.id ?? this.#providerId}/${this.#chosen} for a quick reply…</p>`;
  }
  /** Which model new sessions now use, from what `onUseModel` reports. Absent means roles are left alone. */
  #roleNote(label: string): string {
    const report = this.#report;
    if (!report) return "";
    if (report.assignedPrimary) return `New sessions now use ${label} as their primary model.`;
    if (report.assignedUtility) return `New sessions now use ${label} as their utility model.`;
    return `New sessions keep the models you already chose. ${label} is saved for this provider.`;
  }
  #verifiedStep() {
    const provider = this.#provider();
    const model = provider?.models.find((entry) => entry.id === this.#chosen);
    const label = model?.name ?? this.#chosen;
    const latency = this.#check?.ok ? this.#check.latencyMs : 0;
    const note = this.#roleNote(label);
    return html`
      <p>HUI received a real reply from ${label}.${this.onStartChat ? " You can start chatting now." : ""}</p>
      <dl class="hui-provider-verified"><div><dt>Verified in</dt><dd>${Math.round(latency).toLocaleString()} ms</dd></div></dl>
      ${note ? html`<p class="hui-provider-notice">${note}</p>` : nothing}
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${this.#busy || !this.onStartChat} @click=${() => void this.#startChat()}>Start chatting</button>
        <button class="btn" ?disabled=${this.#busy} @click=${() => void this.#stay()}>Stay in settings</button>
      </div>`;
  }
  #testFailedStep() {
    const copy = testFailure(this.#check?.ok === false ? this.#check.reason : undefined);
    const message = this.#check?.ok === false ? this.#check.message : "";
    return html`
      <p role="alert">${copy.guidance}</p>
      ${message ? html`<p class="hui-provider-muted">${message}</p>` : nothing}
      <div class="hui-provider-actions">
        <button class="btn primary" ?disabled=${this.#busy} @click=${() => void this.#runCheck()}>Retry test</button>
        <button class="btn" ?disabled=${this.#busy} @click=${() => { this.#step = "model"; this.#check = undefined; this.requestUpdate(); }}>Choose another model</button>
      </div>`;
  }
  #body() {
    if (this.#confirmClose) {
      return html`<div class="hui-provider-confirm">
        <p role="alert">Sign-in is still waiting. Close and cancel it?</p>
        <div class="hui-provider-actions">
          <button class="btn primary" ?disabled=${this.#busy} @click=${() => { this.#confirmClose = false; this.requestUpdate(); }}>Keep waiting</button>
          <button class="btn" ?disabled=${this.#busy} @click=${() => void this.#cancelAndClose()}>Cancel sign-in</button>
        </div>
      </div>`;
    }
    switch (this.#step) {
      case "account": return this.#accountStep();
      case "signin": return this.#signInStep();
      case "model": return this.#modelStep();
      case "checking": return this.#checkingStep();
      case "verified": return this.#verifiedStep();
      case "test-failed": return this.#testFailedStep();
      default: return this.#providerStep();
    }
  }
  #modal() {
    const icon = this.#step === "provider" ? nothing : renderProviderBrandIcon(this.#providerId || (this.#brandInfo()?.providers[0] ?? this.#brand), "hui-provider-icon");
    const subtitle = this.#subtitle();
    // Escape itself is handled once, by the dialog's cancel event. The keydown guard only keeps Escape from reaching
    // Settings' own handler, which would otherwise leave Settings behind the dialog.
    return html`<dialog class="hui-provider-dialog" aria-labelledby="hui-provider-dialog-title"
      @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) void this.#close(); }}
      @cancel=${(event: Event) => this.#escape(event)}
      @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <div class="hui-provider-heading"><div class="hui-provider-dialog-title">${icon}<h3 id="hui-provider-dialog-title">${this.#title()}</h3></div><button class="btn" aria-label="Close provider dialog" ?disabled=${this.#busy} @click=${() => void this.#close()}>✕</button></div>
      ${subtitle ? html`<p class="settings-section__desc">${subtitle}</p>` : nothing}
      ${this.#error ? html`<p role="alert" class="hui-provider-error">${this.#error}</p>` : nothing}
      ${this.#body()}
    </dialog>`;
  }
  // ---- Model selection on a saved card (unchanged behaviour) ------------------------------------------------
  #modelPicker(provider: ProviderSummary) {
    let draft = this.#drafts.get(provider.id);
    if (!draft) { draft = { models: new Set(provider.selected), query: "" }; this.#drafts.set(provider.id, draft); }
    const state = draft;
    const query = state.query.toLowerCase().trim().split(/\s+/);
    const models = provider.models.filter((model) => query.every((term) => `${model.id} ${model.name}`.toLowerCase().includes(term)));
    return html`<details class="hui-provider-picker">
      <summary>Models <span>${provider.selected.length ? `${provider.selected.length} selected` : "Choose models"}</span></summary>
      <div class="hui-provider-picker-panel">
        <label class="hui-provider-field">Search models<input type="search" .value=${state.query} placeholder="Name or model ID" @input=${(event: Event) => { state.query = (event.target as HTMLInputElement).value; this.requestUpdate(); }} /></label>
        <div class="hui-provider-actions"><button class="btn" @click=${() => { for (const model of models) state.models.add(model.id); this.requestUpdate(); }}>Select visible</button><button class="btn" @click=${() => { state.models.clear(); this.requestUpdate(); }}>Clear selection</button><span class="hui-provider-method">${state.models.size} selected</span></div>
        <div class="hui-provider-models">${models.length ? models.map((model) => html`<label class="hui-provider-model"><input type="checkbox" .checked=${state.models.has(model.id)} @change=${(event: Event) => { if ((event.target as HTMLInputElement).checked) state.models.add(model.id); else state.models.delete(model.id); this.requestUpdate(); }} /><span><strong>${model.name}</strong><code>${model.id}</code><small>Context: ${model.contextWindow?.toLocaleString() ?? "reported during the session"} · Max output: ${model.maxTokens?.toLocaleString() ?? "CLI-managed"}</small></span></label>`) : html`<p>No matching models.</p>`}</div>
        <div class="hui-provider-actions"><button class="btn primary" ?disabled=${this.#busy} @click=${async (event: Event) => {
          const details = (event.currentTarget as HTMLElement).closest("details");
          if (await this.#mutate(provider.id, "PUT", { models: [...state.models] }, "Model selection saved.")) { details?.removeAttribute("open"); details?.querySelector("summary")?.focus(); }
        }}>Save models</button><button class="btn" ?disabled=${this.#busy} @click=${(event: Event) => { this.#drafts.delete(provider.id); const details = (event.currentTarget as HTMLElement).closest("details"); details?.removeAttribute("open"); details?.querySelector("summary")?.focus(); this.requestUpdate(); }}>Cancel</button></div>
      </div>
    </details>`;
  }
  #accountQuota(key: string) {
    const quota = this.#quotas.get(key);
    return html`<section class="hui-provider-quota" aria-label="Subscription and limits"><div class="hui-provider-heading"><h4>Subscription and limits</h4><button class="btn" ?disabled=${this.#quotaLoading.has(key)} @click=${() => this.#loadQuota(key)}>${this.#quotaLoading.has(key) ? "Checking…" : "Refresh limits"}</button></div>
      ${quota ? html`
        <dl class="hui-subscription-status">
          <div><dt>Plan</dt><dd>${quota.plan ?? "Not reported"}</dd></div>
          <div><dt>Subscription status</dt><dd>Not reported</dd></div>
          <div><dt>Usage status</dt><dd>${quota.access === "limited" ? "Limit reached" : quota.access === "available" ? "Available" : quota.status === "available" ? "Usage reported" : quota.status === "unsupported" ? "Not supported" : "Unavailable"}</dd></div>
        </dl>
        <p class="hui-subscription-note">Billing status and renewal dates are not exposed by this connection.</p>
        <div class="hui-provider-windows">${quota.windows.map((window) => html`<div class="hui-provider-window" data-exhausted=${window.usedPercent >= 100}>
          <div><strong>${window.label}</strong><span>${Number(window.usedPercent.toFixed(1))}% used</span></div>
          <progress max="100" value=${Math.min(100, window.usedPercent)} aria-label=${`${window.label}: ${Number(window.usedPercent.toFixed(1))}% used`}></progress>
          <small>${window.detail ? `${window.detail} · ` : ""}${window.resetAt ? `Resets ${new Date(window.resetAt).toLocaleString()}` : "Reset not reported"}</small>
        </div>`)}</div>
        ${quota.message ? html`<p>${quota.message}</p>` : nothing}
        <small>Checked ${new Date(quota.checkedAt).toLocaleString()}</small>
      ` : html`<p role="status">Loading subscription and limits…</p>`}
    </section>`;
  }

  #accountLabel(provider: ProviderSummary, account: NonNullable<ProviderSummary["accounts"]>[number]) {
    return this.#quotas.get(`${provider.id}/accounts/${account.id}`)?.email ?? account.email ?? account.name;
  }
  #beginDrag(event: PointerEvent | KeyboardEvent, provider: ProviderSummary, id: string) {
    if (this.#busy || this.#drag || (provider.accounts?.length ?? 0) < 2) return;
    if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) return;
    const accounts = provider.accounts!;
    const from = accounts.findIndex((account) => account.id === id);
    const handle = event.currentTarget as HTMLElement;
    event.preventDefault(); handle.focus();
    this.#drag = { provider: provider.id, id, name: this.#accountLabel(provider, accounts[from]!), order: accounts.map((a) => a.id), from, to: from, handle,
      y: 0, startY: 0, moved: false };
    if (event instanceof PointerEvent) {
      Object.assign(this.#drag, { pointer: event.pointerId, y: event.clientY, startY: event.clientY });
      handle.setPointerCapture(event.pointerId);
      this.#dragFrame = requestAnimationFrame(() => this.#dragTick());
    }
    this.#dragNotice = `Picked up ${this.#accountLabel(provider, accounts[from]!)}. Use arrow keys to choose a position, Space to drop, or Escape to cancel.`;
    this.requestUpdate();
  }
  #dragTick() {
    const drag = this.#drag;
    if (!drag || drag.pointer === undefined) return;
    if (drag.moved) {
      let scroll = drag.handle.parentElement;
      while (scroll && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
        const delta = drag.y < top + 48 ? -10 : drag.y > bottom - 48 ? 10 : 0;
        if (delta) scroll.scrollTop += delta;
      }
      this.#dragPosition();
    }
    this.#dragFrame = requestAnimationFrame(() => this.#dragTick());
  }
  #dragPosition() {
    const drag = this.#drag;
    const section = drag?.handle.closest(".hui-provider-accounts");
    if (!drag || !section) return;
    const cards = [...section.querySelectorAll<HTMLElement>(".hui-provider-account")].filter((card) => card.dataset.accountId !== drag.id);
    const before = cards.findIndex((card) => { const rect = card.getBoundingClientRect(); return drag.y < rect.top + rect.height / 2; });
    const to = before < 0 ? cards.length : before;
    if (to !== drag.to) { drag.to = to; this.#dragNotice = `${drag.name}, position ${to + 1} of ${drag.order.length}.`; this.requestUpdate(); }
  }
  #moveDrag(event: PointerEvent) {
    const drag = this.#drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.y = event.clientY;
    if (Math.abs(drag.y - drag.startY) > 5) drag.moved = true;
    if (drag.moved) this.#dragPosition();
  }
  #dragKey(event: KeyboardEvent, provider: ProviderSummary, id: string) {
    if (!this.#drag && (event.key === " " || event.key === "Enter")) { this.#beginDrag(event, provider, id); return; }
    const drag = this.#drag;
    if (!drag || drag.id !== id || drag.provider !== provider.id) return;
    if (!["Escape", " ", "Enter", "ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(event.key)) return;
    event.stopPropagation();
    if (event.key === "Tab") { this.#endDrag(false); return; }
    event.preventDefault();
    if (event.key === "Escape") { this.#endDrag(false); return; }
    if (event.key === " " || event.key === "Enter") { this.#endDrag(true); return; }
    drag.to = event.key === "Home" ? 0 : event.key === "End" ? drag.order.length - 1 : Math.max(0, Math.min(drag.order.length - 1, drag.to + (event.key === "ArrowUp" ? -1 : 1)));
    drag.moved = true;
    this.#dragNotice = `${drag.name}, position ${drag.to + 1} of ${drag.order.length}.`;
    this.requestUpdate();
  }
  #endDrag(save: boolean) {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = undefined; cancelAnimationFrame(this.#dragFrame);
    if (drag.pointer !== undefined && drag.handle.hasPointerCapture(drag.pointer)) drag.handle.releasePointerCapture(drag.pointer);
    this.#dragNotice = save ? "" : "Reordering cancelled.";
    this.requestUpdate();
    if (!save || !drag.moved || drag.from === drag.to) return;
    const order = drag.order.filter((id) => id !== drag.id); order.splice(drag.to, 0, drag.id);
    void this.#mutate(`${drag.provider}/accounts`, "PUT", { order }, "Account priority saved.").then(async () => {
      await this.updateComplete;
      if (this.isConnected) drag.handle.focus();
    });
  }
  #accounts(provider: ProviderSummary) {
    const accounts = provider.accounts ?? [];
    const firstReady = accounts.find((a) => a.authenticated && (a.cooldownUntil ?? 0) <= Date.now())?.id;
    return html`<section class="hui-provider-accounts" aria-label=${`${connectionName(provider)} accounts`}>
      <div class="hui-provider-heading"><h4>Account priority</h4><button class="btn" ?disabled=${this.#busy} @click=${() => this.#open(providerBrand(provider.id)?.id ?? provider.id, provider.id)}>Add account</button></div>
      <p class="settings-section__desc">Use the first available account. When it reaches a limit, try the next; return to the preferred account after its cooldown.</p>
      <p class="hui-account-drag-help" id=${`account-drag-help-${provider.id}`}>Drag the grip to set priority. With a keyboard, press Space, use ↑ / ↓, then Space to drop. Escape cancels.</p>
      ${repeat(accounts, (account) => account.id, (account, index) => {
        const key = `${provider.id}/accounts/${account.id}`;
        const waiting = (account.cooldownUntil ?? 0) > Date.now();
        const drag = this.#drag?.provider === provider.id ? this.#drag : undefined;
        const label = this.#accountLabel(provider, account);
        const at = label.lastIndexOf("@");
        const remaining = accounts.filter((a) => a.id !== drag?.id);
        const before = drag && drag.to !== drag.from && remaining[drag.to]?.id === account.id;
        const after = drag && drag.to !== drag.from && drag.to === remaining.length && remaining.at(-1)?.id === account.id;
        return html`<article class="hui-provider-account ${drag?.id === account.id ? "is-dragging" : ""} ${before ? "drop-before" : after ? "drop-after" : ""}" data-account-id=${account.id} aria-label=${this.#accountLabel(provider, account)}>
          <div class="hui-provider-heading">
            <button class="hui-account-grip" type="button" aria-label=${`Reorder ${this.#accountLabel(provider, account)}`} aria-describedby=${`account-drag-help-${provider.id}`} aria-pressed=${drag?.id === account.id ? "true" : "false"} ?disabled=${this.#busy || accounts.length < 2}
              @pointerdown=${(event: PointerEvent) => this.#beginDrag(event, provider, account.id)}
              @pointermove=${(event: PointerEvent) => this.#moveDrag(event)}
              @pointerup=${(event: PointerEvent) => { if (this.#drag?.pointer === event.pointerId) {
                const rect = (event.currentTarget as HTMLElement).closest(".hui-provider-accounts")!.getBoundingClientRect();
                this.#endDrag(event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
              } }}
              @pointercancel=${() => this.#endDrag(false)} @lostpointercapture=${() => this.#endDrag(false)}
              @blur=${() => { if (this.#drag) this.#endDrag(false); }}
              @keydown=${(event: KeyboardEvent) => this.#dragKey(event, provider, account.id)}>
              <svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" fill="currentColor"><circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg>
            </button>
            <div><strong class="hui-account-name"><span>${index + 1}.</span><span>${at > 0 ? html`${label.slice(0, at)}<wbr>${label.slice(at)}` : label}</span></strong><p>${!account.authenticated ? "Sign in to reconnect" : waiting ? `Waiting until ${new Date(account.cooldownUntil!).toLocaleString()}` : account.id === firstReady ? "Next to use" : "Standby"}</p></div>
          </div>
          <div class="hui-provider-actions"><button class="btn" ?disabled=${this.#busy} @click=${() => this.#open(providerBrand(provider.id)?.id ?? provider.id, provider.id, account.id)}>${account.authenticated ? "Reconnect" : "Sign in"}</button><button class="btn" aria-label=${`Remove account ${this.#accountLabel(provider, account)}`} ?disabled=${this.#busy} @click=${() => { this.#confirm = key; this.requestUpdate(); }}>Remove account</button></div>
          ${this.#confirm === key ? html`<p>Remove ${this.#accountLabel(provider, account)}? Other accounts and model selections are kept.</p><button class="btn" ?disabled=${this.#busy} @click=${async () => { if (await this.#mutate(key, "DELETE", undefined, "Account removed.")) { this.#confirm = ""; this.#quotas.delete(key); } }}>Confirm removal</button> <button class="btn" @click=${() => { this.#confirm = ""; this.requestUpdate(); }}>Keep account</button>` : nothing}
          ${account.authenticated ? this.#accountQuota(key) : nothing}
        </article>`;
      })}
    </section>`;
  }
  #providerCard(provider: ProviderSummary) {
    return html`<article class="hui-provider-detail" aria-label=${connectionName(provider)}>
      <div class="hui-provider-heading">${renderProviderBrandIcon(provider.id, "hui-provider-icon")}<div><h3>${connectionName(provider)}</h3><p>${provider.authenticated ? "Credentials available" : "Sign in to reconnect"}</p></div>
        ${!provider.authenticated ? html`<button class="btn primary" ?disabled=${this.#busy} @click=${() => this.#open(providerBrand(provider.id)?.id ?? provider.id, provider.id)}>Sign in</button>` : html`<button class="btn" aria-label=${`Remove ${connectionName(provider)}`} ?disabled=${this.#busy} @click=${() => { this.#confirm = provider.id; this.requestUpdate(); }}>Remove</button>`}
      </div>
      ${provider.authenticated ? html`
        ${this.#accounts(provider)}
        ${this.#modelPicker(provider)}
      ` : nothing}
      ${this.#confirm === provider.id ? html`<div class="hui-provider-login"><p>Remove this HUI connection and its saved credentials? PI configuration is kept. Existing sessions keep their current runtime until reopened.</p><button class="btn" ?disabled=${this.#busy} @click=${async () => {
        if (await this.#mutate(provider.id, "DELETE", undefined, "Connection removed. PI configuration is unchanged.")) { this.#confirm = ""; this.#drafts.delete(provider.id); this.#quotas.delete(provider.id); this.requestUpdate(); }
      }}>Confirm removal</button> <button class="btn" @click=${() => { this.#confirm = ""; this.requestUpdate(); }}>Keep connection</button></div>` : nothing}
    </article>`;
  }
  override render() {
    const providers = this.#snapshot?.providers.filter((provider) => provider.configured) ?? [];
    return html`<div class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Model providers</h2><p class="settings-section__desc">Connect an account and choose models, or start a custom local server when you need its models.</p></div>${providers.length ? html`<button class="btn primary" ?disabled=${this.#busy || !this.#snapshot} @click=${() => this.#open()}>Connect a provider</button>` : nothing}</div>
      ${this.#error && !this.#dialog()?.open ? html`<p role="alert" class="hui-provider-error">${this.#error}</p><button class="btn" @click=${() => this.#refresh()}>Retry loading providers</button>` : nothing}
      ${this.#notice ? html`<p role="status" class="hui-provider-notice">${this.#notice}</p>` : nothing}
      <span class="hui-account-drag-status" role="status">${this.#dragNotice}</span>
      ${!this.#snapshot ? html`<p>Loading providers…</p>` : providers.length ? nothing : html`<section class="hui-provider-empty">
        <h3>No model providers configured</h3>
        <p>Sign in to a provider or add an API key, then continue.</p>
        <button class="btn primary" @click=${() => this.#open()}>Connect a provider</button>
      </section>`}
      <details class="hui-provider-configuration" ?hidden=${providers.length === 0}>
        <summary>${`Provider configuration · ${providers.length} provider${providers.length === 1 ? "" : "s"}`}</summary>
        <div class="hui-provider-cards">${repeat(providers, (provider) => provider.id, (provider) => this.#providerCard(provider))}</div>
      </details>
      ${this.#modal()}`;
  }
}
if (typeof customElements !== "undefined" && !customElements.get("hui-provider-settings")) customElements.define("hui-provider-settings", HuiProviderSettings);
