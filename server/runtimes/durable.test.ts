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
// The estimate Durable's compaction thresholds use; the package root does not export it.
const { estimateContext } = await import(new URL("./harness/compaction.js", import.meta.resolve("@earendil-works/pi-durable")).href) as {
  estimateContext(view: unknown, extra: readonly unknown[]): number;
};
const { durableConversationId, durableReference, startDurable } = await import("./durable.ts");
const { importPiSession } = await import("./pi-import.ts");
const { aggregateUsage } = await import("../observability.ts");
type DurableHost = import("./durable-host.ts").DurableHost;

const settings = normalizeSettings(undefined);

async function fixture(t: TestContext, options: { contextWindow?: number; settings?: Record<string, unknown>; extensions?: Record<string, string> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hui-durable-test-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "workspace");
  const store = join(dir, "store");
  await mkdir(agentDir); await mkdir(cwd);
  if (options.extensions) {
    await mkdir(join(agentDir, "extensions"));
    for (const [name, source] of Object.entries(options.extensions)) await writeFile(join(agentDir, "extensions", name), source);
  }
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
    // Requires the provider identity HUI gives every PI request (docs/api.md).
    baseUrl, api: "anthropic-messages", headers: { "x-client-session-id": "${PI_CLIENT_SESSION_ID}" }, apiKey: "fixture-key", models: ["fixture", "group/second"].map((id) => ({
      id, name: id, reasoning: true, input: ["text", "image"], contextWindow: options.contextWindow ?? 32000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "hui-e2e", defaultModel: "fixture", defaultThinkingLevel: "high",
    ...options.settings,
  }));
  const invocations: AgentToolInvocation[] = [];
  const host = (options: { invokeTool?: (invocation: AgentToolInvocation) => Promise<unknown>; huiSettings?: typeof settings } = {}) => {
    const created = new DurableHost({
      dir: store, agentDir,
      readSettings: async () => options.huiSettings ?? settings,
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

/** Runs a manual compaction to its end and returns what it reported. */
async function compacted(session: DurableSession, instructions?: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const unsubscribe = session.subscribe((event) => { if (event.type.startsWith("compaction") || event.type === "settled") events.push(event); });
  const ended = nextEvent(session, (event) => event.type === "compaction_end");
  await session.compact(instructions);
  await ended;
  unsubscribe();
  return events;
}

/** Two turns that leave Durable a background compaction whose summary the provider holds. */
async function heldBackgroundCompaction(t: TestContext) {
  // A 32k window puts Durable's background threshold (32,768 below `contextWindow - reserveTokens`) under zero.
  const f = await fixture(t, { contextWindow: 32_000, settings: { compaction: { keepRecentTokens: 40 } } });
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-background" }, host);
  const events: RuntimeEvent[] = [];
  session.subscribe((event) => { if (event.type.startsWith("compaction")) events.push(event); });
  await turns(session, ["E2E_SLOW_COMPACT first turn", `AUTO_TWO ${"kept ".repeat(400)}`]);
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200, "the background summary request is held");
  return { f, host, session, events };
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
    : event.type === "compaction_start" ? `start:${event.reason}` : event.type), ["start:manual", "end:manual:done"], "no settle: nothing ran");
  assert.deepEqual(events[0], { type: "compaction_start", reason: "manual", blocking: false }, "Durable runs it beside the conversation");
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
  let view = await conversation!.context(durableContext);
  assert(view.messages.some((message) => message.role === "system"), "Durable re-baselined its system prompt");
  assert.equal(session.currentUsage()?.contextTokens, estimateContext(view, []), "unmeasured: estimates of the whole context");
  // An answered request after the summary measures the context; what follows it is estimated.
  await turns(session, ["AFTER_ERROR answered"]);
  view = await conversation!.context(durableContext);
  assert.equal(session.currentUsage()?.contextTokens, estimateContext(view, []), "measured by the newest answer");
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

test("a prompt sent while Durable compacts runs at once, and the summary lands where Durable places it", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-compact-prompt" }, f.host());
  await turns(session, ["E2E_SLOW_COMPACT first turn", LONG_TURN]);
  const ended = nextEvent(session, (event) => event.type === "compaction_end");
  await session.compact();
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200, "the summary request is held");

  await turns(session, ["WHILE_COMPACTING sent meanwhile"]);
  let context = await lastTurnRequest(f.log);
  assert.match(context, /WHILE_COMPACTING/u, "answered while the summary is still held");
  assert.match(context, /E2E_SLOW_COMPACT first turn/u, "from the whole history: there is no summary yet");
  assert.doesNotMatch(context, /FIXTURE_SUMMARY/u);

  await f.control("/control/release-replay", "POST");
  const end = await ended;
  assert(end.type === "compaction_end" && end.outcome === "done", JSON.stringify(end));
  assert.deepEqual(outline(session.transcript()), [
    "user:E2E_SLOW_COMPACT", "assistant", "user:COMPACT_THREE", "assistant", "user:WHILE_COMPACTING", "assistant", "compaction",
  ], "placed after the turn answered meanwhile");
  await turns(session, ["AFTER_SUMMARY"]);
  context = await lastTurnRequest(f.log);
  assert.match(context, /FIXTURE_SUMMARY/u);
  assert.match(context, /WHILE_COMPACTING/u, "the turn after the cut stays verbatim");
  assert.doesNotMatch(context, /E2E_SLOW_COMPACT first turn/u, "the summarized turn leaves the model context");
});

test("Stop cancels a manual compaction, as Durable's own abort does; a new view sees it running", { timeout: 45_000 }, async (t) => {
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
  assert.deepEqual(replayed, [{ type: "compaction_start", reason: "manual", blocking: false }]);
  second.dispose();

  await session.abort();
  const end = await ended;
  assert(end.type === "compaction_end" && end.outcome === "cancelled", JSON.stringify(end));
  assert.equal(session.isStreaming, false, "Stop resolves once the compaction has ended");
  assert.equal(session.transcript().some((entry) => entry.kind === "compaction"), false, "no summary is written");
});

test("cancelling a manual compaction stops only it, and the session carries on", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-cancel-alone" }, f.host());
  await turns(session, ["E2E_SLOW_COMPACT first turn", LONG_TURN]);
  const ended = nextEvent(session, (event) => event.type === "compaction_end");
  await session.compact();
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200, "the summary request is held");
  await session.cancelCompaction();
  const end = await ended;
  assert(end.type === "compaction_end" && end.outcome === "cancelled", JSON.stringify(end));
  await turns(session, ["AFTER_CANCEL"]);
  assert.deepEqual(outline(session.transcript()).slice(-2), ["user:AFTER_CANCEL", "assistant"]);
  assert.equal(session.transcript().some((entry) => entry.kind === "compaction"), false, "no summary is written");
});

test("cancelling right after starting reaches a compaction the stream has not listed yet", { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-cancel-early" }, host);
  await turns(session, ["E2E_SLOW_COMPACT first turn", LONG_TURN]);
  const events: RuntimeEvent[] = [];
  session.subscribe((event) => { if (event.type.startsWith("compaction")) events.push(event); });
  await session.compact();
  await session.cancelCompaction();
  const ends = events.filter((event) => event.type === "compaction_end");
  assert.deepEqual(ends.map((event) => event.type === "compaction_end" && event.outcome), ["cancelled"], "one end, reported before Cancel returns");
  assert.equal(events.at(-1)?.type, "compaction_end", "nothing reports it running afterwards");

  const second = await startDurable({ cwd: f.cwd, sessionFile: session.sessionFile }, host);
  const replayed: RuntimeEvent[] = [];
  second.subscribe((event) => replayed.push(event));
  assert.deepEqual(replayed, [], "Durable lists no compaction");
  second.dispose();
  await turns(session, ["AFTER_EARLY_CANCEL"]);
  assert.equal(session.transcript().some((entry) => entry.kind === "compaction"), false);
  assert.equal(events.filter((event) => event.type === "compaction_end").length, 1, "its listing and end are not reported again");
});

test("a background compaction leaves the session idle and survives Stop", { timeout: 60_000 }, async (t) => {
  const { f, session, events } = await heldBackgroundCompaction(t);
  assert.deepEqual(events, [{ type: "compaction_start", reason: "threshold", blocking: false, background: true }]);
  assert.equal(session.isStreaming, false, "the run ended; Durable compacts beside the idle conversation");

  await session.abort();
  await session.cancelCompaction();
  assert.equal(events.some((event) => event.type === "compaction_end"), false, "Stop and Cancel leave background work running");

  const ended = nextEvent(session, (event) => event.type === "compaction_end");
  await f.control("/control/release-replay", "POST");
  const end = await ended;
  assert(end.type === "compaction_end" && end.outcome === "done", JSON.stringify(end));
  assert.equal(session.transcript().at(-1)?.kind, "compaction", "the history holds the summary when its end is reported");
});

test("clearing during a background compaction drops its summary, as Durable makes it stale", { timeout: 60_000 }, async (t) => {
  const { f, host, session, events } = await heldBackgroundCompaction(t);
  await session.clear();
  assert.deepEqual(session.transcript(), []);
  // A second view still sees Durable's compaction run, and reports when it ends.
  const second = await startDurable({ cwd: f.cwd, sessionFile: session.sessionFile }, host);
  const secondEnded = nextEvent(second, (event) => event.type === "compaction_end");
  await f.control("/control/release-replay", "POST");
  await secondEnded;
  second.dispose();
  assert.deepEqual(events.filter((event) => event.type === "compaction_end"), [], "the stale compaction's end is not reported");
  await turns(session, ["AFTER_CLEAR"]);
  assert.deepEqual(outline(session.transcript()), ["user:AFTER_CLEAR", "assistant"]);
  assert.doesNotMatch(await lastTurnRequest(f.log), /FIXTURE_SUMMARY|E2E_SLOW_COMPACT/u);
});

test("a rewind forks Durable's history as it was, without a summary placed later", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-rewind-compaction" }, f.host());
  await turns(session, ["COMPACT_ONE first turn", "COMPACT_TWO second turn", LONG_TURN]);
  await compacted(session);

  // Even inside the summary's kept window, the fork holds only the history up to it, so the model rereads the
  // original turns; Durable compacts the fork again when it needs to.
  await session.rewind(userEntryId(session, "COMPACT_THREE"), { excludeUserMessage: true });
  assert.deepEqual(outline(session.transcript()), ["user:COMPACT_ONE", "assistant", "user:COMPACT_TWO", "assistant"]);
  await turns(session, ["AFTER_FORK"]);
  const context = await lastTurnRequest(f.log);
  assert.match(context, /COMPACT_ONE/u);
  assert.match(context, /COMPACT_TWO/u);
  assert.doesNotMatch(context, /FIXTURE_SUMMARY|COMPACT_THREE/u);

  // A prompt the browser shows without an entry ID is counted from the end.
  await session.rewind({ userFromEnd: 0 }, { excludeUserMessage: true });
  assert.deepEqual(outline(session.transcript()), ["user:COMPACT_ONE", "assistant", "user:COMPACT_TWO", "assistant"]);
});

test("Durable compacts by itself ahead of the threshold, in the background", { timeout: 60_000 }, async (t) => {
  // A 32k window puts Durable's background threshold (32,768 below `contextWindow - reserveTokens`) under zero.
  const f = await fixture(t, { contextWindow: 32_000, settings: { compaction: { keepRecentTokens: 40 } } });
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-auto" }, f.host());
  const starts: string[] = [];
  session.subscribe((event) => { if (event.type === "compaction_start") starts.push(`${event.reason}:${event.background ? "background" : "foreground"}`); });
  await turns(session, ["AUTO_ONE first turn", `AUTO_TWO ${"kept ".repeat(400)}`]);
  const entries = await transcriptWhere(session, (items) => items.some((entry) => entry.kind === "compaction") && !session.isStreaming);
  assert.deepEqual([...new Set(starts)], ["threshold:background"]);
  assert.deepEqual(outline(entries).filter((item) => item.startsWith("user:")), ["user:AUTO_ONE", "user:AUTO_TWO"], "history stays whole");
});

test("a PI session moved to Durable keeps its history and spend, and the model resumes from PI's context", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, KEPT_WINDOW);
  const time = "2026-10-01T10:00:00.000Z";
  const spent = (input: number) => ({ input, output: 2, cacheRead: 1, cacheWrite: 3, totalTokens: input + 6, cost: { input: 0.2, output: 0.1, cacheRead: 0.05, cacheWrite: 0.05, total: 0.4 } });
  const text = (value: string) => [{ type: "text", text: value }];
  const user = (id: string, parentId: string | null, value: string) => ({ type: "message", id, parentId, timestamp: time, message: { role: "user", content: text(value), timestamp: 1 } });
  const answer = (id: string, parentId: string, content: unknown[], stopReason = "stop") => ({ type: "message", id, parentId, timestamp: time,
    message: { role: "assistant", content, api: "anthropic-messages", provider: "hui-e2e", model: "fixture", usage: spent(10), stopReason, timestamp: 2 } });
  // As PI writes a session: a rewind left an abandoned branch, and a summary keeps the long turn verbatim.
  const content = [
    { type: "session", version: 3, id: "pi-1", timestamp: time, cwd: f.cwd },
    user("u1", null, "PI_ONE first turn"), answer("a1", "u1", text("PI answer one")),
    user("x1", "a1", "PI_ABANDONED branch"), answer("x2", "x1", text("abandoned answer")),
    user("u2", "a1", "PI_TWO second turn"), answer("a2", "u2", text("PI answer two")),
    user("u3", "a2", LONG_TURN.replace("COMPACT_THREE", "PI_THREE")), answer("a3", "u3", text("PI answer three")),
    { type: "compaction", id: "c1", parentId: "a3", timestamp: time, summary: "PI_SUMMARY", firstKeptEntryId: "u3", tokensBefore: 4321, usage: spent(20) },
    user("u4", "c1", "PI_FOUR after the summary"),
    answer("a4", "u4", [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "fixture.txt" } }], "toolUse"),
    { type: "message", id: "r4", parentId: "a4", timestamp: time, message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: text("Durable fixture content"), isError: false, timestamp: 3 } },
    answer("a5", "r4", text("PI answer four")),
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
  const source = join(f.dir, "pi-session.jsonl");
  await writeFile(source, content);
  const host = f.host();
  const session = { id: "moved-session", cwd: f.cwd, source, model: "hui-e2e/fixture", thinking: "high" };
  const imported = await importPiSession(host, session, content);
  assert.deepEqual(
    { reused: imported.reused, messages: imported.messages, summaries: imported.summaries, abandoned: imported.abandoned, model: imported.model },
    { reused: false, messages: 10, summaries: 1, abandoned: 2, model: "hui-e2e/fixture" },
  );

  // HUI reports the same spend for the conversation as it did for the PI file.
  const record = (piSessionFile: string) => ({ id: session.id, title: "Moved", group: "", cwd: f.cwd, tool: "pi", piSessionFile, createdAt: time, updatedAt: time });
  const before = await aggregateUsage([record(source)]);
  const after = await aggregateUsage([record(durableReference(imported.conversationId))], (id) => host.conversationUsage(id as never));
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"] as const) assert.equal(after[key], before[key], key);
  assert(Math.abs((after.costUsd ?? 0) - (before.costUsd ?? 0)) < 1e-9, `cost ${after.costUsd} vs ${before.costUsd}`);
  const again = await importPiSession(host, session, content);
  assert.deepEqual([again.reused, again.conversationId], [true, imported.conversationId], "an unchanged file is not copied twice");

  const moved = await startDurable({ cwd: f.cwd, sessionFile: durableReference(imported.conversationId) }, host);
  assert.deepEqual(outline(moved.transcript()), [
    "user:PI_ONE", "assistant", "user:PI_TWO", "assistant", "user:PI_THREE", "assistant", "compaction", "user:PI_FOUR", "assistant",
  ]);
  assert(moved.transcript().some((entry) => entry.kind === "tool" && entry.name === "read"), "the tool call after the summary");
  const divider = moved.transcript().find((entry) => entry.kind === "compaction");
  assert(divider?.kind === "compaction" && divider.summary === "PI_SUMMARY", JSON.stringify(divider));
  assert.deepEqual([moved.currentModel()?.id, moved.currentThinking()], ["fixture", "high"]);

  await turns(moved, ["AFTER_MOVE next turn"]);
  const request = await lastTurnRequest(f.log);
  // Every message PI itself would send next, apart from its summary wrapper, and nothing it summarized or abandoned.
  const { buildSessionContext, convertToLlm, parseSessionEntries } = await import("@earendil-works/pi-coding-agent");
  const piContext = buildSessionContext(parseSessionEntries(content).slice(1) as never).messages.filter((message) => message.role !== "compactionSummary");
  for (const message of convertToLlm(piContext)) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === "text") assert(request.includes(JSON.stringify(block.text).slice(1, -1)), `missing from the request: ${block.text.slice(0, 40)}`);
    }
  }
  assert.match(request, /PI_SUMMARY/u);
  assert.match(request, /AFTER_MOVE/u);
  assert.doesNotMatch(request, /PI_ONE|PI_TWO|PI_ABANDONED/u);
  assert.equal(await readFile(source, "utf8"), content, "the PI file is unchanged");
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

test("Durable requests give each HUI session its own PI_CLIENT_SESSION_ID for provider headers", async (t) => {
  const inherited = process.env["PI_CLIENT_SESSION_ID"];
  delete process.env["PI_CLIENT_SESSION_ID"];
  t.after(() => {
    if (inherited === undefined) delete process.env["PI_CLIENT_SESSION_ID"];
    else process.env["PI_CLIENT_SESSION_ID"] = inherited;
  });
  const f = await fixture(t, KEPT_WINDOW);
  const host = f.host();
  const first = await startDurable({ cwd: f.cwd, huiSessionId: "identity-first" }, host);
  const second = await startDurable({ cwd: f.cwd, huiSessionId: "identity-second" }, host);
  await turns(first, ["IDENTITY_FIRST one", "IDENTITY_FIRST " + "kept ".repeat(400)]);
  await turns(second, ["IDENTITY_SECOND one"]);
  const compacted = nextEvent(first, (event) => event.type === "compaction_end");
  await first.compact();
  await compacted;
  // The fixture logs the x-client-session-id header each request resolved.
  const identities = async (marker: string, summary = false) => new Set((await providerRequests(f.log))
    .filter((request) => summarizing(request) === summary && JSON.stringify(request.messages).includes(marker))
    .map((request) => (request as ProviderRequest & { clientSessionId?: string }).clientSessionId));
  const [firstId, ...otherFirst] = await identities("IDENTITY_FIRST");
  const [secondId, ...otherSecond] = await identities("IDENTITY_SECOND");
  assert.deepEqual([otherFirst, otherSecond], [[], []], "one identity per HUI session");
  assert.match(String(firstId), /^[0-9a-f-]{36}$/u);
  assert.match(String(secondId), /^[0-9a-f-]{36}$/u);
  assert.notEqual(firstId, secondId, "independent sessions need independent identities");
  assert.deepEqual([...await identities("IDENTITY_FIRST", true)], [firstId], "a summary is requested as its session");
  assert.equal(process.env["PI_CLIENT_SESSION_ID"], undefined, "the gateway environment is unchanged");
  process.env["PI_CLIENT_SESSION_ID"] = "operator-id";
  await turns(second, ["IDENTITY_OPERATOR two"]);
  assert.deepEqual([...await identities("IDENTITY_OPERATOR")], ["operator-id"], "an explicit gateway value is kept, as for PI workers");
});

/** A PI extension using the surfaces Durable sessions bind: a tool, tool hooks, `input`, `before_agent_start`, a
 * command that asks the user and stores state, and lifecycle events. It logs what it saw, one JSON line each. */
function fixtureExtension(log: string): string {
  return `import { appendFileSync } from "node:fs";
export default function (pi) {
  const record = (entry) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + "\\n");
  const loaded = Date.now() + Math.random();
  pi.on("session_start", (event, ctx) => {
    const choices = ctx.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "fixture-choice");
    record({ event: "session_start", reason: event.reason, loaded, session: ctx.sessionManager.getSessionId(), choices: choices.map((entry) => entry.data.choice), hasUI: ctx.hasUI });
  });
  pi.on("session_shutdown", (event) => record({ event: "session_shutdown", reason: event.reason, loaded }));
  pi.on("agent_end", (event) => record({ event: "agent_end", roles: event.messages.map((message) => message.role) }));
  pi.on("tool_execution_end", (event) => record({ event: "tool_execution_end", tool: event.toolName, isError: event.isError }));
  pi.registerTool({
    name: "fixture_echo", label: "Echo", description: "Echoes text with the session it ran in.", promptSnippet: "Echo text back",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async execute(_id, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "echoing" }], details: {} });
      return { content: [{ type: "text", text: "echo: " + params.text + " in " + ctx.sessionManager.getSessionId() + " on " + ctx.model?.id }], details: { cwd: ctx.cwd } };
    },
  });
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" && String(event.input.command).includes("command fixture")) return { block: true, reason: "the fixture extension blocks it" };
  });
  pi.on("tool_result", (event) => {
    if (event.toolName === "fixture_echo") return { content: [...event.content, { type: "text", text: " (seen by tool_result)" }] };
  });
  pi.on("input", (event) => event.text.startsWith("FIXTURE_ALIAS") ? { action: "transform", text: event.text.replace("FIXTURE_ALIAS", "E2E_EXTENSION_TOOL") } : { action: "continue" });
  pi.on("before_agent_start", (event) => ({
    message: { customType: "fixture-context", content: "FIXTURE_CONTEXT_MARKER", display: false },
    systemPrompt: "FIXTURE_PROTOCOL\\n" + event.systemPrompt,
  }));
  pi.registerCommand("fixture-ask", {
    description: "Asks for a colour and keeps it",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pick a colour", ["red", "blue"]);
      pi.appendEntry("fixture-choice", { choice });
      ctx.ui.notify("picked " + choice, "info");
    },
  });
  pi.registerCommand("fixture-send", { description: "Sends a prompt", handler: async (args) => { pi.sendUserMessage("E2E_EXTENSION_TOOL " + args); } });
}
`;
}

async function extensionLog(log: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const logged = async (log: string, event: string) => (await extensionLog(log)).filter((entry) => entry["event"] === event);

/** Sends `text` and resolves once the session settled: after the run, and after its extensions' end-of-run handlers. */
async function settledAfter(session: DurableSession, text: string): Promise<void> {
  const settled = nextEvent(session, (event) => event.type === "settled");
  await session.prompt(text);
  await settled;
}

async function extensionFixture(t: TestContext, options: Parameters<typeof fixture>[1] = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hui-durable-extension-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = join(dir, "extension.jsonl");
  const f = await fixture(t, { ...options, extensions: { "fixture.js": fixtureExtension(events), ...options.extensions } });
  return { ...f, events, eventsDir: dir };
}

test("Durable sessions load PI extensions: their tools, hooks and prompt additions reach the model", { timeout: 45_000 }, async (t) => {
  const f = await extensionFixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-extensions" }, f.host());
  const [start] = await logged(f.events, "session_start");
  assert.deepEqual({ ...start, loaded: undefined }, { event: "session_start", reason: "startup", loaded: undefined, session: "durable-extensions", choices: [], hasUI: true });
  const inspection = await session.inspect();
  const echo = inspection.tools.find((tool) => tool.name === "fixture_echo");
  assert.match(String(echo?.source), /fixture\.js/u, "inspection names the extension that registered the tool");
  assert.ok(inspection.tools.some((tool) => tool.name === "bash" && tool.source === "Durable"), "the coding tools stay");
  assert.ok((await session.listCommands()).some((command) => command.name === "fixture-ask" && command.source === "extension"));

  const tools: string[] = [];
  session.subscribe((event) => { if (event.type === "tool_end") tools.push(`${event.name}:${event.output}`); });
  await settledAfter(session, "E2E_EXTENSION_TOOL please");
  assert.deepEqual(tools, ["fixture_echo:echo: from the model in durable-extensions on fixture (seen by tool_result)"]);
  const request = JSON.stringify((await providerRequests(f.log))[0]);
  assert.match(request, /FIXTURE_CONTEXT_MARKER/u, "before_agent_start's message reaches the model");
  assert.match(request, /FIXTURE_PROTOCOL/u, "before_agent_start's system prompt is the run's");
  assert.match(request, /fixture_echo: Echo text back/u, "the tool's snippet is in HUI's active-tool list");
  assert.ok(!JSON.stringify(session.transcript()).includes("FIXTURE_CONTEXT_MARKER"), "the custom message is context only");
  assert.deepEqual(await logged(f.events, "tool_execution_end"), [{ event: "tool_execution_end", tool: "fixture_echo", isError: false }]);
  const [end] = await logged(f.events, "agent_end");
  assert.ok((end?.["roles"] as string[]).includes("toolResult"), JSON.stringify(end));

  const blocked = nextEvent(session, (event) => event.type === "tool_end");
  await session.prompt("E2E_COMMAND run it");
  const result = await blocked;
  assert(result.type === "tool_end" && result.failed === true && /the fixture extension blocks it/u.test(String(result.output)), JSON.stringify(result));
});

test("extension commands run in the gateway, ask through HUI questions and keep their state across a reopen", { timeout: 45_000 }, async (t) => {
  const f = await extensionFixture(t);
  const host = f.host();
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-commands" }, host);
  const asked = nextEvent(session, (event) => event.type === "question");
  const notified = nextEvent(session, (event) => event.type === "notice");
  const settled = nextEvent(session, (event) => event.type === "settled");
  await session.prompt("$fixture-ask");
  const question = await asked;
  assert(question.type === "question" && question.question.method === "select", JSON.stringify(question));
  assert.deepEqual(question.question.options, ["red", "blue"]);
  assert.deepEqual(session.pendingQuestions().map((each) => each.id), [question.question.id]);
  await session.respondQuestion(question.question.id, { value: "blue" });
  assert.deepEqual(await notified, { type: "notice", level: "info", message: "picked blue" });
  await settled;
  assert.equal(session.isStreaming, false, "a command that starts no run leaves the session idle");
  assert.deepEqual(session.transcript(), [], "nothing reached the model");

  // The command's own prompt starts a run through the input pipeline.
  await settledAfter(session, "/fixture-send now");
  assert.ok(answered("Tool complete")(session.transcript()));

  const reference = session.sessionFile;
  session.dispose();
  await host.close();
  await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "durable-commands" }, f.host());
  const starts = await logged(f.events, "session_start");
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[1]!["choices"], ["blue"], "state the extension stored is read back from the store");
});

test("input handlers rewrite prompts, and a reload starts fresh extension instances", { timeout: 45_000 }, async (t) => {
  const f = await extensionFixture(t);
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-reload" }, f.host());
  const tool = nextEvent(session, (event) => event.type === "tool_end");
  await settledAfter(session, "FIXTURE_ALIAS from the input handler");
  assert.equal((await tool).type, "tool_end", "the rewritten prompt asked for the extension tool");
  assert.ok(session.transcript().some((entry) => entry.kind === "message" && entry.role === "user" && entry.text.startsWith("E2E_EXTENSION_TOOL")));

  await session.reload();
  const [first, second] = await logged(f.events, "session_start");
  assert.deepEqual(await logged(f.events, "session_shutdown"), [{ event: "session_shutdown", reason: "reload", loaded: first!["loaded"] }]);
  assert.equal(second?.["reason"], "reload");
  assert.notEqual(second!["loaded"], first!["loaded"], "a reload loads the extension again");
});

test("a disabled package loads neither its extension nor its skills, and a broken extension is reported while the session works", { timeout: 45_000 }, async (t) => {
  const f = await extensionFixture(t, { extensions: { "broken.js": "export default function () { throw new Error('fixture load failure'); }\n" } });
  // A local PI package with an extension and a skill, listed in PI settings.
  const pkg = join(f.eventsDir, "fixture-package");
  await mkdir(join(pkg, "skills", "fixture-skill"), { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "fixture-package", pi: { extensions: ["./index.js"], skills: ["./skills"] } }));
  await writeFile(join(pkg, "index.js"), fixtureExtension(f.events));
  await writeFile(join(pkg, "skills", "fixture-skill", "SKILL.md"), "---\nname: fixture-skill\ndescription: A skill the package ships.\n---\nFixture skill body.\n");
  await rm(join(f.agentDir, "extensions", "fixture.js"));
  await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture", packages: [pkg] }));
  const { configuredResourceId } = await import("./resource-policy.ts");

  const first = f.host();
  const enabled = await startDurable({ cwd: f.cwd, huiSessionId: "durable-enabled" }, first);
  const commands = await enabled.listCommands();
  assert.ok(commands.some((command) => command.name === "skill:fixture-skill"), "the package's skill loads while it is enabled");
  assert.ok(commands.some((command) => command.name === "fixture-ask"), "and so does its extension");
  enabled.dispose();
  await first.close();

  const disabled = normalizeSettings({ disabledPlugins: [{ id: configuredResourceId("package", pkg), name: "fixture-package", kind: "package" }] });
  const host = f.host({ huiSettings: disabled });
  const session = await startDurable({ cwd: f.cwd, huiSessionId: "durable-disabled" }, host);
  const inspection = await session.inspect();
  assert.ok(!inspection.tools.some((tool) => tool.name === "fixture_echo"), "a disabled package's extension never runs");
  assert.ok(!(await session.listCommands()).some((command) => command.source === "extension" || command.name === "skill:fixture-skill"));
  assert.ok(inspection.diagnostics.some((line) => /broken\.js: .*fixture load failure/u.test(line)), JSON.stringify(inspection.diagnostics));
  assert.deepEqual((await logged(f.events, "session_start")).map((entry) => entry["session"]), ["durable-enabled"]);
  await settledAfter(session, "E2E_RICH read the fixture");
  assert.ok(answered("Tool complete")(session.transcript()));
});

test("interrupted runs resume once their sessions have loaded their PI extensions again", { timeout: 60_000 }, async (t) => {
  const f = await extensionFixture(t);
  const hostUrl = new URL("./durable-host.ts", import.meta.url).href;
  const durableUrl = new URL("./durable.ts", import.meta.url).href;
  const settingsUrl = new URL("../../src/lib/settings.ts", import.meta.url).href;
  // A separate gateway owns the store and is SIGKILLed while bash is running.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DurableHost } = await import(${JSON.stringify(hostUrl)});
    const { startDurable } = await import(${JSON.stringify(durableUrl)});
    const { normalizeSettings } = await import(${JSON.stringify(settingsUrl)});
    const host = new DurableHost({ dir: ${JSON.stringify(f.store)}, agentDir: ${JSON.stringify(f.agentDir)},
      readSettings: async () => normalizeSettings(undefined), invokeTool: async () => ({}), lookupCaller: async () => undefined });
    const session = await startDurable({ cwd: ${JSON.stringify(f.cwd)}, huiSessionId: "crash-extensions" }, host);
    process.stdout.write("REF " + session.sessionFile + "\\n");
    await session.prompt("E2E_COMMAND_RUNNING hold the command");
  `], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  f.children.push(child);
  const [line] = await once(child.stdout!, "data");
  const reference = /REF (durable:\d+)/u.exec(String(line))?.[1];
  assert(reference, String(line));
  assert.equal((await f.control("/control/wait-replay-ready")).status, 200, "bash is running the held command");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;

  // The next gateway reopens the session before the run goes on, as the gateway does with every session whose
  // conversation has unfinished work.
  const host = f.host();
  let interrupted: readonly unknown[] = [];
  let reopened!: (session: DurableSession) => void;
  const reopening = new Promise<DurableSession>((resolve) => { reopened = resolve; });
  host.beforeResume = async (conversations) => {
    interrupted = conversations;
    reopened(await startDurable({ cwd: f.cwd, sessionFile: reference, huiSessionId: "crash-extensions" }, host));
  };
  await host.open();
  await transcriptWhere(await reopening, answered("Tool complete"));
  assert.deepEqual(interrupted.map(String), [reference.slice("durable:".length)]);
  const resumed = (await providerRequests(f.log)).at(-1) as ProviderRequest & { tools?: unknown };
  assert.match(JSON.stringify(resumed.tools), /fixture_echo/u, "the resumed run's next request offers the extension's tool");
});

