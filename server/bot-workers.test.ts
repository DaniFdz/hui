/**
 * Bots on a remote worker end to end on one machine (HUI-18). The gateway runs
 * in this process with its routes, as in bot-routes.test.ts; the "remote" is a
 * separate home reached through `env … sh -s`, as in workers.test.ts, with this
 * checkout pre-installed as its release, so nothing is shared with the gateway
 * except what the worker protocol carries. A deterministic Anthropic-compatible
 * provider answers both, and logs what each asked.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { BotMemoryStatus, BotView } from "../shared/bots.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "hui-bot-workers-"));
const agentDir = join(root, "gateway", "agent");
const remoteHome = join(root, "remote");
const remoteData = join(remoteHome, ".local", "share", "hui-worker");
const remoteStore = join(remoteData, "state", "durable");
const KEY = "fixture-bot-worker-key";
// The gateway's home too: nothing is read from the real user's files.
process.env["HOME"] = join(root, "gateway", "home");
process.env["XDG_CONFIG_HOME"] = join(root, "gateway", "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
process.env["PI_OFFLINE"] = "1";
await mkdir(process.env["HOME"], { recursive: true });
await mkdir(join(agentDir, "extensions"), { recursive: true });
await mkdir(join(remoteHome, "project"), { recursive: true });
// Asks which way to go before the message reaches the model: a question in the middle of a bot's turn.
await writeFile(join(agentDir, "extensions", "ask.ts"), `export default function (pi) {
  pi.on("input", async (event, ctx) => {
    if (!event.text.startsWith("E2E_BOT_ASK")) return { action: "continue" };
    const way = await ctx.ui.select("Which way?", ["North", "South"]);
    return { action: "transform", text: "went " + way };
  });
}
`);

const log = join(root, "provider.jsonl");
const provider = spawn(process.execPath, [join(repo, "e2e", "pi-provider-fixture.mjs")], {
  env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: join(remoteHome, "project"), HUI_E2E_PROVIDER_LOG: log, HUI_E2E_PROVIDER_KEY: KEY },
  stdio: ["ignore", "pipe", "inherit"],
});
const [ready] = await once(provider.stdout!, "data");
const baseUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)![0];
const control = (path: string, init?: RequestInit) => fetch(`${baseUrl.replace(/\/v1$/u, "")}/control/${path}`, init);
const model = (id: string) => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 32_000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fx: { baseUrl, api: "anthropic-messages", models: [model("fixture"), model("utility")] } } }));
// The key exists only in the gateway's PI login: the worker's runs and its compactor get it brokered.
await writeFile(join(agentDir, "auth.json"), JSON.stringify({ fx: { type: "api_key", key: KEY } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fx", defaultModel: "fixture" }));

const { middleware, startBackend, stopBackend } = await import("./hui.ts");
const { workers } = await import("./workers.ts");
const { liveSessions } = await import("./live-sessions.ts");
const { readRegistry } = await import("./sessions.ts");
const { workerRelease } = await import("./worker/release.ts");
const { remoteBots } = await import("./bot-remote.ts");
const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));
let origin = "";
let workerId = "";

before(async () => {
  // Pre-install this checkout as the remote release (the container E2E covers the real npm install): no network.
  const release = await workerRelease();
  const dir = join(remoteData, "releases", release.id);
  for (const file of release.files) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.data, { mode: file.mode });
  }
  await symlink(join(repo, "node_modules"), join(dir, "node_modules"));
  await writeFile(join(dir, ".ready"), "");
  await startBackend();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const command = ["env", "-u", "PI_CODING_AGENT_DIR", "-u", "XDG_CONFIG_HOME", "-u", "PI_OFFLINE", `HOME=${remoteHome}`, "SHELL=/bin/sh"];
  const added = await call("/__hui/workers", "POST", { name: "devbox", command: command.map((word) => `'${word}'`).join(" ") });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  workerId = (added.body["worker"] as { id: string }).id;
  await workers.connect(workerId);
});

after(async () => {
  stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const exit = once(provider, "exit");
  provider.kill();
  await exit;
  // The host is durable by design; stop the one this suite started.
  try { execFileSync("pkill", ["-f", remoteHome]); } catch { /* already gone */ }
  await rm(root, { recursive: true, force: true });
});

async function call(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin + path, {
    method,
    headers: { "x-hui": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { text }; }
  return { status: response.status, body: parsed };
}

const botOf = (reply: { body: Record<string, unknown> }) => reply.body["bot"] as BotView;

async function waitFor<T>(read: () => T | undefined | false | Promise<T | undefined | false>, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

type ProviderRequest = { model?: string; system?: unknown; messages?: unknown };
async function providerRequests(): Promise<ProviderRequest[]> {
  return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ProviderRequest);
}
const systemOf = (request: ProviderRequest | undefined) => JSON.stringify(request?.system ?? "");
const isCompactor = (request: ProviderRequest) => systemOf(request).includes("You write the memory of");
/** The chat request whose newest message holds `text` (not the compactor's). */
async function chatRequest(text: string): Promise<ProviderRequest | undefined> {
  return (await providerRequests()).find((request) => !isCompactor(request) && JSON.stringify((request.messages as unknown[] | undefined)?.at(-1) ?? "").includes(text));
}

const says = (role: "user" | "assistant", text: string) => (entries: readonly TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === role && entry.text.includes(text));
/** The chat's transcript once it is idle and `done` holds. */
const settledWith = (id: string, done: (entries: readonly TranscriptEntry[]) => boolean, label: string) =>
  waitFor(() => liveSessions.status(id) === "idle" && done(liveSessions.transcript(id)) ? liveSessions.transcript(id) : undefined, label);

async function memoryOf(handle: string): Promise<{ status: BotMemoryStatus; view: string }> {
  const reply = await call(`/__hui/bots/${handle}/memory`);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return reply.body as { status: BotMemoryStatus; view: string };
}

const EMPTY_MEMORY = { messages: 0, built: 0, pending: 0, viewBytes: 0, viewLines: 0, usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } };

test("a bot made on the worker keeps its conversation and memory there, answers there with the bots section, and summarizes with its utility model", { timeout: 180_000 }, async () => {
  const created = await call("/__hui/bots", "POST", { name: "Rover", title: "Explorer", worker: "devbox", memoryModel: "fx/utility" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const rover = botOf(created);
  assert.deepEqual(rover.worker, { id: workerId, name: "devbox" });
  assert.equal(rover.cwd, join(remoteData, "bots", rover.id), "a private folder under HUI's data directory on the worker");
  assert.ok(existsSync(rover.cwd));
  assert.ok(!existsSync(join(root, "gateway", "config", "hui", "bots", rover.id)), "and none here");
  const record = (await readRegistry()).find((entry) => entry.id === rover.sessionId)!;
  assert.deepEqual([record.worker, record.tool, record.bot], [workerId, "durable", rover.id], "its chat is a Durable session on the worker");
  const conversation = record.piSessionFile!.replace(/^durable:/u, "");
  // The conversation and its OptChat memory are in the worker's store: the gateway's store never held them.
  assert.ok(existsSync(join(remoteStore, "harness.sqlite")));
  assert.deepEqual(await memoryOf("rover"), { status: EMPTY_MEMORY, view: "<chat>\n\n</chat>" }, "OptChat is on from the creating commit");
  assert.ok((await readdir(join(remoteStore, "optchat"))).includes(conversation), "its memory's files are on the worker");
  assert.ok(!existsSync(join(root, "gateway", "config", "hui", "durable", "optchat", conversation)));
  const sessions = (await call("/__hui/sessions")).body["groups"] as Array<{ sessions: Array<{ id: string; displayCwd: string; worker?: unknown }> }>;
  const chat = sessions.flatMap((group) => group.sessions).find((session) => session.id === rover.sessionId);
  assert.deepEqual([chat?.worker, chat?.displayCwd], [{ id: workerId, name: "devbox" }, `devbox:${rover.cwd}`]);

  // Over 512 bytes, so the compactor writes a line for it.
  const answered = await call("/__hui/bots/rover/messages", "POST", { text: `hello from the gateway: OPT_ROVER ${"the north ridge is mapped at dawn ".repeat(20).trim()}`, wait: true, timeoutSeconds: 120 });
  assert.deepEqual([answered.status, answered.body], [200, { status: "answered", reply: "Fixture response." }]);
  // The worker's host asked this gateway for the bots section, so the chat on the worker knows who it is.
  const request = await chatRequest("hello from the gateway");
  assert.match(systemOf(request), /You are @rover \(Rover\), one of the bots of this HUI\./u);
  assert.equal(request?.model, "fixture");
  // OptChat summarizes beside the chat on the worker, with the bot's utility model.
  const status = await waitFor(async () => {
    const memory = await memoryOf("rover");
    return memory.status.messages === 2 && memory.status.pending === 0 ? memory : undefined;
  }, "the worker's memory to log the exchange");
  assert.match(status.view, /FIXTURE_MEMORY OPT_ROVER/u, "the compactor's line for the long message");
  const compactor = (await providerRequests()).filter(isCompactor);
  assert.ok(compactor.length > 0, "the compactor ran");
  assert.deepEqual([...new Set(compactor.map((entry) => entry.model))], ["utility"], "always on the bot's utility model");
  const view = botOf(await call("/__hui/bots/rover"));
  assert.equal(view.memory?.messages, 2, "the list's memory comes from what the worker reports");
  assert.equal(view.lastMessage?.text, "Fixture response.");
});

test("message_bot crosses both ways between a bot here and the bot on the worker", { timeout: 180_000 }, async () => {
  const home = botOf(await call("/__hui/bots", "POST", { name: "Home" }));
  assert.equal(home.worker, undefined);
  const rover = botOf(await call("/__hui/bots/rover"));
  // From the worker: its host calls message_bot on this gateway as the bot's session.
  const out = await call("/__hui/bots/rover/messages", "POST", { text: "E2E_MESSAGE_BOT @home", wait: true, timeoutSeconds: 120 });
  assert.deepEqual(out.body, { status: "answered", reply: "message_bot answered: Queued for @home." });
  await settledWith(home.sessionId, (entries) => says("user", "[from @rover] hello from the fixture")(entries) && says("assistant", "Fixture response.")(entries), "Home to answer Rover");
  // And to the worker: the bot here reaches the chat that runs there.
  const back = await call("/__hui/bots/home/messages", "POST", { text: "E2E_MESSAGE_BOT @rover", wait: true, timeoutSeconds: 120 });
  assert.deepEqual(back.body, { status: "answered", reply: "message_bot answered: Queued for @rover." });
  await settledWith(rover.sessionId, (entries) => says("user", "[from @home] hello from the fixture")(entries), "Rover to get Home's message");
  await waitFor(async () => await chatRequest("[from @home] hello from the fixture"), "Rover's run on the worker");
  assert.match(systemOf(await chatRequest("[from @home] hello from the fixture")), /- @home: Home/u, "its roster on the worker lists the bot here");
});

test("a routine, a queued message, steering, a question and Stop all reach the bot on the worker", { timeout: 240_000 }, async () => {
  const rover = botOf(await call("/__hui/bots/rover"));
  const created = await call("/__hui/automation/tasks", "POST", { name: "Survey", sessionId: rover.sessionId, prompt: "map the ridge", schedule: { kind: "every", everyMs: 3_600_000 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const task = created.body["task"] as { id: string };
  assert.equal(botOf(await call("/__hui/bots/rover")).routines, 1);
  assert.equal((await call(`/__hui/automation/tasks/${task.id}/run`, "POST", {})).status, 202);
  await settledWith(rover.sessionId, (entries) => {
    const index = entries.findIndex((entry) => entry.kind === "message" && entry.role === "user" && entry.text === "[routine: Survey] map the ridge");
    return index >= 0 && entries.slice(index + 1).some((entry) => entry.kind === "message" && entry.role === "assistant");
  }, "the routine's turn on the worker");

  // A held turn: a message queues behind it, and steering joins it.
  assert.deepEqual((await call("/__hui/bots/rover/messages", "POST", { text: "E2E_REPLAY please" })).body, { status: "sent" });
  await control("wait-replay-ready");
  assert.deepEqual((await call("/__hui/bots/rover/messages", "POST", { text: "queued behind the replay" })).body, { status: "queued" });
  assert.equal((await call(`/__hui/sessions/${rover.sessionId}/steer`, "POST", { text: "steer toward the ridge" })).status, 200);
  await control("release-replay", { method: "POST" });
  await settledWith(rover.sessionId, (entries) => says("user", "queued behind the replay")(entries) && says("user", "steer toward the ridge")(entries)
    && entries.findLastIndex((entry) => entry.kind === "message" && entry.role === "assistant") > entries.findIndex((entry) => entry.kind === "message" && entry.text === "queued behind the replay"),
  "the queued message's turn");

  // A question asked in the middle of a turn on the worker comes back to the waiting caller; the answer goes there.
  const asked = await call("/__hui/bots/rover/messages", "POST", { text: "E2E_BOT_ASK which way", wait: true, timeoutSeconds: 120 });
  assert.equal(asked.body["status"], "needs-input", JSON.stringify(asked.body));
  const [question] = asked.body["questions"] as Array<{ id: string; title: string; options?: string[] }>;
  assert.deepEqual([question?.title, question?.options], ["Which way?", ["North", "South"]]);
  assert.equal((await call(`/__hui/sessions/${rover.sessionId}/question`, "POST", { id: question!.id, value: "North" })).status, 200);
  await settledWith(rover.sessionId, says("user", "went North"), "the answered turn");

  // Stop ends a turn that runs on the worker.
  const before = (await providerRequests()).length;
  assert.deepEqual((await call("/__hui/bots/rover/messages", "POST", { text: "E2E_ABORT now" })).body, { status: "sent" });
  await waitFor(async () => (await providerRequests()).slice(before).some((entry) => JSON.stringify(entry.messages).includes("E2E_ABORT now")) || undefined, "the turn to reach the provider");
  assert.equal((await call("/__hui/bots/rover/stop", "POST", {})).status, 200);
  await waitFor(() => liveSessions.status(rover.sessionId) === "idle" || undefined, "the turn to stop");
});

test("a call's record joins the worker bot's chat and memory, which its helper reads", { timeout: 120_000 }, async () => {
  const rover = botOf(await call("/__hui/bots/rover"));
  const reference = (await readRegistry()).find((entry) => entry.id === rover.sessionId)!.piSessionFile!;
  // What BotService.recordCall does for a bot on a worker, through the same ports.
  const ports = remoteBots(workers);
  await ports.conversations(workerId).writeCallRecord(reference, {
    call: "call-1", bot: "Rover", startedAt: Date.parse("2026-10-06T20:00:00Z"), endedAt: Date.parse("2026-10-06T20:02:00Z"),
    summary: "Agreed to map the north ridge.", lines: [{ role: "user", text: "Map the north ridge tomorrow.", at: Date.parse("2026-10-06T20:00:10Z") }],
  });
  const memory = await waitFor(async () => {
    const read = await memoryOf("rover");
    return read.view.includes("Map the north ridge tomorrow.") ? read : undefined;
  }, "the call to reach the memory");
  assert.match(memory.view, /\[call\]/u);
  assert.equal(await ports.memory(workerId).view(reference), memory.view, "the call helper's view is the memory route's");
});

test("archiving, restoring and deleting a bot on the worker", { timeout: 120_000 }, async () => {
  const rover = botOf(await call("/__hui/bots/rover"));
  const archived = await call("/__hui/bots/rover", "DELETE");
  assert.deepEqual([archived.status, botOf(archived).archived], [200, true]);
  assert.equal((await readRegistry()).find((entry) => entry.id === rover.sessionId)?.archived, true);
  assert.equal((await call("/__hui/bots/rover/messages", "POST", { text: "still there?" })).status, 409);
  assert.equal(botOf(await call("/__hui/bots/rover/restore", "POST", {})).archived, undefined);
  assert.deepEqual((await call("/__hui/bots/rover/messages", "POST", { text: "back again", wait: true, timeoutSeconds: 120 })).body, { status: "answered", reply: "Fixture response." });
  assert.equal((await call("/__hui/bots/rover", "DELETE")).status, 200);
  const deleted = await call(`/__hui/bots/${rover.id}?permanent=1`, "DELETE");
  assert.deepEqual([deleted.status, deleted.body], [200, { ok: true }]);
  assert.equal((await readRegistry()).some((entry) => entry.id === rover.sessionId), false, "its chat's record is gone");
  assert.equal(existsSync(rover.cwd), false, "the empty folder the worker made for it went, through the worker");
  assert.ok(existsSync(join(remoteStore, "optchat", (await readdir(join(remoteStore, "optchat")))[0]!)), "its conversation and memory stay in the worker's store");
  assert.equal((await call("/__hui/bots/rover")).status, 404);
});

test("a disconnected worker: creating there, its bot's memory and messages fail naming it, and the list stays fast", { timeout: 180_000 }, async () => {
  const crow = botOf(await call("/__hui/bots", "POST", { name: "Crow", worker: workerId }));
  assert.equal(crow.worker?.name, "devbox");
  assert.equal((await call("/__hui/bots/crow/messages", "POST", { text: "before the disconnect", wait: true, timeoutSeconds: 120 })).body["status"], "answered");
  assert.equal((await call(`/__hui/workers/${workerId}/disconnect`, "POST", {})).status, 200);
  await waitFor(() => liveSessions.status(crow.sessionId) === "disconnected" || undefined, "the chat to show the disconnect");

  const late = await call("/__hui/bots", "POST", { name: "Late", worker: "devbox" });
  assert.deepEqual([late.status, late.body["error"]], [503, "HUI is not connected to devbox. Connect it in Settings → Workers, then create the bot again."]);
  const memory = await call("/__hui/bots/crow/memory");
  assert.equal(memory.status, 503);
  assert.match(String(memory.body["error"]), /^devbox, where this bot runs, is offline: HUI is not connected to it\./u);
  const message = await call("/__hui/bots/crow/messages", "POST", { text: "are you there?" });
  assert.equal(message.status, 503);
  assert.match(String(message.body["error"]), /runs on devbox, which HUI is disconnected from/u);
  const started = Date.now();
  const listed = await call("/__hui/bots");
  assert.equal(listed.status, 200);
  assert.ok(Date.now() - started < 2_000, "the list never waits on the worker");
  const view = (listed.body["bots"] as BotView[]).find((bot) => bot.id === crow.id)!;
  assert.deepEqual([view.status, view.memory, view.lastMessage?.text], ["disconnected", undefined, "Fixture response."], "its state and the newest message HUI saw");
  assert.equal((await call("/__hui/bots", "POST", { name: "Late", worker: "devbox" })).status, 503, "nothing was left behind by the refused create");

  // Connected again, its memory reads as before.
  await workers.connect(workerId);
  assert.equal((await memoryOf("crow")).status.messages >= 2, true);
});
