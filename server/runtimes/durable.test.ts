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
const { DurableHost, durableContext } = await import("./durable-host.ts");
const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
const { durableConversationId, durableReference, startDurable } = await import("./durable.ts");
type DurableHost = import("./durable-host.ts").DurableHost;

const settings = normalizeSettings(undefined);

async function fixture(t: TestContext, options: { contextWindow?: number; settings?: Record<string, unknown> } = {}) {
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
      id, name: id, reasoning: true, input: ["text", "image"], contextWindow: options.contextWindow ?? 32000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "high",
    ...options.settings,
  }));
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

const answers = (entries: TranscriptEntry[]) => entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").length;

/** Sends each prompt once the previous one is answered and settled. */
async function turns(session: DurableSession, prompts: readonly string[]): Promise<void> {
  for (const text of prompts) {
    const before = answers(session.transcript());
    await session.prompt(text);
    await transcriptWhere(session, (entries) => answers(entries) > before && !session.isStreaming);
  }
}

/** A short transcript outline: user prompts by their first word, then roles and markers. */
const outline = (entries: TranscriptEntry[]) => entries.flatMap((entry) =>
  entry.kind === "message" ? [entry.role === "user" ? `user:${entry.text.split(" ")[0]}` : "assistant"]
    : entry.kind === "compaction" ? ["compaction"] : []);

function userEntryId(session: DurableSession, prefix: string): string {
  const entry = session.transcript().find((item) => item.kind === "message" && item.role === "user" && item.text.startsWith(prefix));
  assert(entry?.kind === "message" && entry.entryId, `no stored user message ${prefix}`);
  return entry.entryId;
}

type ProviderRequest = { system?: unknown; messages?: unknown };
async function providerRequests(log: string): Promise<ProviderRequest[]> {
  return (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as ProviderRequest);
}
const summarizing = (request: ProviderRequest) => JSON.stringify(request.system ?? "").includes("context summarization assistant");
/** The messages of the newest model request that was not a summary. */
async function lastTurnRequest(log: string): Promise<string> {
  return JSON.stringify((await providerRequests(log)).filter((request) => !summarizing(request)).at(-1)?.messages);
}

/** Short turns have something to summarize; the window is large enough that Durable never compacts by itself. */
const KEPT_WINDOW = { contextWindow: 200_000, settings: { compaction: { keepRecentTokens: 40 } } };
const LONG_TURN = `COMPACT_THREE ${"kept ".repeat(400)}`;

/** Runs a manual compaction to its settle and returns what it reported. */
async function compacted(session: DurableSession, instructions?: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const unsubscribe = session.subscribe((event) => { if (event.type.startsWith("compaction") || event.type === "settled") events.push(event); });
  const settled = nextEvent(session, (event) => event.type === "settled");
  await session.compact(instructions);
  await settled;
  unsubscribe();
  return events;
}

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
  const user = session.transcript().find((entry) => entry.kind === "message" && entry.role === "user");
  assert(user?.kind === "message" && user.entryId, "history messages carry their Durable entry ID");
  await session.rewind(user.entryId, { excludeUserMessage: true });
  assert.notEqual(session.sessionFile, original, "a fork is a new conversation");
  assert.deepEqual(session.transcript(), []);
  await session.prompt("Second branch");
  await transcriptWhere(session, (entries) => entries.some((entry) => entry.kind === "message" && entry.role === "user" && entry.text === "Second branch") && !session.isStreaming);
  session.dispose();
  const kept = await startDurable({ cwd: f.cwd, sessionFile: original }, host);
  assert(answered("Tool complete")(kept.transcript()), "the abandoned branch is still stored");
});

test("Durable compaction keeps the whole history and marks where it summarized", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-compact" }, host);
  await turns(session, ["COMPACT_ONE first turn", "COMPACT_TWO second turn", LONG_TURN]);
  const before = session.transcript();
  const sizeBefore = session.currentUsage()!.contextTokens!;

  const events = await compacted(session, "keep the API decisions");
  assert.deepEqual(events.map((event) => event.type === "compaction_end" ? `end:${event.reason}:${event.outcome}`
    : event.type === "compaction_start" ? `start:${event.reason}` : event.type), ["start:manual", "end:manual:done", "settled"]);
  const after = session.transcript();
  const withoutMetrics = (entries: TranscriptEntry[]) => entries.map(({ metrics: _metrics, ...entry }) => entry);
  assert.deepEqual(withoutMetrics(after.slice(0, before.length)), withoutMetrics(before), "no earlier message disappears");
  const marker = after.at(-1);
  assert(marker?.kind === "compaction", JSON.stringify(after.at(-1)));
  assert.equal(marker.summary, "FIXTURE_SUMMARY", "the summary without Durable's wrapper");
  // Durable's own estimate, as the context meter showed it just before (the fixture reports tiny usage, so the
  // summary plus the kept 2,000-character turn is not smaller than that here).
  assert.equal(marker.tokensBefore, sizeBefore, "the divider shows the size Durable summarized");
  const summary = (await providerRequests(f.log)).find(summarizing);
  assert.match(JSON.stringify(summary), /Additional focus: keep the API decisions/u);

  const reference = session.sessionFile;
  session.dispose();
  await host.close();
  const reopened = await startDurable({ cwd: f.cwd, sessionFile: reference }, f.host());
  assert.deepEqual(withoutMetrics(reopened.transcript()), withoutMetrics(after), "the marker and history are stored");
  await turns(reopened, ["AFTER_COMPACTION"]);
  const context = await lastTurnRequest(f.log);
  assert.match(context, /FIXTURE_SUMMARY/u);
  assert.match(context, /COMPACT_THREE/u, "the kept window stays verbatim");
  assert.doesNotMatch(context, /COMPACT_ONE|COMPACT_TWO/u, "summarized turns leave the model context");
});

test("the context meter is Durable's own estimate, system prompt included", { timeout: 60_000 }, async (t) => {
  // A failed answer is no measurement, so right after it Durable estimates the whole context: the summary, the kept
  // turn, the system baseline it rewrote after the summary and the new prompt.
  const f = await fixture(t, { ...KEPT_WINDOW, settings: { ...KEPT_WINDOW.settings, retry: { enabled: false } } });
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-meter" }, host);
  await turns(session, ["COMPACT_ONE first turn", "COMPACT_TWO second turn", LONG_TURN]);
  await compacted(session);
  const settled = nextEvent(session, (event) => event.type === "settled");
  await session.prompt("E2E_ERROR after the summary");
  await settled;
  const conversation = await (await host.open()).conversation(durableConversationId(session.sessionFile)!, durableContext);
  const view = await conversation!.context(durableContext);
  assert(view.messages.some((message) => message.role === "system"), "Durable re-baselined its system prompt");
  const expected = view.messages.reduce((total, message) => total + estimateTokens(message), 0);
  assert.equal(session.currentUsage()?.contextTokens, expected);
});

test("a requested compaction with nothing old enough to summarize says so", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-small" }, f.host());
  await turns(session, ["Only turn"]);
  const events = await compacted(session);
  const end = events.find((event) => event.type === "compaction_end");
  assert(end?.type === "compaction_end");
  assert.deepEqual({ outcome: end.outcome, message: end.message }, { outcome: "failed", message: "Nothing to compact (session too small)" });
  assert.equal(session.transcript().some((entry) => entry.kind === "compaction"), false);
});

test("Stop cancels a running compaction and returns once it ended; a new view sees it running", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-cancel" }, host);
  await turns(session, ["E2E_SLOW_COMPACT first turn", LONG_TURN]);
  const ended = nextEvent(session, (event) => event.type === "compaction_end");
  await session.compact();
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200, "the summary request is held");

  // A browser reopening the session meanwhile is told a compaction is running.
  const second = await startDurable({ cwd: f.cwd, sessionFile: session.sessionFile }, host);
  const replayed: RuntimeEvent[] = [];
  second.subscribe((event) => replayed.push(event));
  assert.deepEqual(replayed, [{ type: "compaction_start", reason: "manual" }]);
  second.dispose();

  await session.abort();
  const end = await ended;
  assert(end.type === "compaction_end" && end.outcome === "cancelled", JSON.stringify(end));
  assert.equal(session.isStreaming, false, "Stop resolves once the compaction has ended");
  assert.equal(session.transcript().some((entry) => entry.kind === "compaction"), false, "no summary is written");
});

test("rewinding inside a summary's kept window keeps it; behind it the model rereads the turns", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-rewind-compaction" }, f.host());
  await turns(session, ["COMPACT_ONE first turn", "COMPACT_TWO second turn", LONG_TURN]);
  await compacted(session);

  // The kept window starts at COMPACT_THREE: stopping before it still follows everything the summary covers.
  await session.rewind(userEntryId(session, "COMPACT_THREE"), { excludeUserMessage: true });
  assert.deepEqual(outline(session.transcript()), ["user:COMPACT_ONE", "assistant", "user:COMPACT_TWO", "assistant", "compaction"]);
  await turns(session, ["AFTER_KEPT"]);
  let context = await lastTurnRequest(f.log);
  assert.match(context, /FIXTURE_SUMMARY/u);
  assert.doesNotMatch(context, /COMPACT_ONE|COMPACT_TWO|COMPACT_THREE/u, "only the summary and the new prompt");

  // COMPACT_TWO was summarized: the fork leaves the summary out and the model rereads the original turn.
  await session.rewind(userEntryId(session, "COMPACT_TWO"), { excludeUserMessage: true });
  assert.deepEqual(outline(session.transcript()), ["user:COMPACT_ONE", "assistant"]);
  await turns(session, ["AFTER_CUT"]);
  context = await lastTurnRequest(f.log);
  assert.match(context, /COMPACT_ONE/u);
  assert.doesNotMatch(context, /FIXTURE_SUMMARY/u);

  // A prompt the browser shows without an entry ID is counted from the end.
  await session.rewind({ userFromEnd: 0 }, { excludeUserMessage: true });
  assert.deepEqual(outline(session.transcript()), ["user:COMPACT_ONE", "assistant"]);
});

test("Durable compacts by itself ahead of the threshold, in the background", { timeout: 60_000 }, async (t) => {
  // A 32k window puts Durable's background threshold (32,768 below `contextWindow - reserveTokens`) under zero.
  const f = await fixture(t, { contextWindow: 32_000, settings: { compaction: { keepRecentTokens: 40 } } });
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-auto" }, f.host());
  const starts: string[] = [];
  session.subscribe((event) => { if (event.type === "compaction_start") starts.push(event.reason); });
  await turns(session, ["AUTO_ONE first turn", `AUTO_TWO ${"kept ".repeat(400)}`]);
  const entries = await transcriptWhere(session, (items) => items.some((entry) => entry.kind === "compaction") && !session.isStreaming);
  assert.deepEqual([...new Set(starts)], ["threshold"]);
  assert.deepEqual(outline(entries).filter((item) => item.startsWith("user:")), ["user:AUTO_ONE", "user:AUTO_TWO"], "history stays whole");
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

test("opening the store leaves the gateway's global fetch untouched", { timeout: 30_000 }, async (t) => {
  // The harness shares the gateway process; GitHub, Jira and update checks
  // must keep the fetch they had (tests and fixtures also override it).
  const f = await fixture(t);
  const before = globalThis.fetch;
  const session = await startDurable({ cwd: f.cwd }, f.host());
  assert.equal(globalThis.fetch, before);
  session.dispose();
});

test("one store has one owner", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.host().open();
  await assert.rejects(() => f.host().open(), /already open in this process/u);
});
