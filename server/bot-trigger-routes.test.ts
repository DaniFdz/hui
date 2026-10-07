import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import type { BotTriggerCreated, BotTriggersList } from "../shared/bot-triggers.ts";
import { BOTS_OFF_MESSAGE, type BotView } from "../shared/bots.ts";
import type { BotIO } from "../cli/bots.ts";

// One isolated gateway: HUI's directory, PI's agent directory, a deterministic provider and a fake GitHub behind a
// fake gh, all temporary.
const dir = await mkdtemp(join(tmpdir(), "hui-check-trigger-routes-"));
const agentDir = join(dir, "agent");
const workspace = join(dir, "workspace");
const ghDir = join(dir, "gh");
await mkdir(agentDir);
await mkdir(workspace);
await mkdir(ghDir);
process.env["XDG_CONFIG_HOME"] = join(dir, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
process.env["HUI_GITHUB_CLI"] = fileURLToPath(new URL("../e2e/github-triggers-fixture.mjs", import.meta.url));
process.env["HUI_FAKE_GH_DIR"] = ghDir;
process.env["HUI_TRIGGER_POLL_SECONDS"] = "1";
const log = join(dir, "requests.jsonl");
const provider = spawn(process.execPath, [fileURLToPath(new URL("../e2e/pi-provider-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: workspace, HUI_E2E_PROVIDER_LOG: log },
});
const [ready] = await once(provider.stdout!, "data");
const providerUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
assert(providerUrl, String(ready));
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: providerUrl, api: "anthropic-messages", apiKey: "***", models: [{ id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "low" }));
await mkdir(join(dir, "config", "hui"), { recursive: true });
await writeFile(join(dir, "config", "hui", "settings.json"), JSON.stringify({ labs: { bots: true } }));
const PAST = "2026-09-01T10:00:00Z";
const pull = (number: number, author: string, created: string) => ({
  number, title: `Pull request ${number}`, html_url: `https://github.com/acme/widgets/pull/${number}`, state: "open", draft: false, user: { login: author },
  head: { ref: `feature-${number}`, sha: String(number).repeat(40).slice(0, 40) }, base: { ref: "main" }, labels: [], created_at: created, updated_at: created, merged_at: null, body: "",
});
const github = { login: "operator", repos: { "acme/widgets": { pulls: [pull(1, "alice", PAST)] } } };
await writeFile(join(ghDir, "github.json"), JSON.stringify(github));

const { middleware, startBackend, stopBackend } = await import("./hui.ts");
const { triggerCommand } = await import("../cli/bot-triggers.ts");
let origin = "";
const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));

before(async () => {
  await startBackend();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const exit = once(provider, "exit");
  provider.kill();
  await exit;
  await rm(dir, { recursive: true, force: true });
});

async function call(path: string, method = "GET", body?: unknown, guard = true): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(guard ? { "x-hui": "1" } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: response.status, body: parsed };
}

/** A webhook call as another program makes it: no x-hui, a body of its own. */
async function hook(path: string, body: string, type = "application/json", method = "POST"): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin + path, { method, headers: { "content-type": type }, ...(method === "GET" ? {} : { body }) });
  return { status: response.status, body: JSON.parse(await response.text() || "{}") as Record<string, unknown> };
}

async function until<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Whether a provider request's newest message contains `text` (compared as the JSON the request carries it in). */
async function asked(text: string): Promise<boolean> {
  const lines = (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  const needle = JSON.stringify(text).slice(1, -1);
  return lines.some((line) => {
    const request = JSON.parse(line) as { messages?: unknown[] };
    return JSON.stringify(request.messages?.at(-1) ?? "").includes(needle);
  });
}

const call64 = (calls: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;
let ada: BotView;

test("a webhook trigger wakes its bot through the gateway; its token, method, size cap and filter are checked", { timeout: 120_000 }, async () => {
  const created = await call("/__hui/bots", "POST", { name: "Ada", soul: "# Ada\nA fixture bot." });
  assert.equal(created.status, 201);
  ada = created.body["bot"] as BotView;
  assert.equal((await call(`/__hui/bots/${ada.id}/triggers`, "GET", undefined, false)).status, 403, "the trigger routes keep the local-client guard");
  const refused = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "x", source: "github", filter: { repos: ["nope"], events: ["pr_opened"] } });
  assert.equal(refused.status, 400);
  const made = await call(`/__hui/bots/${ada.handle}/triggers`, "POST", { name: "Deploys", source: "webhook", prompt: "E2E_TRIGGER_PROMPT summarize it", filter: { match: { field: "status", op: "equals", value: "failed" } } });
  assert.equal(made.status, 201);
  const { hook: token, trigger } = made.body as unknown as BotTriggerCreated;
  assert.ok(token);
  const listed = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  assert.ok(!JSON.stringify(listed).includes(token.token), "the token is shown once, never listed");
  assert.equal(listed.triggers[0]?.tokenHint, token.token.slice(0, 4));

  assert.equal((await hook(`/__hui/hooks/${"x".repeat(43)}`, "{}")).status, 404, "a token no trigger has");
  assert.equal((await hook("/__hui/hooks/short", "{}")).status, 404);
  assert.equal((await hook(token.path, "", "application/json", "GET")).status, 405);
  assert.equal((await hook(token.path, JSON.stringify({ blob: "x".repeat(70 * 1024) }))).status, 413, "a body over 64 KiB");
  assert.equal((await hook(token.path, "{not json")).status, 400);
  assert.deepEqual(await hook(token.path, JSON.stringify({ status: "ok" })), { status: 202, body: { status: "ignored" } }, "the filter lets only failures through");
  assert.deepEqual(await hook(token.path, JSON.stringify({ status: "failed", title: "Deploy 7" })), { status: 202, body: { status: "fired" } });
  await until("the delivery in the bot's chat", async () => (await asked("[trigger: Deploys · webhook call (title: Deploy 7)] E2E_TRIGGER_PROMPT summarize it")) || undefined);
  const after = await until("the fired run", async () => {
    const result = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
    return result.runs.some((run) => run.status === "fired") ? result : undefined;
  });
  assert.equal(after.triggers[0]?.id, trigger.id);
  assert.ok(after.triggers[0]?.lastFiredAt);
  assert.equal(after.deliveries.lastHour, 1);
});

test("a GitHub trigger: the fake GitHub's new pull request reaches the bot, after a silent baseline and conditional polls", { timeout: 120_000 }, async () => {
  const made = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "PRs", source: "github", filter: { repos: ["acme/widgets"], events: ["pr_opened"], authors: ["bob"] }, cooldownSeconds: 0 });
  assert.equal(made.status, 201);
  const requests = async () => (await readFile(join(ghDir, "requests.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { path: string; status: number; etag: string | null });
  await until("the baseline poll", async () => ((await requests()).some((entry) => entry.path.startsWith("repos/acme/widgets/pulls")) ? true : undefined));
  await until("a conditional poll answered 304", async () => ((await requests()).some((entry) => entry.status === 304 && entry.etag) ? true : undefined));
  assert.equal(await asked("[trigger: PRs"), false, "the baseline wakes nobody");
  const created = new Date(Date.now() + 2_000).toISOString();
  github.repos["acme/widgets"].pulls.push(pull(2, "carol", created), pull(3, "bob", created));
  await writeFile(join(ghDir, "github.json"), JSON.stringify(github));
  await until("the pull request in the bot's chat", async () => (await asked("[trigger: PRs · #3 opened by bob in acme/widgets: Pull request 3]")) || undefined);
  assert.equal(await asked("#2 opened by carol"), false, "the author filter keeps carol's out");
  const listed = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  const prs = listed.triggers.find((each) => each.name === "PRs");
  assert.ok(prs?.watch?.polledAt, "the trigger shows when GitHub was read");
  assert.equal(prs?.watch?.error, undefined);
  assert.equal((await call(`/__hui/bots/${ada.id}/triggers/PRs`, "DELETE")).status, 200);
});

test("the bot's triggers tool: the operator's turn adds one; a turn a trigger started can't", { timeout: 120_000 }, async () => {
  const add = { name: "triggers", input: { action: "add", name: "Kids", source: "session", events: ["finished", "failed"] } };
  const reply = await call(`/__hui/bots/${ada.id}/messages`, "POST", { text: call64(add), wait: true, timeoutSeconds: 60 });
  assert.equal(reply.status, 200);
  assert.match(String(reply.body["reply"]), /tool answered: Added the trigger "Kids" \(Sessions it starts · Finished, Failed\)/u);
  const listed = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  assert.equal(listed.triggers.find((each) => each.name === "Kids")?.createdBy, "bot");
  const chained = { name: "triggers", input: { action: "add", name: "Chain", source: "session", events: ["finished"] } };
  const made = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "Relay", source: "webhook", prompt: call64(chained), cooldownSeconds: 0 });
  const { hook: token } = made.body as unknown as BotTriggerCreated;
  assert.equal((await hook(token!.path, "ping", "text/plain")).status, 202);
  await until("the refusal in the trigger's turn", async () => (await asked("Only the operator adds or changes your triggers, and this turn was started by the trigger")) || undefined);
  const after = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  assert.ok(!after.triggers.some((each) => each.name === "Chain"));
});

test("hui bot trigger lists and tests a bot's triggers through the gateway", { timeout: 60_000 }, async () => {
  let out = "";
  const io = { out: (text: string) => { out += text; }, err: (text: string) => { out += text; }, readStdin: async () => "", lines: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }) }), onInterrupt: () => () => {}, interactive: false, ask: async () => "", cwd: dir, timezone: "UTC" } satisfies BotIO;
  assert.equal(await triggerCommand(`${origin}/`, "list", ["ada"], {}, io), 0);
  assert.match(out, /Deploys \([0-9a-f]{8}\) · Webhook · status equals "failed" · cooldown 5 min · on · last fired /u);
  assert.match(out, /Kids \([0-9a-f]{8}\) · Sessions · Sessions it starts · Finished, Failed/u);
  out = "";
  assert.equal(await triggerCommand(`${origin}/`, "test", ["ada", "Kids"], {}, io), 0);
  assert.match(out, /Sent a test event to @ada: test: "A sample session" finished\./u);
  await until("the test in the bot's chat", async () => (await asked("[trigger: Kids · test: \"A sample session\" finished]")) || undefined);
});

test("bots off: the trigger routes and webhooks answer 409, the call is recorded as skipped, and nothing reaches the bot", { timeout: 60_000 }, async () => {
  const settings = (await call("/__hui/settings")).body;
  const listed = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  const made = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "Off check", source: "webhook", prompt: "E2E_OFF_CHECK" });
  const { hook: token } = made.body as unknown as BotTriggerCreated;
  assert.ok(listed.triggers.length > 0);
  assert.equal((await call("/__hui/settings", "PUT", { ...settings, labs: { ...(settings["labs"] as object), bots: false } })).status, 200);
  assert.deepEqual(await call(`/__hui/bots/${ada.id}/triggers`), { status: 409, body: { error: BOTS_OFF_MESSAGE } });
  assert.deepEqual(await hook(token!.path, "{}"), { status: 409, body: { error: BOTS_OFF_MESSAGE } });
  assert.equal((await call("/__hui/settings", "PUT", { ...settings, labs: { ...(settings["labs"] as object), bots: true } })).status, 200);
  const back = (await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList;
  const skipped = back.runs.find((run) => run.triggerName === "Off check");
  assert.equal(skipped?.status, "skipped");
  assert.match(skipped?.reason ?? "", /bots are off/u);
  assert.equal(await asked("E2E_OFF_CHECK"), false, "nothing reached the bot");
});
