/**
 * HUI's provider connections: OAuth and API-key sign-in for PI's built-in providers, several accounts per
 * provider, the models selected for each, and short-lived quota caches. Credentials and selections live in
 * HUI's providers directory through PI's model runtime, while custom providers stay in PI's models.json. One
 * sign-in runs at a time, its prompts and choice of flow are answered from the UI, and its failure is classified
 * before it leaves the gateway. The installation id PI's ChatGPT sign-in needs is created here on first use and
 * never leaves this module.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { ProviderLogin, ProviderLoginFailure, ProviderLoginFlow, ProviderQuota, ProviderSnapshot, ProviderSummary, ProviderTest } from "../api/providers.ts";
import { createHuiModelRuntime, PROVIDERS_DIR, readProviderSelections, writeProviderSelections } from "../runtimes/hui-models.ts";
import { ProviderAccounts, credentialStore } from "./provider-accounts.ts";
import { credentialEmail } from "./provider-identity.ts";
import { fetchProviderQuota } from "./provider-quota.ts";
import { failureText, testFailed, testProviderModel } from "./provider-test.ts";

type Interaction = Parameters<ModelRuntime["login"]>[2];
type Prompt = Parameters<Interaction["prompt"]>[0];
export class ProviderInputError extends Error {}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FLOWS: readonly ProviderLoginFlow[] = ["browser", "device_code", "copy_code"];
/** PI's device codes are valid for 15 minutes, so that flow is allowed to wait one minute longer. */
const DEVICE_CODE_TIMEOUT_MS = 16 * 60_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

function loginFlow(value: unknown): ProviderLoginFlow | undefined {
  if (value === undefined) return undefined;
  if (FLOWS.includes(value as ProviderLoginFlow)) return value as ProviderLoginFlow;
  throw new ProviderInputError("Choose a sign-in flow.");
}

/** Why PI's sign-in stopped. The browser gets the reason and a generic sentence, never PI's raw error. */
function loginFailure(error: unknown, cancelled: boolean): ProviderLoginFailure {
  if (cancelled) return "cancelled";
  const text = failureText(error);
  if (/state mismatch/i.test(text)) return "stale_link";
  if (/port \d+ is in use|EADDRINUSE/i.test(text)) return "port_in_use";
  if (/expired/i.test(text)) return "expired";
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up|aborted due to timeout/i.test(text)) return "network";
  return "unknown";
}

/** PI's ChatGPT sign-in identifies the installation it was granted on. It is created on the first sign-in that
 * needs one, persisted beside HUI's credentials and reused by every later run, so a re-authorisation does not
 * look like a new client. It is never returned, logged or shown. */
async function readDeviceId(dir: string): Promise<string> {
  const path = join(dir, "device.json");
  try {
    const stored: unknown = JSON.parse(await readFile(path, "utf8"));
    const id = (stored as { id?: unknown } | null)?.id;
    if (typeof id === "string" && UUID.test(id)) return id;
  } catch { /* absent, unreadable or corrupt: a fresh id replaces it */ }
  const id = randomUUID();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `device.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ id }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return id;
}

/** The name the browser shows for a connection; the provider's own, except for the Claude subscription. */
function providerName(provider: { id: string; name: string }): string {
  return provider.id === "anthropic" ? "Anthropic / Claude Pro & Max" : provider.name;
}

export class ProviderService {
  #runtime?: Promise<ModelRuntime>;
  #login?: ProviderLogin;
  #abort?: AbortController;
  #answer?: { id: string; resolve: (value: string) => void; prompt: Prompt };
  #writes: Promise<unknown> = Promise.resolve();
  #device?: Promise<string>;
  #quota = new Map<string, { expires: number; value: Promise<ProviderQuota> }>();
  readonly dir: string;
  readonly accounts: ProviderAccounts;
  readonly changed: () => void;
  constructor(dir = PROVIDERS_DIR, changed: () => void = () => {}) { this.dir = dir; this.accounts = new ProviderAccounts(dir); this.changed = changed; }
  runtime() { return this.#runtime ??= createHuiModelRuntime(this.dir).catch((error: unknown) => { this.#runtime = undefined; throw error; }); }
  async #provider(id: string) {
    const runtime = await this.runtime();
    const provider = runtime.getProvider(id);
    if (!provider || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)) throw new ProviderInputError("Unknown built-in provider. Configure custom providers in PI's models.json.");
    return provider;
  }
  async snapshot(): Promise<ProviderSnapshot> {
    const runtime = await this.runtime();
    const selections = await readProviderSelections(this.dir);
    const allAccounts = await this.accounts.all();
    const providers: ProviderSummary[] = await Promise.all(runtime.getProviders().filter((provider) => provider.auth.apiKey?.login || provider.auth.oauth).map(async (provider) => ({
      id: provider.id, name: providerName(provider),
      methods: [
        ...(provider.auth.oauth ? [{ id: "oauth" as const, label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name }] : []),
        ...(provider.auth.apiKey?.login ? [{ id: "api_key" as const, label: provider.auth.apiKey.name }] : []),
      ],
      configured: Object.hasOwn(selections, provider.id),
      authenticated: (allAccounts[provider.id] ?? []).some((a) => Boolean(readStoredCredential(provider.id, this.accounts.authPath(a.id)))) || (!Object.hasOwn(allAccounts, provider.id) && Boolean(await runtime.checkAuth(provider.id))),
      accounts: (allAccounts[provider.id] ?? []).map((a) => ({ id: a.id, name: a.name, email: credentialEmail(provider.id, readStoredCredential(provider.id, this.accounts.authPath(a.id))), ...(a.cooldownUntil === undefined ? {} : { cooldownUntil: a.cooldownUntil }), authenticated: Boolean(readStoredCredential(provider.id, this.accounts.authPath(a.id))) })),
      selected: selections[provider.id]?.models ?? [],
      models: runtime.getModels(provider.id).map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })),
    })));
    return { providers, ...(this.#login ? { login: structuredClone(this.#login) } : {}) };
  }
  async save(id: string, raw: unknown) {
    const catalog = (await this.#provider(id)).getModels();
    const ids = new Set(catalog.map((model) => model.id));
    if (!Array.isArray(raw) || raw.length > 2000 || !raw.every((value) => typeof value === "string" && ids.has(value))) throw new ProviderInputError("Select models from this provider's catalog.");
    const models = [...new Set(raw)] as string[];
    await this.#write(async () => {
      const selections = await readProviderSelections(this.dir);
      selections[id] = { models };
      await writeProviderSelections(selections, this.dir);
    });
    if (this.#login?.provider === id && this.#login.phase === "complete") this.#login = undefined;
    this.changed();
  }
  async disconnect(id: string) {
    await this.#provider(id);
    if (this.#login?.phase === "pending" && this.#login.provider === id) this.cancel(this.#login.id);
    await this.#write(async () => {
      // Remove the overlay first. A failed credential deletion must not leave a
      // managed runtime selecting a disconnected provider.
      const selections = await readProviderSelections(this.dir);
      delete selections[id];
      await writeProviderSelections(selections, this.dir);
      const accounts = await this.accounts.list(id);
      await this.accounts.update(id, () => []);
      for (const account of accounts) await credentialStore(this.accounts.authPath(account.id)).delete(id);
      await (await this.runtime()).logout(id);
    });
    for (const key of this.#quota.keys()) if (key.startsWith(`${id}/`)) this.#quota.delete(key);
    if (this.#login?.provider === id) this.#login = undefined;
    this.changed();
  }
  #write(fn: () => Promise<void>) {
    const next = this.#writes.then(fn); this.#writes = next.catch(() => {}); return next;
  }
  async reorder(id: string, raw: unknown) {
    await this.#provider(id);
    await this.accounts.update(id, (accounts) => {
      if (!Array.isArray(raw) || raw.length !== accounts.length || new Set(raw).size !== raw.length || !raw.every((item) => typeof item === "string" && accounts.some((a) => a.id === item))) throw new ProviderInputError("Provide every account exactly once in priority order.");
      return raw.map((item) => accounts.find((a) => a.id === item)!);
    });
    this.changed();
  }
  async removeAccount(id: string, accountId: string) {
    await this.#provider(id);
    if (this.#login?.phase === "pending" && this.#login.provider === id) throw new ProviderInputError("Finish or cancel sign-in first.");
    await this.accounts.update(id, (accounts) => {
      if (!accounts.some((a) => a.id === accountId)) throw new ProviderInputError("Unknown account.");
      return accounts.filter((a) => a.id !== accountId);
    });
    await credentialStore(this.accounts.authPath(accountId)).delete(id);
    this.#quota.delete(`${id}/${accountId}`);
    this.changed();
  }
  #pendingLogin() { return this.#login?.phase === "pending"; }
  /** The installation id, created on first use and then re-read from this service's providers directory. A
   * directory HUI cannot write falls back to an id for this process, so sign-in is never blocked by it. */
  #deviceId() { return this.#device ??= readDeviceId(this.dir).catch(() => randomUUID()); }
  async start(id: string, method: unknown, options: { accountId?: unknown; name?: unknown; flow?: unknown } = {}): Promise<ProviderLogin> {
    const provider = await this.#provider(id);
    if (method !== "oauth" && method !== "api_key") throw new ProviderInputError("Choose an authentication method.");
    const flow = loginFlow(options.flow);
    if (!(method === "oauth" ? provider.auth.oauth : provider.auth.apiKey?.login)) throw new ProviderInputError("This authentication method is unavailable.");
    if (this.#pendingLogin()) throw new ProviderInputError("Finish or cancel the current sign-in first.");
    const accounts = await this.accounts.list(id);
    const existing = options.accountId === undefined ? undefined : accounts.find((a) => a.id === options.accountId);
    if (options.accountId !== undefined && !existing) throw new ProviderInputError("Unknown account.");
    if (!existing && accounts.length >= 20) throw new ProviderInputError("At most 20 accounts per provider.");
    const name = options.name ?? existing?.name ?? `Account ${accounts.length + 1}`;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\r\n]/.test(name)) throw new ProviderInputError("Enter an account name (1–80 characters).");
    const accountId = existing?.id ?? (!accounts.length && !readStoredCredential(id, this.accounts.authPath()) ? "default" : randomUUID());
    const runtime = await this.accounts.runtime(accountId);
    if (!runtime.getProvider(id)) { runtime.registerNativeProvider(provider); await runtime.refresh({ allowNetwork: false }); }
    const deviceId = await this.#deviceId();
    // Recheck after async setup so concurrent login requests cannot both start.
    if (this.#pendingLogin()) throw new ProviderInputError("Finish or cancel the current sign-in first.");
    const controller = new AbortController();
    this.#abort = controller;
    const state: ProviderLogin = { id: randomUUID(), provider: id, accountId, phase: "pending", message: "Starting sign-in…", ...(flow ? { flow } : {}) };
    this.#login = state;
    const timeout = setTimeout(() => controller.abort(), flow === "device_code" ? DEVICE_CODE_TIMEOUT_MS : LOGIN_TIMEOUT_MS); timeout.unref();
    // A requested flow answers only the sign-in's first prompt; anything it does not offer stays with the operator.
    let firstPrompt = true;
    void runtime.login(id, method, {
      signal: controller.signal,
      notify: (event) => {
        if (state.phase !== "pending") return;
        if (event.type === "auth_url") { state.url = safeLoginUrl(event.url); state.message = event.instructions ?? "Open the sign-in page."; }
        if (event.type === "device_code") { state.url = safeLoginUrl(event.verificationUri); state.code = event.userCode; }
        if (event.type === "info" || event.type === "progress") state.message = event.message;
      },
      prompt: (prompt) => new Promise<string>((resolve, reject) => {
        const answer = firstPrompt && flow !== undefined && prompt.type === "select" ? prompt.options.find((option) => option.id === flow) : undefined;
        firstPrompt = false;
        if (answer !== undefined) { resolve(answer.id); return; }
        const promptId = randomUUID();
        const signal = prompt.signal ? AbortSignal.any([controller.signal, prompt.signal]) : controller.signal;
        const clear = () => { signal.removeEventListener("abort", abort); if (this.#answer?.id === promptId) { this.#answer = undefined; delete state.prompt; } };
        const abort = () => { clear(); reject(new Error("Sign-in cancelled.")); };
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        state.prompt = { id: promptId, type: prompt.type, message: prompt.message, ...(prompt.type === "select" ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : {}) };
        this.#answer = { id: promptId, prompt, resolve: (value) => { clear(); resolve(value); } };
      }),
    }, { getDeviceId: () => deviceId, agentName: "HUI" }).then(async () => {
      await this.accounts.update(id, (entries) => {
        const updated = { id: accountId, name: name.trim() };
        return entries.some((a) => a.id === accountId) ? entries.map((a) => a.id === accountId ? updated : a) : [...entries, updated];
      });
      state.phase = "complete"; state.message = "Signed in. Select models and save to use this connection.";
      this.#quota.delete(`${id}/${accountId}`); this.changed();
    }).catch((error: unknown) => {
      const cancelled = controller.signal.aborted;
      state.phase = cancelled ? "cancelled" : "failed";
      state.reason = loginFailure(error, cancelled);
      state.message = cancelled ? "Sign-in cancelled or expired." : "Sign-in failed. Try again.";
      // The payload stays generic; the gateway log keeps PI's own cause.
      if (!cancelled) console.error(`[hui] ${id} sign-in failed (${state.reason}): ${failureText(error)}`);
    }).finally(() => {
      clearTimeout(timeout); delete state.prompt; delete state.url; delete state.code; delete state.flow;
      if (this.#login === state) { this.#answer = undefined; this.#abort = undefined; }
    });
    return structuredClone(state);
  }
  answer(id: string, promptId: unknown, value: unknown) {
    if (this.#login?.id !== id || this.#login.phase !== "pending" || !this.#answer || this.#answer.id !== promptId) throw new ProviderInputError("That sign-in prompt has expired.");
    if (typeof value !== "string" || !value.trim() || value.length > 16384 || /[\r\n]/.test(value)) throw new ProviderInputError("Enter a valid sign-in response.");
    if (this.#answer.prompt.type === "select" && !this.#answer.prompt.options.some((option) => option.id === value)) throw new ProviderInputError("Choose one of the sign-in options.");
    this.#answer.resolve(value.trim());
  }
  cancel(id: string) {
    if (this.#login?.id !== id || this.#login.phase !== "pending") throw new ProviderInputError("No pending sign-in.");
    this.#login.phase = "cancelled"; delete this.#login.prompt; delete this.#login.url; delete this.#login.code; delete this.#login.flow;
    this.#abort?.abort(); this.#answer = undefined;
  }
  /** Verifies one catalog model on one account: the first connected account unless one is named. It asks for a
   * one-word reply through that account's own runtime, never a session or the CLI fallback, and reports whether
   * the account answered and how long it took. */
  async test(id: string, model: unknown, requestedAccount?: unknown): Promise<ProviderTest> {
    const provider = await this.#provider(id);
    if (typeof model !== "string" || !provider.getModels().some((entry) => entry.id === model)) throw new ProviderInputError("Choose a model from this provider's catalog.");
    const accounts = await this.accounts.list(id);
    if (requestedAccount !== undefined && (typeof requestedAccount !== "string" || !accounts.some((a) => a.id === requestedAccount))) throw new ProviderInputError("Unknown account.");
    const name = providerName(provider);
    const account = requestedAccount === undefined
      ? accounts.find((entry) => Boolean(readStoredCredential(id, this.accounts.authPath(entry.id))))
      : accounts.find((entry) => entry.id === requestedAccount);
    if (!account || !readStoredCredential(id, this.accounts.authPath(account.id))) return testFailed("auth", name);
    const runtime = await this.accounts.runtime(account.id);
    if (!runtime.getProvider(id)) { runtime.registerNativeProvider(provider); await runtime.refresh({ allowNetwork: false }); }
    const target = runtime.getModel(id, model);
    if (!target) return testFailed("unknown", name);
    return testProviderModel(runtime, target, name);
  }
  async quota(id: string, requestedAccount?: string): Promise<ProviderQuota> {
    await this.#provider(id);
    const accounts = await this.accounts.list(id);
    const accountId = requestedAccount ?? accounts[0]?.id ?? "default";
    if (requestedAccount && !accounts.some((a) => a.id === accountId)) throw new ProviderInputError("Unknown account.");
    const key = `${id}/${accountId}`;
    const cached = this.#quota.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async (): Promise<ProviderQuota> => {
      if (id !== "anthropic" && id !== "openai-codex" && id !== "opencode-go" && id !== "mistral") return { status: "unsupported", checkedAt: Date.now(), windows: [], message: "This provider does not expose a supported subscription quota API." };
      try {
        const credential = readStoredCredential(id, this.accounts.authPath(accountId));
        let quota: ProviderQuota;
        if (id === "opencode-go" || id === "mistral") {
          if (credential?.type !== "api_key" || typeof credential.key !== "string" || !credential.key) return { status: "unsupported", checkedAt: Date.now(), windows: [], message: id === "mistral" ? "Mistral usage requires an API key saved by HUI." : "OpenCode Go usage requires an API key saved by HUI." };
          // Read this account's credential only; never use ambient environment keys.
          quota = await fetchProviderQuota(id, credential.key);
        } else {
          if (credential?.type !== "oauth") return { status: "unsupported", checkedAt: Date.now(), windows: [], message: "Subscription usage requires an OAuth connection saved by HUI for this provider." };
          const runtime = await this.accounts.runtime(accountId);
          await runtime.getAuth(id, { signal: AbortSignal.timeout(8_000) });
          const refreshed = readStoredCredential(id, this.accounts.authPath(accountId));
          if (refreshed?.type !== "oauth") throw new Error("No subscription credential.");
          quota = await fetchProviderQuota(id, refreshed.access, typeof refreshed["accountId"] === "string" ? refreshed["accountId"] : undefined);
          const email = credentialEmail(id, refreshed);
          if (email) quota.email = email;
        }
        // Model-specific windows must not disable other models on the account.
        const blockedUntil = Math.max(0, ...quota.windows.filter((window) => window.usedPercent >= 100 && window.scope === "account").map((window) => window.resetAt ?? 0));
        if (blockedUntil > Date.now()) await this.accounts.cooldown(id, accountId, blockedUntil);
        return quota;
      } catch { return { status: "unavailable", checkedAt: Date.now(), windows: [], message: "Quota could not be retrieved. Sign in again or retry later." }; }
    })();
    this.#quota.set(key, { expires: Date.now() + 60_000, value }); return value;
  }
}
function safeLoginUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
