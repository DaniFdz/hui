import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test, type TestContext } from "node:test";
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
const { liveSessions } = await import("./live-sessions.ts");
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
  // The backend first: its triggers' last writes settle before their directory goes.
  await stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const exit = once(provider, "exit");
  provider.kill();
  await exit;
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
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

/** The lines another process has finished appending to a log: one it is still writing waits for the next read. */
const completeLines = (text: string): string[] => text.split("\n").slice(0, -1).filter(Boolean);

/** Whether a provider request's newest message contains `text` (compared as the JSON the request carries it in). */
async function asked(text: string): Promise<boolean> {
  const lines = completeLines(await readFile(log, "utf8").catch(() => ""));
  const needle = JSON.stringify(text).slice(1, -1);
  return lines.some((line) => {
    const request = JSON.parse(line) as { messages?: unknown[] };
    return JSON.stringify(request.messages?.at(-1) ?? "").includes(needle);
  });
}

const call64 = (calls: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;
let ada: BotView;

/** The provider's controls: `E2E_REPLAY` holds an answer until it is released. */
const control = (path: string, init?: RequestInit) => fetch(`${providerUrl}/control/${path}`, init);

/** Every gated tool at once, as `who` would have the bot call them, with the triggers tool's list. */
const gated = (who: string) => [
  { name: "set_profile", input: { title: `Retitled by ${who}` } },
  { name: "triggers", input: { action: "add", name: `Added by ${who}`, source: "session", events: ["finished"] } },
  { name: "triggers", input: { action: "update", trigger: "Keep", events: ["waiting"] } },
  { name: "write_soul", input: { soul: `# Ada\nRewritten by ${who}.` } },
  { name: "triggers", input: { action: "list" } },
  { name: "routines", input: { action: "add", name: `Added by ${who}`, prompt: "Look again.", every: "1h" } },
  { name: "routines", input: { action: "update", routine: "Standing", every: "2h" } },
];

/** An operator's routine of Ada's, for the routines tool to try to change; it and the routines named here go once the
 * test ends. */
async function standingRoutine(t: TestContext, ...names: string[]): Promise<void> {
  const made = await call("/__hui/automation/tasks", "POST", { name: "Standing", sessionId: ada.sessionId, prompt: "E2E_STANDING look", schedule: { kind: "every", everyMs: 3_600_000 } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  t.after(async () => {
    const { tasks } = (await call("/__hui/automation")).body as { tasks: Array<{ id: string; name: string; sessionId: string }> };
    for (const task of tasks.filter((each) => each.sessionId === ada.sessionId && ["Standing", ...names].includes(each.name))) {
      await call(`/__hui/automation/tasks/${task.id}`, "DELETE");
    }
  });
}
const routineNamed = async (name: string) => ((await call("/__hui/automation")).body as { tasks: Array<{ name: string; sessionId: string; schedule: unknown }> }).tasks.find((task) => task.sessionId === ada.sessionId && task.name === name);

/** What the tools told Ada in the turn of the latest message starting with `start`, once her chat is idle. */
async function answerTo(start: string): Promise<string> {
  return until(`the answer to "${start}"`, async () => {
    if (liveSessions.status(ada.sessionId) !== "idle") return undefined;
    const entries = liveSessions.transcript(ada.sessionId);
    const index = entries.findLastIndex((entry) => entry.kind === "message" && entry.role === "user" && entry.text.startsWith(start));
    const reply = index < 0 ? undefined : entries.slice(index + 1).find((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.startsWith("tool answered: "));
    return reply?.kind === "message" ? reply.text : undefined;
  }, 60_000);
}

/** Holds an operator's turn of Ada's at the provider. */
async function holdOperatorTurn(): Promise<void> {
  assert.deepEqual((await call(`/__hui/bots/${ada.id}/messages`, "POST", { text: "E2E_REPLAY the operator's own turn" })).body, { status: "sent" });
  await control("wait-replay-ready");
}

/** Here a message to a busy bot waits in HUI's queue; the operator steers the one starting with `start` into the turn. */
async function steerQueued(start: string): Promise<void> {
  const item = await until(`"${start}" in HUI's queue`, async () => liveSessions.snapshot(ada.sessionId).queue.items?.find((each) => each.text.startsWith(start)));
  assert.equal((await call(`/__hui/sessions/${ada.sessionId}/queue`, "POST", { operation: "steer", itemId: item.id })).status, 200);
}

const soulOf = async () => (await call(`/__hui/bots/${ada.id}/soul`)).body["soul"];
const profileOf = async () => {
  const bot = (await call(`/__hui/bots/${ada.id}`)).body["bot"] as BotView;
  return { name: bot.name, handle: bot.handle, title: bot.title };
};
const triggerNamed = async (name: string) => ((await call(`/__hui/bots/${ada.id}/triggers`)).body as unknown as BotTriggersList).triggers.find((each) => each.name === name);
/** Once the test ends, however it went: Ada's triggers named here go, and her title and SOUL.md are as they were. */
function restoreAfter(t: TestContext, ...triggers: string[]): void {
  const before = Promise.all([profileOf(), soulOf()]);
  t.after(async () => {
    for (const name of triggers) await call(`/__hui/bots/${ada.id}/triggers/${encodeURIComponent(name)}`, "DELETE");
    const [profile, soul] = await before;
    await call(`/__hui/bots/${ada.id}`, "PATCH", { title: profile.title ?? "" });
    await call(`/__hui/bots/${ada.id}/soul`, "PUT", { soul });
  });
}

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
  const requests = async () => completeLines(await readFile(join(ghDir, "requests.jsonl"), "utf8").catch(() => "")).map((line) => JSON.parse(line) as { path: string; status: number; etag: string | null });
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

test("a gated tool judges the run by every input it took: a trigger's message steered into the operator's running turn makes set_profile, the triggers tool's add and update, and write_soul refuse; list and remove still work", { timeout: 120_000 }, async (t) => {
  restoreAfter(t, "Keep", "Drop", "Joiner", "Added by a trigger");
  await standingRoutine(t, "Added by a trigger");
  for (const [name, events] of [["Keep", ["finished"]], ["Drop", ["failed"]]] as const) {
    assert.equal((await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name, source: "session", filter: { events } })).status, 201);
  }
  const prompt = call64([...gated("a trigger"), { name: "triggers", input: { action: "remove", trigger: "Drop" } }]);
  const made = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "Joiner", source: "webhook", prompt, cooldownSeconds: 0 });
  const { hook: token } = made.body as unknown as BotTriggerCreated;
  const before = { profile: await profileOf(), soul: await soulOf() };

  await holdOperatorTurn();
  assert.deepEqual(await hook(token!.path, "{}"), { status: 202, body: { status: "fired" } });
  await steerQueued("[trigger: Joiner · ");
  await control("release-replay", { method: "POST" });
  const answer = await answerTo("[trigger: Joiner · ");
  assert.match(answer, /Only the operator changes your name or title, and this turn was started by a routine, a trigger or another bot\./u, "set_profile");
  assert.equal(answer.split("Only the operator adds or changes your triggers, and this turn was started by the trigger \"Joiner\", whose event comes from outside HUI.").length, 3, "the triggers tool's add and update");
  assert.match(answer, /Only the operator changes your soul, and this turn was started by a routine, a trigger or another bot\./u, "write_soul");
  assert.match(answer, /You have \d+ triggers:/u, "list still works");
  assert.match(answer, /Removed the trigger "Drop"\./u, "and remove");
  assert.equal(answer.split("This turn was started by the trigger \"Joiner\", whose event comes from outside HUI: it can't make you add or change routines.").length, 3, "the routines tool's add and update");
  assert.equal(await routineNamed("Added by a trigger"), undefined);
  assert.deepEqual((await routineNamed("Standing"))?.schedule, { kind: "every", everyMs: 3_600_000 });
  assert.deepEqual(await profileOf(), before.profile, "Ada's name and title are as they were");
  assert.equal(await soulOf(), before.soul, "and her SOUL.md");
  assert.equal(await triggerNamed("Added by a trigger"), undefined);
  assert.deepEqual((await triggerNamed("Keep"))?.filter, { events: ["finished"] });
  assert.equal(await triggerNamed("Drop"), undefined);
});

test("the same for another bot's message steered into the operator's turn, and a routine's, which may add and change triggers but neither retitle Ada nor rewrite her soul", { timeout: 120_000 }, async (t) => {
  restoreAfter(t, "Keep", "Added by @bob", "Added by a routine");
  await standingRoutine(t, "Added by @bob", "Added by a routine");
  assert.equal((await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "Keep", source: "session", filter: { events: ["finished"] } })).status, 201);
  const bob = (await call("/__hui/bots", "POST", { name: "Bob", soul: "# Bob\nAnother fixture bot." })).body["bot"] as BotView;
  t.after(async () => { await call(`/__hui/bots/${bob.id}?permanent=1`, "DELETE"); });
  const before = { profile: await profileOf(), soul: await soulOf() };
  await holdOperatorTurn();
  const relay = { name: "message_bot", input: { to: "@ada", message: call64(gated("@bob")) } };
  assert.equal((await call(`/__hui/bots/${bob.id}/messages`, "POST", { text: call64(relay), wait: true, timeoutSeconds: 60 })).body["status"], "answered");
  await steerQueued("[from @bob] ");
  await control("release-replay", { method: "POST" });
  const relayed = await answerTo("[from @bob] ");
  assert.match(relayed, /Only the operator changes your name or title/u);
  assert.equal(relayed.split("Only the operator adds or changes your triggers, and this turn was started by @bob.").length, 3);
  assert.match(relayed, /Only the operator changes your soul/u);
  assert.match(relayed, /You have \d+ triggers?:/u);
  assert.equal(relayed.split("This turn answers a message from @bob: another bot can't make you add or change routines.").length, 3);
  assert.equal(await triggerNamed("Added by @bob"), undefined);
  assert.equal(await routineNamed("Added by @bob"), undefined);

  const task = (await call("/__hui/automation/tasks", "POST", { name: "Tidy", sessionId: ada.sessionId, prompt: call64(gated("a routine")), schedule: { kind: "every", everyMs: 3_600_000 } })).body["task"] as { id: string };
  t.after(async () => {
    await until("the routine's run to end", async () => ((await call("/__hui/automation")).body as { runs: Array<{ taskId: string; finishedAt?: string }> }).runs.every((run) => run.taskId !== task.id || run.finishedAt) || undefined);
    await call(`/__hui/automation/tasks/${task.id}`, "DELETE");
  });
  await holdOperatorTurn();
  assert.equal((await call(`/__hui/automation/tasks/${task.id}/run`, "POST", {})).status, 202);
  await steerQueued("[routine: Tidy] ");
  await control("release-replay", { method: "POST" });
  const routine = await answerTo("[routine: Tidy] ");
  assert.match(routine, /Only the operator changes your name or title/u, "a routine's message can't retitle her");
  assert.match(routine, /Added the trigger "Added by a routine"/u, "the triggers tool takes a routine's turn");
  assert.match(routine, /Updated the trigger "Keep": Sessions · Sessions it starts · Waiting/u);
  assert.match(routine, /Only the operator changes your soul/u, "nor rewrite her soul");
  assert.match(routine, /Added the routine "Added by a routine"/u, "the routines tool takes a routine's turn too");
  assert.match(routine, /Updated the routine "Standing"/u);
  assert.deepEqual(await profileOf(), before.profile);
  assert.equal(await soulOf(), before.soul);
});

test("a run stays tainted to its end: the operator's message after a trigger's in the same run is refused too; an operator-only run is allowed, and so is the operator's next run", { timeout: 120_000 }, async (t) => {
  restoreAfter(t, "Ping", "Tainted", "Clean");
  await standingRoutine(t, "Tainted", "Clean");
  const made = await call(`/__hui/bots/${ada.id}/triggers`, "POST", { name: "Ping", source: "webhook", prompt: "E2E_PING look around", cooldownSeconds: 0 });
  const { hook: token } = made.body as unknown as BotTriggerCreated;
  const mine = (title: string) => call64([
    { name: "set_profile", input: { title } },
    { name: "write_soul", input: { soul: `# Ada\n${title}.` } },
    { name: "triggers", input: { action: "add", name: title, source: "session", events: ["finished"] } },
    { name: "routines", input: { action: "add", name: title, prompt: "Look again.", every: "1h" } },
  ]);
  const before = { profile: await profileOf(), soul: await soulOf() };

  // The operator, then a trigger, then the operator again, all in one run.
  await holdOperatorTurn();
  assert.deepEqual(await hook(token!.path, "{}"), { status: 202, body: { status: "fired" } });
  await steerQueued("[trigger: Ping · ");
  assert.equal((await call(`/__hui/sessions/${ada.sessionId}/steer`, "POST", { text: mine("Tainted") })).status, 200);
  await control("release-replay", { method: "POST" });
  const tainted = await answerTo(mine("Tainted"));
  assert.match(tainted, /Only the operator changes your name or title/u);
  assert.match(tainted, /Only the operator changes your soul/u);
  assert.match(tainted, /Only the operator adds or changes your triggers, and this turn was started by the trigger "Ping"/u);
  assert.deepEqual(await profileOf(), before.profile);
  assert.equal(await soulOf(), before.soul);
  assert.equal(await triggerNamed("Tainted"), undefined);
  assert.match(tainted, /This turn was started by the trigger "Ping", whose event comes from outside HUI: it can't make you add or change routines\./u);
  assert.equal(await routineNamed("Tainted"), undefined);

  // That run ended: the operator's next one, with a message of theirs joining it, may.
  await holdOperatorTurn();
  assert.equal((await call(`/__hui/sessions/${ada.sessionId}/steer`, "POST", { text: mine("Clean") })).status, 200);
  await control("release-replay", { method: "POST" });
  const clean = await answerTo(mine("Clean"));
  assert.match(clean, /Saved: you are Ada \(@ada\), Clean\./u, clean);
  assert.match(clean, /Saved your SOUL\.md/u);
  assert.match(clean, /Added the trigger "Clean"/u);
  assert.match(clean, /Added the routine "Clean"/u);
  assert.equal(await soulOf(), "# Ada\nClean.");
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
