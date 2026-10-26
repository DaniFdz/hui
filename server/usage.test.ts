/**
 * The Usage page's report: contracts read through a real Durable store and real
 * legacy transcripts, so a fork's inherited entries count once, a recorded zero
 * stays zero, calendar days follow the requested zone, and nothing but counters
 * leaves the gateway.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";
import { AssistantEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
import { UsageReport } from "./api/diagnostics.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import { expectSchema } from "./test-support/api-schema.ts";

const root = await mkdtemp(join(tmpdir(), "hui-usage-"));
const agentDir = join(root, "agent");
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
await mkdir(agentDir, { recursive: true });
await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "hui-e2e": {
  baseUrl: "http://127.0.0.1:9", api: "anthropic-messages", apiKey: "***", models: [{
    id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
} } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "hui-e2e", defaultModel: "fixture" }));

const { durableContext, durableHost } = await import("./runtimes/durable-host.ts");
const { scanUsage, sliceUsage, usageQuery } = await import("./usage.ts");

const readUsageReport = async (sessions: readonly SessionRecord[], query: ReturnType<typeof usageQuery>) => sliceUsage(await scanUsage(sessions, query.timeZone), query);

const host = durableHost();
host.configureDurableBots(null);
const harness = await host.open();
afterAll(async () => {
  await host.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
});

const T1 = Date.UTC(2026, 5, 1, 20, 0);
const T2 = Date.UTC(2026, 5, 2, 10, 0);
const T3 = Date.UTC(2026, 5, 2, 20, 0);
const FUTURE = Date.UTC(2100, 0, 5, 12, 0);

function priced(input: number, output: number, totalTokens: number, total: number) {
  return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total } };
}

function unpriced(input: number, output: number, totalTokens: number) {
  return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens };
}

const assistant = (timestamp: number, usage: unknown, stopReason = "stop") => ({
  role: "assistant", api: "anthropic-messages", provider: "fixture", model: "model-a", content: [], stopReason, usage, timestamp,
});
const user = (timestamp: number, content: string) => ({ role: "user", content, timestamp });

function record(id: string, piSessionFile: string, createdAt: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { id, title: id, group: "fixture", cwd: "/tmp", tool: "pi", piSessionFile, createdAt, updatedAt: createdAt, ...extra };
}

const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("a fork's inherited entries count once, attributed to the conversation that owns them", async () => {
  const { source, answer, future } = await harness.commit(async (tx) => {
    const source = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(source, { kind: UserEntry.kind, model: [user(T1, "first") as never] });
    const answer = (await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T1, priced(10, 5, 20, 0.5)) as never] })).id;
    await tx.appendEntry(source, { kind: ToolResultEntry.kind, model: [{ role: "toolResult", toolCallId: "c1", toolName: "read", content: [], isError: true, timestamp: T2, usage: priced(100, 0, 100, 9) } as never] });
    await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T2, priced(1, 1, 2, 0)) as never] });
    await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T3, unpriced(4, 0, 4), "error") as never] });
    const future = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(future, { kind: AssistantEntry.kind, model: [assistant(FUTURE, priced(5, 0, 5, 0.5)) as never] });
    return { source, answer, future };
  }, durableContext);
  const fork = await harness.commit(async (tx) => {
    const fork = (await tx.forkConversation(source, answer, { ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(fork, { kind: UserEntry.kind, model: [user(T2, "in the fork") as never] });
    await tx.appendEntry(fork, { kind: AssistantEntry.kind, model: [assistant(T2, priced(7, 3, 10, 0.25)) as never] });
    return fork;
  }, durableContext);

  const sessions = [
    record("fork", `durable:${fork}`, "2026-01-01T00:00:00.000Z", { parentId: "source" }),
    record("source", `durable:${source}`, "2026-01-02T00:00:00.000Z"),
    record("remote", `durable:${source}`, "2026-01-03T00:00:00.000Z", { worker: "w1" }),
  ];
  const futureSession = record("future", `durable:${future}`, "2026-01-04T00:00:00.000Z");
  const ahead = [...sessions, futureSession];

  const report = await readUsageReport(sessions, usageQuery(new URLSearchParams({ from: "2026-06-02", to: "2026-06-03", timeZone: "Asia/Kolkata" })));
  expectSchema(UsageReport, report);
  assert.deepEqual(report.range, { from: "2026-06-02", to: "2026-06-03", timeZone: "Asia/Kolkata" });
  assert.deepEqual(report.coverage, { registeredSessions: 3, readSessions: 2, unavailable: [{ sessionId: "remote", reason: "The transcript lives on a remote worker and is not read here." }], undatedRecords: 0 });

  const owned = report.sessions.find((each) => each.id === "source")!;
  assert.deepEqual(report.sessions.map((each) => each.id), ["source", "fork"], "the newest activity leads");
  assert.deepEqual(owned.days.map((day) => day.date), ["2026-06-02", "2026-06-03"]);
  assert.equal(owned.days[0]?.metrics.totalTokens, 122, "the day follows the requested zone, and a tool's spend is counted in it");
  assert.deepEqual(owned.metrics, {
    inputTokens: 115, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 126, costUsd: 9.5,
    unpricedCalls: 1, calls: 4, userMessages: 1, assistantMessages: 3, toolResults: 1, errors: 2,
  }, "a tool's spend counts once, a model failure is an error, and a recorded zero stays priced");
  assert.deepEqual(owned.tools, [{ name: "read", calls: 1, errors: 1 }]);
  assert.deepEqual(owned.models.map((model) => [model.provider, model.model, model.metrics.totalTokens]), [["fixture", "model-a", 26]], "a tool's spend is not guessed into a model");

  const copy = report.sessions.find((each) => each.id === "fork")!;
  assert.deepEqual(copy.days.map((day) => day.metrics.totalTokens), [10], "inherited entries stay with the conversation that wrote them");
  assert.equal(copy.parentId, "source");
  assert.equal(copy.metrics.userMessages, 1);

  const narrowed = await readUsageReport(sessions, usageQuery(new URLSearchParams({ from: "2026-06-03", to: "2026-06-03", timeZone: "Asia/Kolkata" })));
  assert.deepEqual(narrowed.sessions.map((each) => [each.id, each.metrics.totalTokens]), [["source", 4]], "a day outside the range leaves a session out");

  const all = await readUsageReport(sessions, usageQuery(new URLSearchParams({ timeZone: "Asia/Kolkata" })));
  assert.deepEqual(all.range, { from: "2026-06-02", to: todayIn("Asia/Kolkata"), timeZone: "Asia/Kolkata" }, "All runs from the first recorded day to today");
  assert.deepEqual((await readUsageReport(ahead, usageQuery(new URLSearchParams({ timeZone: "Asia/Kolkata" })))).range,
    { from: "2026-06-02", to: "2100-01-05", timeZone: "Asia/Kolkata" }, "All reaches past today to the last recorded day it counted");
  assert.deepEqual((await readUsageReport([futureSession], usageQuery(new URLSearchParams({ timeZone: "UTC" })))).range,
    { from: "2100-01-05", to: "2100-01-05", timeZone: "UTC" });
});

test("legacy transcripts report unpriced calls, undated records and gaps without their content", async () => {
  const dir = join(root, "legacy");
  await mkdir(dir, { recursive: true });
  const transcript = join(dir, "legacy.jsonl");
  const time = "2026-03-01T09:00:00.000Z";
  const M1 = Date.UTC(2026, 2, 1, 9, 0);
  const M2 = Date.UTC(2026, 2, 2, 9, 0);
  await writeFile(transcript, [
    { type: "message", timestamp: time, message: { role: "user", content: "SECRET_PROMPT_MARKER", timestamp: M1 } },
    { type: "message", timestamp: time, message: { role: "assistant", provider: "fixture", model: "model-b", content: [], timestamp: M1, usage: priced(10, 2, 0, 0) } },
    { type: "message", timestamp: time, message: { role: "assistant", provider: "fixture", model: "model-b", content: [], timestamp: M2, stopReason: "error", usage: { input: 6, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: -1 } } } },
    { type: "message", timestamp: time, message: { role: "toolResult", toolName: "bash", isError: true, content: [], timestamp: M1, usage: priced(2, 0, 2, 0.1) } },
    { type: "usage", kind: "cache_warm", timestamp: "2026-03-01T10:00:00.000Z", provider: "fixture", model: "model-c", usage: priced(3, 0, 3, 0.25) },
    { type: "message", message: { role: "assistant", provider: "fixture", model: "model-b", content: [], usage: unpriced(1000, 0, 1000) } },
    { type: "message", message: { role: "assistant", provider: "fixture", model: "model-b", content: [], timestamp: 1e20, usage: unpriced(1000, 0, 1000) } },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n{broken\n");

  const sessions = [
    record("legacy", transcript, "2026-01-01T00:00:00.000Z"),
    record("duplicate", transcript, "2026-01-02T00:00:00.000Z"),
    record("remote", "durable:7", "2026-01-03T00:00:00.000Z", { worker: "w1" }),
    record("lost", "durable:999999", "2026-01-04T00:00:00.000Z"),
    record("draft", "", "2026-01-05T00:00:00.000Z"),
  ];
  const report = await readUsageReport(sessions, usageQuery(new URLSearchParams({ from: "2026-03-01", to: "2026-03-31", timeZone: "UTC" })));

  expectSchema(UsageReport, report);
  assert.equal(report.coverage.registeredSessions, 5);
  assert.equal(report.coverage.readSessions, 1, "the duplicate path, the draft and the lost conversation are not read again");
  assert.deepEqual(report.coverage.unavailable, [
    { sessionId: "legacy", reason: "Some transcript records could not be read." },
    { sessionId: "lost", reason: "The local conversation could not be read." },
    { sessionId: "remote", reason: "The transcript lives on a remote worker and is not read here." },
  ]);
  assert.equal(report.coverage.undatedRecords, 2, "a record with no time, or one no calendar can hold, is a gap and never 1970 or the session's update");

  const legacy = report.sessions.find((each) => each.id === "legacy")!;
  assert.deepEqual(report.sessions.map((each) => each.id), ["legacy"], "a session with no dated activity in range is not a row");
  assert.deepEqual(
    { totalTokens: legacy.metrics.totalTokens, inputTokens: legacy.metrics.inputTokens, calls: legacy.metrics.calls, costUsd: legacy.metrics.costUsd, unpricedCalls: legacy.metrics.unpricedCalls },
    { totalTokens: 11, inputTokens: 21, calls: 4, costUsd: 0.35, unpricedCalls: 1 },
    "a recorded total of zero stays zero, a negative price is unpriced rather than free, and a tool's spend counts once",
  );
  assert.equal(legacy.metrics.errors, 2, "a model failure and a failed tool are both errors");
  assert.deepEqual(legacy.tools, [{ name: "bash", calls: 1, errors: 1 }]);
  assert.deepEqual(legacy.models.map((model) => [model.provider, model.model, model.metrics.calls]), [
    ["fixture", "model-b", 2],
    ["fixture", "model-c", 1],
  ], "a tool's spend is not guessed into a model");
  assert.equal(legacy.models.reduce((total, model) => total + model.metrics.totalTokens, 0), 9, "model totals never add the tool's spend twice");
  assert.doesNotMatch(JSON.stringify(report), /SECRET_PROMPT_MARKER/u, "no prompt, body, argument or output reaches the report");
});

test("the range rejects dates it cannot mean and time zones it does not know", () => {
  const query = (params: Record<string, string>) => () => usageQuery(new URLSearchParams(params));
  assert.deepEqual(usageQuery(new URLSearchParams()), { kind: "all", timeZone: "UTC" });
  assert.deepEqual(usageQuery(new URLSearchParams({ from: "2026-01-01", to: "2026-01-01", timeZone: "Europe/Madrid" })),
    { kind: "custom", from: "2026-01-01", to: "2026-01-01", timeZone: "Europe/Madrid" });
  const refused: [Record<string, string>, string][] = [
    [{ from: "2026-01-01" }, "from alone"],
    [{ to: "2026-01-01" }, "to alone"],
    [{ from: "2026-02-30", to: "2026-03-01" }, "an impossible date"],
    [{ from: "2026-1-1", to: "2026-01-02" }, "an unpadded date"],
    [{ from: "2026-03-01", to: "2026-02-01" }, "a reversed range"],
    [{ from: "2025-01-01", to: "2026-01-02" }, "more than 366 days"],
    [{ from: "2026-01-01", to: "2026-01-02", timeZone: "Mars/Olympus" }, "an unknown zone"],
  ];
  for (const [params, why] of refused) assert.throws(query(params), /./u, why);
});
test("one scan answers every range, and a forced refresh or newer activity reads the histories again", async () => {
  const { UsageReports } = await import("./usage.ts");
  const conversation = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(10, 5, 20, 0.5)) as never] });
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T2, priced(10, 5, 20, 0.25)) as never] });
    return id;
  }, durableContext);
  const sessions = [record("cached", `durable:${conversation}`, new Date(T1).toISOString())];
  let reads = 0;
  let activity = new Date(T1).toISOString();
  const reports = new UsageReports(async () => sessions.map((session) => ({ ...session, updatedAt: activity })), async (given, timeZone) => {
    reads += 1;
    return (await import("./usage.ts")).scanUsage(given, timeZone);
  });

  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  const first = await reports.get(june);
  assert.equal(reads, 1);
  assert.equal(first.sessions[0]?.metrics.calls, 2);

  const juneFirst = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-01", timeZone: "UTC" }));
  const [narrow, concurrent] = await Promise.all([reports.get(juneFirst), reports.get(june)]);
  assert.equal(reads, 1, "a range and its neighbours come from the scan already held");
  assert.equal(narrow.sessions[0]?.metrics.calls, 1);
  assert.equal(concurrent.sessions[0]?.metrics.calls, 2);

  await reports.get(june, true);
  assert.equal(reads, 2, "refresh reads every history again");

  activity = new Date(T2).toISOString();
  const [afterActivity, shared] = await Promise.all([reports.get(june), reports.get(juneFirst)]);
  assert.equal(reads, 3, "newer registry activity reads once, even for two requests at once");
  assert.equal(afterActivity.range.to, "2026-06-02");
  assert.equal(shared.sessions[0]?.metrics.calls, 1);
});
