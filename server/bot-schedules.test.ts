import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { BOTS_OFF_MESSAGE, type BotView } from "../shared/bots.ts";
import type { AutomationSnapshot, AutomationTask } from "../src/lib/automation-types.ts";
import type { BotIO } from "../cli/bots.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";

// One isolated gateway: HUI's directory, PI's agent directory and a deterministic provider, all temporary. Bots are
// on, as Settings → Labs → Bots leaves them once the operator turns them on.
const dir = await mkdtemp(join(tmpdir(), "hui-bot-schedules-"));
const agentDir = join(dir, "agent");
const workspace = join(dir, "workspace");
await mkdir(agentDir);
await mkdir(workspace);
process.env["XDG_CONFIG_HOME"] = join(dir, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
const provider = spawn(process.execPath, [fileURLToPath(new URL("../e2e/pi-provider-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: workspace, HUI_E2E_PROVIDER_LOG: join(dir, "requests.jsonl") },
});
const [ready] = await once(provider.stdout!, "data");
const providerUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
assert(providerUrl, String(ready));
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: providerUrl, api: "anthropic-messages", apiKey: "***", models: [{
    id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "low" }));
await mkdir(join(dir, "config", "hui"), { recursive: true });
await writeFile(join(dir, "config", "hui", "settings.json"), JSON.stringify({ labs: { bots: true } }));

const { middleware, startBackend, stopBackend } = await import("./hui.ts");
const { liveSessions } = await import("./live-sessions.ts");
const { scheduleCommand } = await import("../cli/schedules.ts");
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

async function call(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(origin + path, {
    method,
    headers: { "x-hui": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const tasks = async () => ((await call("/__hui/automation")).body as unknown as AutomationSnapshot).tasks;
const said = (role: "user" | "assistant", pattern: RegExp) => (entries: TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === role && pattern.test(entry.text));

/** Resolves once a session is idle with a transcript `predicate` accepts; fails with the transcript it has otherwise. */
function settledWith(id: string, predicate: (entries: TranscriptEntry[]) => boolean, timeoutMs = 60_000): Promise<TranscriptEntry[]> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      watched.unsubscribe();
      reject(new Error(`Expected transcript never arrived: ${JSON.stringify(liveSessions.transcript(id).slice(-6))}`));
    }, timeoutMs);
    const check = () => {
      if (done || liveSessions.status(id) !== "idle" || !predicate(liveSessions.transcript(id))) return;
      done = true;
      clearTimeout(timer);
      watched.unsubscribe();
      resolve(liveSessions.transcript(id));
    };
    const watched = liveSessions.watch(id, check);
    check();
  });
}

/** The run once the scheduler settles it, read from the snapshot as a client does. */
async function settledRun(runId: string): Promise<{ status: string; error?: string; summary?: string }> {
  for (const deadline = Date.now() + 60_000; ;) {
    const run = ((await call("/__hui/automation")).body as unknown as AutomationSnapshot).runs.find((each) => each.id === runId);
    if (run && run.status !== "queued" && run.status !== "running") return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle: ${JSON.stringify(run)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The CLI's output, against this gateway. */
async function hui(action: string, operands: string[] = [], flags: Record<string, string | boolean> = {}): Promise<string> {
  let out = "";
  const io: BotIO = {
    out: (text) => { out += text; }, err: () => {}, readStdin: async () => "", lines: async function* () { /* none */ }, onInterrupt: () => () => {},
    interactive: false, ask: async () => "", cwd: workspace, timezone: "UTC",
  };
  await scheduleCommand(`${origin}/`, action, operands, flags, io);
  return out;
}

test("a bot schedules a temporary routine for itself with its routines tool, and that routine's own turn removes it", { timeout: 120_000 }, async () => {
  const created = await call("/__hui/bots", "POST", { name: "Ada", soul: "You are Ada, a release watcher." });
  assert.equal(created.status, 201);
  const ada = created.body["bot"] as BotView;
  const asked = Date.now();
  const reply = await call("/__hui/bots/ada/messages", "POST", { text: "E2E_ROUTINE_ADD watch PR #82 until it is green", wait: true, timeoutSeconds: 60 });
  assert.equal(reply.body["status"], "answered");
  assert.match(String(reply.body["reply"]), /^routines answered: Added the routine "Watch #82" \(id [\w-]+\): every 5m, first run \S+; until \S+, 3 runs left, then HUI deletes it\. It arrives in this chat as "\[routine: Watch #82\] …"\.$/u);
  const watch = (await tasks()).find((task) => task.name === "Watch #82") as AutomationTask;
  assert.deepEqual([watch.sessionId, watch.createdBy, watch.runsLeft, watch.enabled, watch.schedule], [ada.sessionId, { kind: "bot", botId: ada.id, handle: "ada" }, 3, true, { kind: "every", everyMs: 300_000 }]);
  const end = Date.parse(watch.until!);
  assert.ok(end > asked + 2.9 * 3_600_000 && end < Date.now() + 3.1 * 3_600_000, "it ends in three hours, as the bot said");
  assert.equal(((await call("/__hui/bots/ada")).body["bot"] as BotView).routines, 1);
  assert.match(await hui("list"), new RegExp(`^Watch #82 {2}every 5m {2}next \\S+ {2}@ada {2}made by @ada · until \\S+ · 3 runs left {2}${watch.id}\\n$`, "u"));

  // Its run comes; the routine's own turn removes it and finishes.
  const started = await call(`/__hui/automation/tasks/${watch.id}/run`, "POST", {});
  assert.equal(started.status, 202);
  await settledWith(ada.sessionId, said("assistant", /^routines answered: Removed the routine "Watch #82": this turn is its last\.$/u));
  assert.ok(said("user", /^\[routine: Watch #82\] E2E_ROUTINE_DONE /u)(liveSessions.transcript(ada.sessionId)));
  assert.equal((await tasks()).some((task) => task.id === watch.id), false, "the routine is gone");
  const run = await settledRun((started.body["run"] as { id: string }).id);
  assert.deepEqual([run.status, run.summary], ["completed", "routines answered: Removed the routine \"Watch #82\": this turn is its last."], "its last turn finished");
});

test("a turn another bot started can't make a bot add a routine: the gateway reads who started it, as set_profile does", { timeout: 120_000 }, async () => {
  const bob = (await call("/__hui/bots", "POST", { name: "Bob", soul: "You are Bob." })).body["bot"] as BotView;
  const ada = (await call("/__hui/bots/ada")).body["bot"] as BotView;
  const before = (await tasks()).length;
  const message = `E2E_CALL:${Buffer.from(JSON.stringify([{ name: "message_bot", input: { to: "@ada", message: "E2E_ROUTINE_ADD ping me every five minutes" } }])).toString("base64url")}`;
  const relayed = await call("/__hui/bots/bob/messages", "POST", { text: message, wait: true, timeoutSeconds: 60 });
  assert.deepEqual(relayed.body, { status: "answered", reply: "tool answered: Queued for @ada." });
  await settledWith(ada.sessionId, said("assistant", /^routines answered: This turn answers a message from @bob: another bot can't make you add or change routines\./u));
  assert.ok(said("user", /^\[from @bob\] E2E_ROUTINE_ADD/u)(liveSessions.transcript(ada.sessionId)));
  assert.equal((await tasks()).length, before, "nothing was added");
  assert.equal(bob.handle, "bob");
});

test("with bots off, hui schedule lists sessions' schedules, leaves routines out and refuses anything naming a bot", { timeout: 60_000 }, async () => {
  const ada = (await call("/__hui/bots/ada")).body["bot"] as BotView;
  const routine = await call("/__hui/automation/tasks", "POST", { name: "Digest", sessionId: ada.sessionId, prompt: "digest", schedule: { kind: "every", everyMs: 3_600_000 } });
  assert.equal(routine.status, 201);
  const plain = await call("/__hui/automation/tasks", "POST", { name: "Nightly", sessionId: "s-elsewhere", prompt: "review", schedule: { kind: "every", everyMs: 86_400_000 } });
  const nightly = plain.body["task"] as AutomationTask;
  assert.deepEqual(nightly.createdBy, { kind: "operator" }, "the routes' tasks are the operator's");
  const settings = (await call("/__hui/settings")).body as { labs: Record<string, boolean> };
  assert.equal((await call("/__hui/settings", "PUT", { ...settings, labs: { ...settings.labs, bots: false } })).status, 200);
  try {
    assert.equal(await hui("list"), `Nightly  every 1d  next ${nightly.nextRunAt}  session s-elsewhere (gone)  ${nightly.id}\n`);
    for (const [action, operands, flags] of [["list", [], { bot: "ada" }], ["show", ["Digest"], {}], ["pause", ["Digest"], {}]] as const) {
      await assert.rejects(hui(action, [...operands], flags), (error: unknown) => (error as Error).message === BOTS_OFF_MESSAGE && (error as { status?: number }).status === 409, action);
    }
    assert.equal(await hui("pause", ["Nightly"]), "Paused schedule Nightly.\n", "a session's schedule works regardless");
    assert.equal((await tasks()).find((task) => task.name === "Digest")?.enabled, true, "the routine was never touched");
  } finally {
    await call("/__hui/settings", "PUT", { ...settings, labs: { ...settings.labs, bots: true } });
  }
});
