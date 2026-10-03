import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test, type TestContext } from "node:test";
import { normalizeSettings } from "../../src/lib/settings.ts";
import type { DurableSession } from "./durable.ts";
import type { AgentToolInvocation } from "../agent-tools-bridge.ts";
import type { RuntimeEvent, TranscriptEntry } from "./types.ts";

// HUI's configuration directory (provider selections, credentials, the default
// Durable store) is resolved at import time; never read the operator's own.
const configDir = await mkdtemp(join(tmpdir(), "hui-durable-config-"));
process.env["XDG_CONFIG_HOME"] = configDir;
after(() => rm(configDir, { recursive: true, force: true }));
const { DurableHost } = await import("./durable-host.ts");
const { durableConversationId, durableReference, startDurable } = await import("./durable.ts");
type DurableHost = import("./durable-host.ts").DurableHost;

const settings = normalizeSettings(undefined);

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "hui-durable-test-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "workspace");
  const store = join(dir, "store");
  await mkdir(agentDir); await mkdir(cwd);
  await writeFile(join(cwd, "fixture.txt"), "Durable fixture content\n");
  const log = join(dir, "requests.jsonl");
  const provider = spawn(process.execPath, [fileURLToPath(new URL("../../e2e/pi-provider-fixture.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: cwd, HUI_E2E_PROVIDER_LOG: log },
  });
  const hosts: DurableHost[] = [];
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    for (const host of hosts) await host.close().catch(() => {});
    for (const child of children) child.kill("SIGKILL");
    const exit = once(provider, "exit"); provider.kill(); await exit;
    await rm(dir, { recursive: true, force: true });
  });
  const [ready] = await once(provider.stdout!, "data");
  const baseUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
  assert(baseUrl, String(ready));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
    baseUrl, api: "anthropic-messages", apiKey: "fixture-key", models: ["fixture", "group/second"].map((id) => ({
      id, name: id, reasoning: true, input: ["text", "image"], contextWindow: 32000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "high" }));
  const invocations: AgentToolInvocation[] = [];
  const host = (options: { invokeTool?: (invocation: AgentToolInvocation) => Promise<unknown> } = {}) => {
    const created = new DurableHost({
      dir: store, agentDir,
      readSettings: async () => settings,
      invokeTool: options.invokeTool ?? (async (invocation) => { invocations.push(invocation); return { ok: true }; }),
      lookupCaller: async () => undefined,
    });
    hosts.push(created);
    return created;
  };
  const control = (path: string, method = "GET") => fetch(`${baseUrl}${path}`, { method });
  return { dir, cwd, agentDir, store, log, host, invocations, control, children };
}

/** Resolves once the transcript satisfies `predicate`, checking now and after every event. */
function transcriptWhere(session: DurableSession, predicate: (entries: TranscriptEntry[]) => boolean, timeoutMs = 20_000): Promise<TranscriptEntry[]> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const entries = session.transcript();
      if (!predicate(entries)) return false;
      clearTimeout(timer); unsubscribe(); resolve(entries); return true;
    };
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Expected transcript never arrived: ${JSON.stringify(session.transcript())}`)); }, timeoutMs);
    const unsubscribe = session.subscribe(() => { check(); });
    check();
  });
}

function nextEvent(session: DurableSession, predicate: (event: RuntimeEvent) => boolean, timeoutMs = 20_000): Promise<RuntimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("Expected runtime event timed out.")); }, timeoutMs);
    const unsubscribe = session.subscribe((event) => {
      if (predicate(event)) { clearTimeout(timer); unsubscribe(); resolve(event); }
    });
  });
}

const answered = (text: string) => (entries: TranscriptEntry[]) =>
  entries.some((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.includes(text));

test("resume references round-trip Durable's integer conversation IDs only", () => {
  const id = 42 as never;
  assert.equal(durableReference(id), "durable:42");
  assert.equal(durableConversationId("durable:42"), 42);
  for (const reference of [undefined, "/home/me/.pi/session.jsonl", "durable:", "durable:4x", "durable:-1"]) {
    assert.equal(durableConversationId(reference), undefined, String(reference));
  }
});

test("Durable runs a real tool turn and reopens the conversation from its store", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-rich" }, host);
  assert.match(session.sessionFile, /^durable:\d+$/u);
  assert.equal(session.currentModel()?.id, "fixture");
  assert.equal(session.currentThinking(), "high");
  const settled = nextEvent(session, (event) => event.type === "settled");
  const tools: string[] = [];
  session.subscribe((event) => { if (event.type === "tool_end") tools.push(`${event.name}:${event.failed ? "failed" : "ok"}`); });
  await session.prompt("E2E_RICH read the fixture");
  assert.equal(session.isStreaming, true);
  await settled;
  assert.equal(session.isStreaming, false);
  assert.deepEqual(tools, ["read:ok"]);
  const live = await transcriptWhere(session, answered("Tool complete"));
  const shape = live.map((entry) => entry.kind === "message" ? entry.role : entry.kind).filter((kind) => kind !== "thinking");
  assert.deepEqual(shape, ["user", "tool", "assistant"]);
  const read = live.find((entry) => entry.kind === "tool");
  assert(read?.kind === "tool" && read.name === "read" && read.failed === false, JSON.stringify(read));
  const requests = (await readFile(f.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { system?: unknown });
  const system = JSON.stringify(requests[0]!.system);
  assert.match(system, /You are the coding assistant in HUI/u, "HUI's default preamble");
  assert.match(system, /hui_tools/u, "HUI's active-tool section");
  assert.match(system, new RegExp(f.cwd.replaceAll("/", "\\/"), "u"), "the working directory");

  const reference = session.sessionFile;
  session.dispose();
  await host.close();
  const reopened = await startDurable({ cwd: f.cwd, sessionFile: reference }, f.host());
  assert.equal(reopened.sessionFile, reference);
  const withoutMetrics = (entries: TranscriptEntry[]) => entries.map(({ metrics: _metrics, ...entry }) => entry);
  assert.deepEqual(withoutMetrics(reopened.transcript()), withoutMetrics(live), "the reopened transcript is the stored one");
});

test("a gateway killed mid-tool resumes the run without replaying bash", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const hostUrl = new URL("./durable-host.ts", import.meta.url).href;
  const durableUrl = new URL("./durable.ts", import.meta.url).href;
  const settingsUrl = new URL("../../src/lib/settings.ts", import.meta.url).href;
  // A separate process owns the store and is SIGKILLed while bash is running.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DurableHost } = await import(${JSON.stringify(hostUrl)});
    const { startDurable } = await import(${JSON.stringify(durableUrl)});
    const { normalizeSettings } = await import(${JSON.stringify(settingsUrl)});
    const host = new DurableHost({ dir: ${JSON.stringify(f.store)}, agentDir: ${JSON.stringify(f.agentDir)},
      readSettings: async () => normalizeSettings(undefined), invokeTool: async () => ({}), lookupCaller: async () => undefined });
    const session = await startDurable({ cwd: ${JSON.stringify(f.cwd)}, huiSessionId: "crash" }, host);
    process.stdout.write("REF " + session.sessionFile + "\\n");
    await session.prompt("E2E_COMMAND_RUNNING hold the command");
  `], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  f.children.push(child);
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const [line] = await once(child.stdout!, "data");
  const reference = /REF (durable:\d+)/u.exec(String(line))?.[1];
  assert(reference, `${String(line)}${stderr}`);
  const waiting = await f.control("/control/wait-replay-ready");
  assert.equal(waiting.status, 200, "bash is running the held command");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;

  // A new gateway opens the same store; the harness resumes the run by itself.
  const session = await startDurable({ cwd: f.cwd, sessionFile: reference }, f.host());
  const entries = await transcriptWhere(session, answered("Tool complete"));
  const tool = entries.find((entry) => entry.kind === "tool");
  assert(tool && tool.kind === "tool" && tool.name === "bash", JSON.stringify(entries));
  assert.equal(tool.failed, true);
  assert.match(tool.output ?? "", /interrupted/u, "the model is told the call was interrupted");
  assert.equal(entries.filter((entry) => entry.kind === "message" && entry.role === "user").length, 1, "no synthetic recovery prompt");
  const replays = (await readFile(f.log, "utf8")).split("wait-command").length - 1;
  assert.equal(replays, 1, "bash was not re-run after the restart");
});

test("steering and follow-ups queue in the Durable inbox while a tool runs", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-queue" }, f.host());
  await session.prompt("E2E_COMMAND_RUNNING hold the command");
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200);
  const queued = nextEvent(session, (event) => event.type === "queue_update" && event.queue.followUp.length === 1);
  await session.steer("Steer note for the running turn");
  await session.followUp("Follow-up note for later");
  await queued;
  assert.deepEqual(session.pendingQueue(), { steering: ["Steer note for the running turn"], followUp: ["Follow-up note for later"] });
  await f.control("/control/release-replay", "POST");
  const entries = await transcriptWhere(session, (items) =>
    items.filter((entry) => entry.kind === "message" && entry.role === "user").length === 3 && !session.isStreaming
    && items.at(-1)?.kind === "message" && (items.at(-1) as { role: string }).role === "assistant");
  const users = entries.flatMap((entry) => entry.kind === "message" && entry.role === "user" ? [entry.text] : []);
  assert.deepEqual(users, ["E2E_COMMAND_RUNNING hold the command", "Steer note for the running turn", "Follow-up note for later"]);
  assert.deepEqual(session.pendingQueue(), { steering: [], followUp: [] });
});

test("HUI tools reach the gateway handler as the bound session, never a model-chosen one", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-tools" }, f.host());
  await session.prompt("E2E_SUGGEST_TASK");
  await transcriptWhere(session, answered("I flagged two follow-ups"));
  assert.deepEqual(f.invocations.map((invocation) => [invocation.callerSessionId, invocation.action]), [
    ["durable-tools", "suggest_task"], ["durable-tools", "suggest_task"],
  ]);
  assert.equal(f.invocations[0]!.params["title"], "Replace native terminal switcher select with HUI picker");
});

test("rewinding forks the conversation and keeps the abandoned branch", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-rewind" }, host);
  await session.prompt("E2E_RICH read the fixture");
  await transcriptWhere(session, (entries) => answered("Tool complete")(entries) && !session.isStreaming);
  const original = session.sessionFile;
  const user = (await session.checkpoints()).find((point) => point.kind === "user");
  assert(user);
  await session.rewind(user.id, { excludeUserMessage: true });
  assert.notEqual(session.sessionFile, original, "a fork is a new conversation");
  assert.deepEqual(session.transcript(), []);
  await session.prompt("Second branch");
  await transcriptWhere(session, (entries) => entries.some((entry) => entry.kind === "message" && entry.role === "user" && entry.text === "Second branch") && !session.isStreaming);
  session.dispose();
  const kept = await startDurable({ cwd: f.cwd, sessionFile: original }, host);
  assert(answered("Tool complete")(kept.transcript()), "the abandoned branch is still stored");
});

test("model and thinking changes persist on the conversation", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, model: "hui-e2e/fixture", thinking: "low" }, host);
  assert.deepEqual((await session.listModels()).map((model) => model.id).sort(), ["fixture", "group/second"]);
  await session.setModel("hui-e2e", "group/second");
  await session.setThinking("medium");
  const reference = session.sessionFile;
  session.dispose();
  await host.close();
  const reopened = await startDurable({ cwd: f.cwd, sessionFile: reference }, f.host());
  assert.equal(reopened.currentModel()?.id, "group/second");
  assert.equal(reopened.currentThinking(), "medium");
});

test("one store has one owner", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.host().open();
  await assert.rejects(() => f.host().open(), /already open in this process/u);
});
