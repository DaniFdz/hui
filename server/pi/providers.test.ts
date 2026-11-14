import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expectTypeOf, test, type TestContext, vi } from "vitest";
import { ProviderSnapshot, ProviderLogin, ProviderQuota, ProviderTest, type ProviderModel, type ProviderSummary } from "../api/providers.ts";
import { expectSchema } from "../test-support/api-schema.ts";


type OriginalProviderModel = { id: string; name: string; contextWindow?: number; maxTokens?: number };
type OriginalProviderSummary = {
  id: string; name: string; methods: { id: "api_key" | "oauth"; label: string }[];
  accounts?: { id: string; name: string; email?: string; authenticated: boolean; cooldownUntil?: number }[];
  configured: boolean; authenticated: boolean; selected: string[]; models: OriginalProviderModel[];
};
type OriginalProviderLogin = {
  id: string; provider: string; phase: "pending" | "complete" | "failed" | "cancelled";
  accountId?: string;
  message?: string; url?: string; code?: string;
  flow?: "browser" | "device_code" | "copy_code";
  reason?: "cancelled" | "expired" | "stale_link" | "port_in_use" | "network" | "unknown";
  prompt?: { id: string; type: "text" | "secret" | "select" | "manual_code"; message: string; options?: { id: string; label: string }[] };
};
type OriginalProviderSnapshot = { providers: OriginalProviderSummary[]; login?: OriginalProviderLogin };
type OriginalProviderTest =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "auth" | "rate_limit" | "billing" | "timeout" | "format" | "unavailable" | "unknown"; message: string };
type OriginalProviderQuota = {
  status: "available" | "unsupported" | "unavailable";
  message?: string; checkedAt: number;
  plan?: string; email?: string;
  access?: "available" | "limited";
  windows: { label: string; usedPercent: number; resetAt?: number; detail?: string; scope: "account" | "scoped" | "spend" }[];
};

expectTypeOf<ProviderModel>().toEqualTypeOf<OriginalProviderModel>();
expectTypeOf<ProviderSummary>().toEqualTypeOf<OriginalProviderSummary>();
expectTypeOf<ProviderLogin>().toEqualTypeOf<OriginalProviderLogin>();
expectTypeOf<ProviderSnapshot>().toEqualTypeOf<OriginalProviderSnapshot>();
expectTypeOf<ProviderTest>().toEqualTypeOf<OriginalProviderTest>();
expectTypeOf<ProviderQuota>().toEqualTypeOf<OriginalProviderQuota>();
import { ProviderService, ProviderInputError } from "./providers.ts";
import { createSessionModelRuntime, readProviderSelections, writeProviderSelections } from "../runtimes/hui-models.ts";
import { filterConfiguredModels } from "../runtimes/pi-models.ts";
import { waitFor } from "../test-support/wait-for.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "hui-provider-test-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return { dir, service: new ProviderService(dir) };
}
async function until<T extends object>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  return waitFor("the provider state", async () => {
    last = await read();
    return predicate(last) ? last : undefined;
  }, { state: () => last });
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fixtureCredential = { type: "oauth" as const, access: "fixture-access", refresh: "fixture-refresh", expires: Date.now() + 3600_000 };

test("built-in API key login stores credentials only in HUI and redacts snapshots", async (t) => {
  const { dir, service } = await fixture(t);
  const first = await service.snapshot();
  expectSchema(ProviderSnapshot, first);
  assert(first.providers.some((provider) => provider.id === "openai-codex" && provider.methods.some((method) => method.id === "oauth")));
  const login = await service.start("openai", "api_key");
  expectSchema(ProviderLogin, login);
  const waiting = await until(() => service.snapshot(), (snapshot) => Boolean(snapshot.login?.prompt));
  expectSchema(ProviderSnapshot, waiting);
  assert.equal(waiting.login?.prompt?.type, "secret");
  assert.throws(() => service.answer(login.id, "stale", "fixture-key"), ProviderInputError);
  service.answer(login.id, waiting.login!.prompt!.id, "hui-fixture-secret-not-real");
  const complete = await until(() => service.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  assert.equal(complete.providers.find((provider) => provider.id === "openai")?.authenticated, true);
  assert(!JSON.stringify(complete).includes("hui-fixture-secret-not-real"));
  assert.equal(JSON.parse(await readFile(join(dir, "auth.json"), "utf8")).openai.key, "hui-fixture-secret-not-real");
  assert.equal((await stat(join(dir, "auth.json"))).mode & 0o777, 0o600);
  const models = complete.providers.find((provider) => provider.id === "openai")!.models.slice(0, 2);
  assert.equal(models.length, 2);
  assert(models.every((model) => (model.contextWindow ?? 0) > 0 && (model.maxTokens ?? 0) > 0));
  await service.save("openai", models.map((model) => model.id));
  assert.deepEqual((await readProviderSelections(dir)).openai?.models, models.map((model) => model.id));
  assert.equal((await service.snapshot()).login, undefined, "saving clears obsolete sign-in instructions");
  const restarted = new ProviderService(dir);
  assert.equal((await restarted.snapshot()).providers.find((provider) => provider.id === "openai")?.selected.length, 2);
  await restarted.disconnect("openai");
  assert.deepEqual(await readProviderSelections(dir), {});
  assert.equal(JSON.parse(await readFile(join(dir, "auth.json"), "utf8")).openai, undefined);
});

test("cancellation and bounded input do not save a pending credential", async (t) => {
  const { dir, service } = await fixture(t);
  await assert.rejects(service.start("custom", "api_key"), /custom providers in PI/);
  await assert.rejects(service.start("openai", "invalid"), ProviderInputError);
  const login = await service.start("openai", "api_key");
  const waiting = await until(() => service.snapshot(), (snapshot) => Boolean(snapshot.login?.prompt));
  await assert.rejects(service.start("anthropic", "api_key"), /Finish or cancel/);
  assert.throws(() => service.answer(login.id, waiting.login!.prompt!.id, "x".repeat(16385)), /valid sign-in/);
  service.cancel(login.id);
  assert.throws(() => service.answer(login.id, waiting.login!.prompt!.id, "unused"), /expired/);
  assert.equal((await service.snapshot()).login?.phase, "cancelled");
  const auth = await readFile(join(dir, "auth.json"), "utf8").catch(() => "{}");
  assert.equal(JSON.parse(auth).openai, undefined);
});

test("selection validation, concurrent saves and empty selection preserve ownership", async (t) => {
  const { dir, service } = await fixture(t);
  await assert.rejects(service.save("__proto__", []), ProviderInputError);
  await assert.rejects(service.save("openai", ["missing-model"]), ProviderInputError);
  await assert.rejects(service.save("openai", "all"), ProviderInputError);
  const snapshot = await service.snapshot();
  const openai = snapshot.providers.find((p) => p.id === "openai")!.models[0]!.id;
  const anthropic = snapshot.providers.find((p) => p.id === "anthropic")!.models[0]!.id;
  await Promise.all([service.save("openai", [openai, openai]), service.save("anthropic", [anthropic])]);
  assert.deepEqual(await readProviderSelections(dir), { openai: { models: [openai] }, anthropic: { models: [anthropic] } });
  await service.save("openai", []);
  assert.deepEqual((await readProviderSelections(dir)).openai?.models, []);
  const broken = join(dir, "models.json"); await writeFile(broken, "{");
  await assert.rejects(service.save("openai", [openai]), /configuration could not be read/);
  assert.equal(await readFile(broken, "utf8"), "{");
});

test("HUI credentials overlay built-ins without changing PI custom configuration", async (t) => {
  const { dir, service } = await fixture(t);
  const agentDir = join(dir, "pi");
  await (await import("node:fs/promises")).mkdir(agentDir);
  const pi = join(agentDir, "models.json");
  const source = JSON.stringify({ providers: { openai: { baseUrl: "https://wrong-account.invalid", apiKey: "wrong-pi-key" }, custom: { baseUrl: "http://127.0.0.1:1", api: "openai-completions", apiKey: "pi-fixture", models: [{ id: "custom/model", name: "Custom", contextWindow: 32000, maxTokens: 2048 }] } } });
  await writeFile(pi, source);
  await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "hui-key" } }), { mode: 0o600 });
  const model = (await service.snapshot()).providers.find((p) => p.id === "openai")!.models[0]!.id;
  await service.save("openai", [model]);
  const runtime = await createSessionModelRuntime(agentDir, dir);
  assert.equal((await runtime.getAuth("openai"))?.auth.apiKey, "hui-key");
  assert(!runtime.getModel("openai", model)?.baseUrl.includes("wrong-account"));
  assert.equal((await runtime.getAuth("custom"))?.auth.apiKey, "pi-fixture");
  assert(runtime.getAvailableSnapshot().some((m) => m.provider === "openai"));
  assert.equal(await readFile(pi, "utf8"), source);
  assert.equal(await readFile(join(agentDir, "auth.json"), "utf8").catch(() => "{}"), "{}");
  const catalog = runtime.getAvailableSnapshot().map(({ id, provider, name }) => ({ id, provider, name }));
  await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { custom: { models: [{ id: "custom/model" }] } } }));
  const filtered = await filterConfiguredModels(catalog, dir, { openai: { models: [model] } });
  assert.deepEqual(filtered.map((m) => `${m.provider}/${m.id}`).sort(), [`openai/${model}`, "custom/custom/model"].sort());
  assert(!JSON.stringify(filtered).includes("hui-key"));
});

test("empty HUI selection is empty, PI custom selection retains exact namespaced IDs", async (t) => {
  const { dir } = await fixture(t);
  await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { custom: { models: [{ id: "a/b" }] } } }));
  const catalog = [{ provider: "openai", id: "one", name: "One" }, { provider: "custom", id: "a/b", name: "Custom" }];
  assert.deepEqual(await filterConfiguredModels(catalog, dir, { openai: { models: [] } }), [catalog[1]]);
  await writeProviderSelections({ openai: { models: ["one"] } }, join(dir, "hui"));
  assert.equal((await stat(join(dir, "hui", "models.json"))).mode & 0o777, 0o600);
});

test("OAuth interaction forwards device links and prompts but never returned tokens", async (t) => {
  const { service } = await fixture(t);
  const runtime = await service.runtime();
  const base = runtime.getProvider("openai")!;
  runtime.registerNativeProvider({ ...base, id: "fixture-oauth", name: "Fixture OAuth", auth: { oauth: {
    name: "Fixture subscription",
    async login(interaction) {
      interaction.notify({ type: "device_code", userCode: "FIXTURE", verificationUri: "https://example.invalid/verify" });
      const answer = await interaction.prompt({ type: "manual_code", message: "Paste the callback" });
      assert.equal(answer, "fixture-callback");
      return { type: "oauth", access: "private-access", refresh: "private-refresh", expires: Date.now() + 3600_000 };
    },
    async refresh(credential) { return credential; },
    async toAuth(credential) { return { apiKey: credential.access }; },
  } } });
  const login = await service.start("fixture-oauth", "oauth");
  const pending = await until(() => service.snapshot(), (snapshot) => Boolean(snapshot.login?.prompt));
  assert.equal(pending.login?.url, "https://example.invalid/verify");
  assert.equal(pending.login?.code, "FIXTURE");
  service.answer(login.id, pending.login!.prompt!.id, "fixture-callback");
  const complete = await until(() => service.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  assert(!JSON.stringify(complete).includes("private-"));
  assert.equal(complete.login?.url, undefined);
  assert.equal(complete.login?.code, undefined);
});

test("the removed Claude Code CLI connection is not offered or accepted", async (t) => {
  const { service } = await fixture(t);
  assert.equal((await service.snapshot()).providers.some((provider) => provider.id === "claude-code"), false);
  await assert.rejects(service.save("claude-code", ["sonnet"]), ProviderInputError);
});

test("multiple accounts preserve legacy credentials, persist priority and isolate removal", async (t) => {
  const { dir, service } = await fixture(t);
  await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "legacy-key" } }), { mode: 0o600 });
  await service.save("openai", []);
  const login = await service.start("openai", "api_key", { name: "Backup" });
  const waiting = await until(() => service.snapshot(), (s) => Boolean(s.login?.prompt));
  service.answer(login.id, waiting.login!.prompt!.id, "backup-key");
  const complete = await until(() => service.snapshot(), (s) => s.login?.phase === "complete");
  const accounts = complete.providers.find((p) => p.id === "openai")!.accounts!;
  assert.deepEqual(accounts.map((a) => a.name), ["Account 1", "Backup"]);
  assert.equal(JSON.parse(await readFile(join(dir, "auth.json"), "utf8")).openai.key, "legacy-key");
  assert(!JSON.stringify(complete).includes("backup-key"));
  assert.equal((await stat(join(dir, "accounts.json"))).mode & 0o777, 0o600);
  await service.reorder("openai", accounts.map((a) => a.id).reverse());
  const restarted = new ProviderService(dir);
  assert.equal((await restarted.accounts.list("openai"))[0]!.name, "Backup");
  await assert.rejects(service.reorder("openai", ["default", "default"]), ProviderInputError);
  await assert.rejects(service.start("openai", "api_key", { accountId: "../../bad" }), ProviderInputError);
  await assert.rejects(service.quota("openai", "missing"), ProviderInputError);
  await service.removeAccount("openai", "default");
  const runtime = await createSessionModelRuntime(join(dir, "pi"), dir);
  assert.equal((await runtime.getAuth("openai"))?.auth.apiKey, "backup-key");
  assert(runtime.getAvailableSnapshot().some((m) => m.provider === "openai"));
  assert.deepEqual((await readProviderSelections(dir)).openai?.models, []);
  await service.disconnect("openai");
  assert.deepEqual(await service.accounts.list("openai"), []);
});

test("cancelled extra login leaves existing account and priority unchanged", async (t) => {
  const { dir, service } = await fixture(t);
  await writeFile(join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "legacy-key" } }));
  const login = await service.start("openai", "api_key", { name: "Cancelled" });
  await until(() => service.snapshot(), (s) => Boolean(s.login?.prompt));
  service.cancel(login.id);
  await until(() => service.snapshot(), (s) => s.login?.phase === "cancelled");
  assert.deepEqual(await service.accounts.list("openai"), [{ id: "default", name: "Account 1" }]);
  assert.equal(JSON.parse(await readFile(join(dir, "auth.json"), "utf8")).openai.key, "legacy-key");
});


test("a disconnected preferred account does not hide a connected backup from the catalog", async (t) => {
  const { dir, service } = await fixture(t);
  const { credentialStore } = await import("./provider-accounts.ts");
  const backup = "22222222-2222-4222-8222-222222222222";
  await service.accounts.update("openai", () => [{ id: "default", name: "Missing" }, { id: backup, name: "Backup" }]);
  await credentialStore(service.accounts.authPath(backup)).modify("openai", async () => ({ type: "api_key", key: "backup-only" }));
  await service.save("openai", ["gpt-4o"]);
  const snapshot = (await service.snapshot()).providers.find((p) => p.id === "openai")!;
  assert(snapshot.authenticated);
  assert.deepEqual(snapshot.accounts?.map((a) => a.authenticated), [false, true]);
  const runtime = await createSessionModelRuntime(join(dir, "pi"), dir);
  assert.equal((await runtime.getAuth("openai"))?.auth.apiKey, "backup-only");
  assert(runtime.getAvailableSnapshot().some((m) => m.provider === "openai"));
});


test("quota cooldown uses account scope, never model, feature or spending budgets", async (t) => {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  let globalPercent = 12;
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    rate_limit: { primary_window: { used_percent: globalPercent, reset_at: reset } },
    additional_rate_limits: [{ limit_name: "New model", rate_limit: { primary_window: { used_percent: 100, reset_at: reset + 5000 } } }],
    code_review_rate_limit: { primary_window: { used_percent: 100, reset_at: reset + 10000 } },
    individual_limit: { limit: 100, used: 100, reset_at: reset + 20000 },
  })));
  for (const exhausted of [false, true]) {
    globalPercent = exhausted ? 100 : 12;
    const { dir, service } = await fixture(t);
    await writeFile(join(dir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", expires: Date.now() + 3600000 } }), { mode: 0o600 });
    const quota = await service.quota("openai-codex");
    expectSchema(ProviderQuota, quota);
    assert.equal(quota.status, "available");
    assert.equal(quota.windows.length, 4);
    assert.equal((await service.accounts.list("openai-codex"))[0]?.cooldownUntil, exhausted ? reset * 1000 : undefined);
  }
});

test("same-email accounts retain separate IDs and refresh their display identity without persistence changes", async (t) => {
  const { service } = await fixture(t);
  const { credentialStore } = await import("./provider-accounts.ts");
  const backup = "33333333-3333-4333-8333-333333333333";
  const credential = (email: string) => ({ type: "oauth" as const, access: `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email } })).toString("base64url")}.c`, refresh: "private-refresh", expires: Date.now() + 3600000 });
  await service.accounts.update("openai-codex", () => [{ id: "default", name: "Personal" }, { id: backup, name: "Work" }]);
  for (const id of ["default", backup]) await credentialStore(service.accounts.authPath(id)).modify("openai-codex", async () => credential("same@example.com"));
  const accounts = (await service.snapshot()).providers.find((p) => p.id === "openai-codex")!.accounts!;
  assert.deepEqual(accounts.map((a) => [a.id, a.email]), [["default", "same@example.com"], [backup, "same@example.com"]]);
  assert(!JSON.stringify(accounts).includes("private-refresh"));
  await credentialStore(service.accounts.authPath(backup)).modify("openai-codex", async () => credential("new@example.com"));
  assert.equal((await service.snapshot()).providers.find((p) => p.id === "openai-codex")!.accounts![1]!.email, "new@example.com");
  assert.deepEqual((await service.accounts.list("openai-codex")).map((a) => a.name), ["Personal", "Work"]);
});

test("Go quota uses and caches each HUI account key independently, with monthly cooldown", async (t) => {
  const { service } = await fixture(t);
  const { credentialStore } = await import("./provider-accounts.ts");
  const backup = "44444444-4444-4444-8444-444444444444";
  await service.accounts.update("opencode-go", () => [{ id: "default", name: "Personal" }, { id: backup, name: "Backup" }]);
  for (const id of ["default", backup]) await credentialStore(service.accounts.authPath(id)).modify("opencode-go", async () => ({ type: "api_key", key: `synthetic-${id}` }));
  const calls: string[] = [];
  const reset = new Date(Date.now() + 3600000).toISOString();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://opencode.ai/zen/go/v1/usage");
    const key = (init.headers as Record<string, string>).Authorization!; calls.push(key);
    return new Response(JSON.stringify({ usage: { rolling: { percent: 1 }, weekly: { percent: 2 }, monthly: { percent: key.endsWith("default") ? 100 : 3, resetsAt: reset } } }));
  });
  const quota = await service.quota("opencode-go", "default");
  assert.equal(quota.windows.length, 3);
  await service.quota("opencode-go", "default");
  await service.quota("opencode-go", backup);
  assert.deepEqual(calls, ["Bearer synthetic-default", `Bearer synthetic-${backup}`]);
  assert.equal((await service.accounts.list("opencode-go"))[0]?.cooldownUntil, Date.parse(reset));
  assert.equal((await service.accounts.list("opencode-go"))[1]?.cooldownUntil, undefined);
});

test("Mistral quota reads both allowances from the HUI-saved key without cooling the account down", async (t) => {
  const missing = await (await fixture(t)).service.quota("mistral");
  assert.equal(missing.status, "unsupported");
  assert.match(missing.message!, /requires an API key saved by HUI/);
  const { service } = await fixture(t);
  const { credentialStore } = await import("./provider-accounts.ts");
  await service.accounts.update("mistral", () => [{ id: "default", name: "Student" }]);
  await credentialStore(service.accounts.authPath()).modify("mistral", async () => ({ type: "api_key", key: "synthetic-mistral" }));
  const reset = new Date(Date.now() + 86400000).toISOString();
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith("/billing/subscription")) return new Response(JSON.stringify({ plan_name: "EDU", payg_enabled: false, vibe_payg_enabled: false }));
    return new Response(JSON.stringify({
      api_budget: { usage_percentage: 100, initial_budget: 15, currency: "EUR", reset_at: reset },
      vibe_budget: { usage_percentage: 5, initial_budget: 15, currency: "EUR", reset_at: reset },
    }));
  });
  const quota = await service.quota("mistral");
  assert.equal(quota.plan, "Student");
  assert.deepEqual(quota.windows.map((w) => [w.label, w.usedPercent, w.detail]), [["API · monthly", 100, "15.00 EUR included"], ["Vibe Code · monthly", 5, "15.00 EUR included"]]);
  assert.equal(quota.access, undefined);
  await service.quota("mistral");
  assert.equal(calls.length, 2, "a second read inside the minute reuses the cached reply without refetching");
  assert.equal((await service.accounts.list("mistral"))[0]?.cooldownUntil, undefined, "a spend allowance never disables the account");
  vi.unstubAllGlobals();
});

test("the ChatGPT sign-in receives one persisted installation id that never reaches the browser", async (t) => {
  const { dir, service } = await fixture(t);
  const seen: { id?: string; agent?: string }[] = [];
  const register = (runtime: ModelRuntime) => runtime.registerNativeProvider({ ...runtime.getProvider("openai")!, id: "fixture-device", name: "Fixture Device", auth: { oauth: {
    name: "Fixture device",
    login: async (_interaction, options) => {
      seen.push({ id: options?.getDeviceId?.(), agent: options?.agentName });
      return fixtureCredential;
    },
    refresh: async (credential) => credential,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  } } });
  const snapshots: ProviderSnapshot[] = [];
  const read = async () => { const snapshot = await service.snapshot(); snapshots.push(snapshot); return snapshot; };
  register(await service.runtime());
  const started = await service.start("fixture-device", "oauth");
  const complete = await until(read, (snapshot) => snapshot.login?.phase === "complete");
  const first = seen[0]?.id ?? "";
  assert.match(first, UUID, "the flow is handed a UUID for this installation");
  assert.equal(seen[0]?.agent, "HUI");
  const stored = JSON.parse(await readFile(join(dir, "device.json"), "utf8")) as { id?: string };
  assert.deepEqual(Object.keys(stored), ["id"]);
  assert.equal(stored.id, first);
  assert.equal((await stat(join(dir, "device.json"))).mode & 0o777, 0o600);
  assert(!JSON.stringify([started, complete, snapshots]).includes(first), "the installation id stays on the gateway");

  const restarted = new ProviderService(dir);
  register(await restarted.runtime());
  await restarted.start("fixture-device", "oauth", { accountId: "default" });
  await until(() => restarted.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  assert.equal(seen[1]?.id, first, "a restarted gateway reuses the persisted id");

  await writeFile(join(dir, "device.json"), "{");
  const repaired = new ProviderService(dir);
  register(await repaired.runtime());
  await repaired.start("fixture-device", "oauth", { accountId: "default" });
  const fixed = await until(() => repaired.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  const repairedId = seen[2]?.id ?? "";
  assert.match(repairedId, UUID);
  assert.notEqual(repairedId, first, "a corrupt file is replaced rather than reused");
  assert.equal((JSON.parse(await readFile(join(dir, "device.json"), "utf8")) as { id?: string }).id, repairedId);
  assert(!JSON.stringify(fixed).includes(repairedId));
});

test("a requested sign-in flow answers the first select prompt silently, and an unsupported one still asks", async (t) => {
  const { service } = await fixture(t);
  const chosen: Record<string, string> = {};
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  t.onTestFinished(() => release());
  const register = (runtime: ModelRuntime, id: string, gate?: Promise<void>) => runtime.registerNativeProvider({ ...runtime.getProvider("openai")!, id, name: `Fixture ${id}`, auth: { oauth: {
    name: "Fixture flow",
    login: async (interaction) => {
      chosen[id] = await interaction.prompt({ type: "select", message: "How do you want to sign in?", options: [{ id: "browser", label: "In the browser" }, { id: "device_code", label: "With a device code" }] });
      await gate;
      return fixtureCredential;
    },
    refresh: async (credential) => credential,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  } } });
  const runtime = await service.runtime();
  register(runtime, "fixture-flow", held);
  const login = await service.start("fixture-flow", "oauth", { flow: "device_code" });
  assert.equal(login.flow, "device_code", "the requested flow is echoed while the sign-in is pending");
  await waitFor("the flow's prompt to be answered on the gateway", () => chosen["fixture-flow"] === undefined ? undefined : true);
  const waiting = await service.snapshot();
  assert.equal(waiting.login?.prompt, undefined, "an auto-answered prompt never reaches the browser");
  assert.equal(waiting.login?.phase, "pending");
  release();
  const complete = await until(() => service.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  assert.equal(chosen["fixture-flow"], "device_code");
  assert.equal(complete.login?.prompt, undefined);

  register(runtime, "fixture-unmatched");
  const unmatched = await service.start("fixture-unmatched", "oauth", { flow: "copy_code" });
  const asking = await until(() => service.snapshot(), (snapshot) => Boolean(snapshot.login?.prompt));
  assert.equal(asking.login?.prompt?.type, "select");
  assert.deepEqual(asking.login?.prompt?.options?.map((option) => option.id), ["browser", "device_code"]);
  assert.equal(asking.login?.flow, "copy_code", "a flow the provider does not offer is still reported");
  service.answer(unmatched.id, asking.login!.prompt!.id, "browser");
  const answered = await until(() => service.snapshot(), (snapshot) => snapshot.login?.phase === "complete");
  assert.equal(chosen["fixture-unmatched"], "browser");
  assert.equal(answered.login?.reason, undefined, "a completed sign-in reports no failure");

  await assert.rejects(service.start("openai", "oauth", { flow: "sms" }), ProviderInputError);
});

test("a failed sign-in reports why, keeping PI's own error out of the payload and in the log", async (t) => {
  const { service } = await fixture(t);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  t.onTestFinished(() => logged.mockRestore());
  const runtime = await service.runtime();
  const failing = (id: string, message: string) => runtime.registerNativeProvider({ ...runtime.getProvider("openai")!, id, name: "Fixture failure", auth: { oauth: {
    name: "Fixture failure",
    login: async () => { throw new Error(message); },
    refresh: async (credential) => credential,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  } } });
  const cases = [
    ["fixture-port", "listen EADDRINUSE: port 1455 is in use", "port_in_use"],
    ["fixture-stale", "OAuth state mismatch. Start the sign-in again.", "stale_link"],
    ["fixture-network", "fetch failed: getaddrinfo ENOTFOUND auth.example.invalid", "network"],
  ] as const;
  for (const [id, message, reason] of cases) {
    failing(id, message);
    await service.start(id, "oauth");
    const failed = await until(() => service.snapshot(), (snapshot) => snapshot.login?.phase === "failed");
    expectSchema(ProviderSnapshot, failed);
    assert.equal(failed.login?.reason, reason);
    assert.equal(failed.login?.message, "Sign-in failed. Try again.", "the generic sentence stays for older clients");
    assert(!JSON.stringify(failed).includes(message), "PI's raw error never reaches the browser");
  }
  const log = logged.mock.calls.flat().map(String).join("\n");
  for (const [, message] of cases) assert(log.includes(message), `the gateway log keeps PI's cause: ${message}`);
  assert.equal(log.split("port 1455 is in use").length - 1, 1, "each cause is logged once");
});

test("a model test measures a one-word reply and classifies a rejected credential safely", async (t) => {
  const { service } = await fixture(t);
  const { credentialStore } = await import("./provider-accounts.ts");
  const runtime = await service.runtime();
  const template = runtime.getModels("openai")[0]!;
  const model = (id: string) => ({ ...template, id: `${id}-model`, provider: id, name: `${id} model` });
  const register = (id: string, reply: "ok" | "empty" | "auth") => runtime.registerNativeProvider({
    ...runtime.getProvider("openai")!, id, name: `Fixture ${id}`,
    getModels: () => [model(id)],
    getAllModels: () => [model(id)],
    streamSimple: () => {
      const output = createAssistantMessageEventStream();
      if (reply === "auth") output.push({ type: "error", reason: "error", error: fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized: invalid key sk-fixture-not-real" }) });
      else output.push({ type: "done", reason: "stop", message: fauxAssistantMessage(reply === "ok" ? "OK" : "") });
      output.end();
      return output;
    },
  });
  for (const [id, reply] of [["fixture-model", "ok"], ["fixture-empty", "empty"], ["fixture-denied", "auth"]] as const) {
    register(id, reply);
    await credentialStore(service.accounts.authPath()).modify(id, async () => ({ type: "api_key", key: "sk-fixture-not-real" }));
  }
  const ok = await service.test("fixture-model", "fixture-model-model");
  expectSchema(ProviderTest, ok);
  assert(ok.ok, `the fixture model answers: ${JSON.stringify(ok)}`);
  assert(Number.isFinite(ok.latencyMs) && ok.latencyMs >= 0);

  const empty = await service.test("fixture-empty", "fixture-empty-model");
  expectSchema(ProviderTest, empty);
  assert(!empty.ok, "an empty answer fails");
  assert.equal(empty.reason, "format");
  assert.match(empty.message, /Fixture fixture-empty/);

  const denied = await service.test("fixture-denied", "fixture-denied-model", "default");
  expectSchema(ProviderTest, denied);
  assert(!denied.ok, "a rejected credential fails");
  assert.equal(denied.reason, "auth");
  assert.match(denied.message, /Fixture fixture-denied rejected the saved credentials/);
  assert(!JSON.stringify(denied).includes("sk-fixture-not-real"));
  assert(!JSON.stringify(denied).includes("401"));

  register("fixture-signed-out", "ok");
  const signedOut = await service.test("fixture-signed-out", "fixture-signed-out-model");
  assert(!signedOut.ok, "an unconnected provider is not tested");
  assert.equal(signedOut.reason, "auth");

  await assert.rejects(service.test("fixture-model", "missing-model"), ProviderInputError);
  await assert.rejects(service.test("fixture-model", "fixture-model-model", "missing-account"), ProviderInputError);
  await assert.rejects(service.test("custom", "fixture-model-model"), /custom providers in PI/);
});
