/**
 * The Usage page's report: contracts read through a real Durable store and real
 * legacy transcripts, so a fork's inherited entries count once, a recorded zero
 * stays zero, calendar days follow the requested zone, a repeated or interrupted
 * read never doubles what it counted, and nothing but counters leaves the
 * gateway.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test, vi } from "vitest";
import { AssistantEntry, CompactionEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
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
const { recordUsage } = await import(new URL("./harness/usage.js", import.meta.resolve("@earendil-works/pi-durable")).href) as {
  recordUsage(tx: unknown, conversationId: unknown, bucket: "models" | "tools", key: string, usage: unknown): Promise<void>;
};
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
const DAY = 86_400_000;
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

function watchEntryReads() {
  const payloads = new Map<number, number>();
  const real = harness.conversation.bind(harness);
  const spy = vi.spyOn(harness, "conversation").mockImplementation(async (id, context) => {
    const conversation = await real(id, context);
    if (!conversation) return undefined;
    const entries = conversation.entries.bind(conversation);
    conversation.entries = async (...args) => {
      const page = await entries(...args);
      payloads.set(id, (payloads.get(id) ?? 0) + page.items.length);
      return page;
    };
    return conversation;
  });
  return { payloads, restore: () => spy.mockRestore() };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sessionTotals = (report: UsageReport) => report.sessions.map((each) => [each.id, each.metrics.totalTokens, each.metrics.costUsd]).toSorted();

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
    { sessionId: "lost", reason: "The local conversation or its spend ledger could not be read." },
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

test("compaction spend the store keeps outside entries is reported once, beside the range", async () => {
  const answerUsage = priced(10, 5, 20, 0.5);
  const toolUsage = priced(2, 0, 2, 0.1);
  const undatedUsage = priced(6, 0, 6, 0.3);
  const forkUsage = priced(3, 1, 4, 0.2);
  const summaryUsage = priced(1000, 100, 1100, 3);
  const { source, fork, quiet } = await (async () => {
    const source = await harness.commit(async (tx) => {
      const source = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
      await tx.appendEntry(source, { kind: UserEntry.kind, model: [user(T1, "first") as never] });
      const answer = (await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T1, answerUsage) as never] })).id;
      await tx.appendEntry(source, { kind: ToolResultEntry.kind, model: [{ role: "toolResult", toolCallId: "c1", toolName: "read", content: [], timestamp: T2, usage: toolUsage } as never] });
      await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [{ ...assistant(T2, undatedUsage), timestamp: undefined } as never] });
      await recordUsage(tx, source, "models", "fixture/model-a", answerUsage);
      await recordUsage(tx, source, "models", "fixture/model-a", undatedUsage);
      await recordUsage(tx, source, "tools", "read", toolUsage);
      return { source, answer };
    }, durableContext);
    const fork = await harness.commit(async (tx) => {
      const fork = (await tx.forkConversation(source.source, source.answer, { ownership: { kind: "ownerless" } })).id;
      await tx.appendEntry(fork, { kind: AssistantEntry.kind, model: [assistant(T2, forkUsage) as never] });
      await recordUsage(tx, fork, "models", "fixture/model-a", forkUsage);
      return fork;
    }, durableContext);
    const quiet = await harness.commit(async (tx) => {
      const quiet = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
      await tx.appendEntry(quiet, { kind: AssistantEntry.kind, model: [assistant(T3, priced(4, 0, 4, 0.2)) as never] });
      return quiet;
    }, durableContext);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await harness.commit(async (tx) => {
        await tx.appendEntry(source.source, { kind: CompactionEntry.kind, data: { reason: "manual" }, model: [user(T2, "Summary of the work so far") as never] });
        await recordUsage(tx, source.source, "models", "fixture/model-a", summaryUsage);
      }, durableContext);
    }
    return { source: source.source, fork, quiet };
  })();

  const sessions = [
    record("fork", `durable:${fork}`, "2026-01-01T00:00:00.000Z", { parentId: "source" }),
    record("source", `durable:${source}`, "2026-01-02T00:00:00.000Z"),
    record("quiet", `durable:${quiet}`, "2026-01-03T00:00:00.000Z"),
    record("source-copy", `durable:${source}`, "2026-01-04T00:00:00.000Z"),
  ];
  const report = await readUsageReport(sessions, usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-30", timeZone: "UTC" })));

  expectSchema(UsageReport, report);
  assert.equal(report.coverage.readSessions, 3, "duplicate conversation references are read once");
  const owned = report.sessions.find((each) => each.id === "source-copy")!;
  assert.deepEqual(
    { totalTokens: owned.metrics.totalTokens, costUsd: owned.metrics.costUsd },
    { totalTokens: 22, costUsd: 0.6 },
    "the ranged totals still hold only dated entries, even with the fork registered first and an undated entry in the source",
  );
  assert.deepEqual(
    { totalTokens: report.sessions.find((each) => each.id === "fork")!.metrics.totalTokens, undated: report.coverage.undatedRecords },
    { totalTokens: 4, undated: 1 },
    "the fork keeps its own entry, and the undated entry is a stated gap rather than a 1970 day",
  );
  assert.equal(report.unplacedSpend.totalTokens, 2200,
    "both summarization calls count once each, and the undated entry is subtracted too");
  assert(Math.abs(report.unplacedSpend.costUsd - 6) < 1e-9, `cost ${report.unplacedSpend.costUsd}`);
  assert(report.unplacedSpend.costUsd < 6.001, "a ledger smaller than its entries never goes negative, so nothing is added back");

  const oneDay = await readUsageReport(sessions, usageQuery(new URLSearchParams({ from: "2026-06-03", to: "2026-06-03", timeZone: "UTC" })));
  assert.deepEqual(oneDay.unplacedSpend, report.unplacedSpend, "undated spend is not hidden or double counted by a narrower range");
  assert.deepEqual(oneDay.sessions.map((each) => each.id), [], "a range with no entry activity is empty, yet the undated spend still shows");
});

test("a ledger snapshot excludes concurrent replies, retains cost-only spend and reports failed reads", async () => {
  const initial = priced(10, 0, 10, 0.5);
  const later = priced(100, 0, 100, 1);
  const conversationId = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, initial) as never] });
    await recordUsage(tx, id, "models", "fixture/model-a", initial);
    await recordUsage(tx, id, "tools", "nested-model", priced(0, 0, 0, 0.25));
    return id;
  }, durableContext);
  const sessions = [record("active", `durable:${conversationId}`, "2026-01-01T00:00:00.000Z")];
  const query = usageQuery(new URLSearchParams({ timeZone: "UTC" }));
  const read = host.conversationUsage.bind(host);
  const concurrent = vi.spyOn(host, "conversationUsage").mockImplementation(async (id) => {
    const snapshot = await read(id);
    await harness.commit(async (tx) => {
      await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T2, later) as never] });
      await recordUsage(tx, id, "models", "fixture/model-a", later);
    }, durableContext);
    return snapshot;
  });
  try {
    const report = await readUsageReport(sessions, query);
    assert.equal(report.sessions[0]?.metrics.totalTokens, 10, "a reply arriving after the snapshot waits for the next report");
    assert.deepEqual(report.unplacedSpend, { totalTokens: 0, costUsd: 0.25 }, "cost need not have a token counter");
    expectSchema(UsageReport, report);
  } finally {
    concurrent.mockRestore();
  }
  const failed = vi.spyOn(host, "conversationUsage").mockRejectedValueOnce(new Error("interrupted ledger read"));
  try {
    const report = await readUsageReport(sessions, query);
    assert.deepEqual(report.coverage.unavailable, [{ sessionId: "active", reason: "The local conversation or its spend ledger could not be read." }]);
    assert.equal(report.coverage.readSessions, 0, "a failed snapshot never implies a fully read conversation");
  } finally {
    failed.mockRestore();
  }
  const refreshed = await readUsageReport(sessions, query);
  assert.equal(refreshed.sessions[0]?.metrics.totalTokens, 110, "the next report includes the concurrent reply");
  assert.deepEqual(refreshed.unplacedSpend, { totalTokens: 0, costUsd: 0.25 }, "ordinary reply spend never leaks into the remainder");
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
  let runStartedAt: string | undefined;
  const reports = new UsageReports(async () => sessions.map((session) => ({
    ...session,
    updatedAt: session.id === "cached" ? activity : new Date(T3).toISOString(),
    ...(runStartedAt === undefined ? {} : { runStartedAt }),
  })), async (given, timeZone, previous) => {
    reads += 1;
    return scanUsage(given, timeZone, previous);
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
  runStartedAt = activity;
  const [afterActivity, shared] = await Promise.all([reports.get(june), reports.get(juneFirst)]);
  assert.equal(reads, 3, "newer registry activity reads once, even for two requests at once");
  assert.equal(afterActivity.range.to, "2026-06-02");
  assert.equal(shared.sessions[0]?.metrics.calls, 1);

  await harness.commit(async (tx) => {
    await tx.appendEntry(conversation, { kind: AssistantEntry.kind, model: [assistant(T2, priced(4, 2, 6, 0.1)) as never] });
  }, durableContext);
  runStartedAt = undefined;
  const completed = await reports.get(june);
  assert.equal(completed.sessions[0]?.metrics.calls, 3, "a run completing after the previous scan includes its answer without changing its admission timestamp");
  assert.equal(reads, 4);
  await reports.get(juneFirst);
  assert.equal(reads, 4, "unchanged reads reuse the completed run's scan");

  const steady = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(1, 1, 2, 0.1)) as never] });
    return id;
  }, durableContext);
  sessions.push(record("steady", `durable:${steady}`, new Date(T1).toISOString()));
  assert.equal((await reports.get(june)).sessions.length, 2);
  assert.equal(reads, 5, "a session joining the registry reads the histories again");

  await harness.commit(async (tx) => {
    await tx.appendEntry(conversation, { kind: AssistantEntry.kind, model: [assistant(T3, priced(4, 4, 8, 0.4)) as never] });
  }, durableContext);
  activity = new Date(T2 + 3_600_000).toISOString();
  const later = await reports.get(june);
  assert.equal(reads, 6, "activity in a session older than the newest registry clock still reads the histories");
  assert.equal(later.sessions.find((each) => each.id === "cached")?.metrics.calls, 4);
});

test("settling a turn invalidates an early usage read without rescanning unchanged ranges", async () => {
  const { UsageReports } = await import("./usage.ts");
  const initial = priced(10, 5, 20, 0.5);
  const later = priced(10, 5, 20, 0.25);
  const conversation = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, initial) as never] });
    await recordUsage(tx, id, "models", "fixture/model-a", initial);
    return id;
  }, durableContext);
  let session = record("settled", `durable:${conversation}`, new Date(T1).toISOString(), {
    updatedAt: new Date(T2).toISOString(), runStartedAt: new Date(T2).toISOString(),
  });
  let reads = 0;
  const reports = new UsageReports(async () => [session], async (given, timeZone, previous) => {
    reads += 1;
    return scanUsage(given, timeZone, previous);
  });
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  assert.equal((await reports.get(june)).sessions[0]?.metrics.calls, 1);
  await harness.commit(async (tx) => {
    await tx.appendEntry(conversation, { kind: AssistantEntry.kind, model: [assistant(T2, later) as never] });
    await recordUsage(tx, conversation, "models", "fixture/model-a", later);
  }, durableContext);
  session = { ...session, runStartedAt: undefined };
  const settled = await reports.get(june);
  assert.equal(settled.sessions[0]?.metrics.calls, 2);
  assert.equal(settled.sessions[0]?.metrics.costUsd, 0.75);
  assert.equal(reads, 2, "clearing the run marker refreshes the early scan once");
  const firstDay = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-01", timeZone: "UTC" }));
  assert.equal((await reports.get(firstDay)).sessions[0]?.metrics.calls, 1);
  await reports.get(june);
  assert.equal(reads, 2, "unchanged reads and range changes reuse the settled scan");
});

test("a session that leaves the registry stops being reported", async () => {
  const { UsageReports } = await import("./usage.ts");
  const seed = (title: string) => harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(4, 2, 6, 0.1), "stop") as never] });
    return record(title, `durable:${id}`, new Date(T1).toISOString());
  }, durableContext);
  const kept = await seed("kept");
  const dropped = await seed("dropped");
  let records: SessionRecord[] = [kept, dropped];
  const reports = new UsageReports(async () => records);
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));

  await reports.get(june);

  const replacement = await seed("replacement");
  records = [kept, replacement];
  assert.deepEqual((await reports.get(june)).sessions.map(({ id }) => id), ["kept", "replacement"],
    "one session replacing another under the same count and clock is reported, and the one it replaced is gone");

  records = [kept];
  assert.deepEqual((await reports.get(june)).sessions.map(({ id }) => id), ["kept"]);
});

test("a later pass reads only newer entries and a fork made afterwards still counts its history once", async () => {
  const { scanUsage, sliceUsage } = await import("./usage.ts");
  const initial = priced(10, 5, 20, 0.5);
  const later = priced(10, 5, 20, 0.25);
  const inherited = priced(7, 3, 10, 0.25);
  const { source, answer } = await harness.commit(async (tx) => {
    const source = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    const answer = (await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T1, initial) as never] })).id;
    await recordUsage(tx, source, "models", "fixture/model-a", initial);
    await recordUsage(tx, source, "tools", "nested-model", priced(0, 0, 0, 0.25));
    return { source, answer };
  }, durableContext);
  const sessions = [record("incremental", `durable:${source}`, new Date(T1).toISOString())];
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  const calls = (scan: Awaited<ReturnType<typeof scanUsage>>, id = "incremental") => sliceUsage(scan, june).sessions.find((each) => each.id === id)?.metrics.calls;

  const first = await scanUsage(sessions, "UTC");
  const original = sliceUsage(first, june);
  assert.equal(calls(first), 1);
  assert.deepEqual(sliceUsage(first, june).unplacedSpend, { totalTokens: 0, costUsd: 0.25 });

  await harness.commit(async (tx) => {
    await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T1 + 60_000, later) as never] });
    await recordUsage(tx, source, "models", "fixture/model-a", later);
  }, durableContext);
  const second = await scanUsage(sessions, "UTC", first);
  assert.equal(calls(second), 2, "the new entry joins the one already counted");
  assert.equal(original.sessions[0]?.days[0]?.metrics.calls, 1, "an earlier report owns its day counters rather than sharing the mutable cache");
  assert.equal(sliceUsage(second, june).sessions[0]?.metrics.costUsd, 0.75);
  assert.deepEqual(sliceUsage(second, june).unplacedSpend, { totalTokens: 0, costUsd: 0.25 }, "a later scan subtracts previously counted entry spend too");

  const fork = await harness.commit(async (tx) => {
    const id = (await tx.forkConversation(source, answer, { ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T2, inherited) as never] });
    await recordUsage(tx, id, "models", "fixture/model-a", inherited);
    return id;
  }, durableContext);
  const withFork = [sessions[0]!, record("forked", `durable:${fork}`, new Date(T2).toISOString(), { parentId: "incremental" })];
  const third = await scanUsage(withFork, "UTC", second);
  const callsOf = (id: string) => sliceUsage(third, june).sessions.find((each) => each.id === id)?.metrics.calls;
  assert.equal(callsOf("forked"), 1, "the fork counts only the entry it added, not its inherited history");
  assert.equal(callsOf("incremental"), 2);
  assert.equal(sliceUsage(third, june).sessions.reduce((sum, each) => sum + (each.metrics.calls ?? 0), 0), 3);

  const again = await scanUsage(withFork, "UTC", third);
  assert.equal(calls(again), 2, "a pass with nothing new changes nothing");
  assert.equal(calls(again, "forked"), 1);
  assert.deepEqual(sliceUsage(again, june).unplacedSpend, { totalTokens: 0, costUsd: 0.25 }, "a fork and an unchanged scan never add inherited spend again");

  await harness.commit(async (tx) => {
    await recordUsage(tx, source, "models", "fixture/model-a", priced(100, 0, 100, 0.5));
  }, durableContext);
  const summarized = await scanUsage(withFork, "UTC", again);
  assert.deepEqual(sliceUsage(summarized, june).unplacedSpend, { totalTokens: 100, costUsd: 0.75 }, "ledger-only spend updates even without a newer entry");
  assert.equal(calls(summarized), 2, "ledger-only spend stays out of the dated totals");
  assert.deepEqual((await readUsageReport(withFork, june)).unplacedSpend, sliceUsage(summarized, june).unplacedSpend, "a full read and an incremental read agree");
});

test("a session that joins the registry is read without reading older entry payloads again", async () => {
  const { UsageReports, scanUsage } = await import("./usage.ts");
  const olderUsage = priced(10, 5, 20, 0.5);
  const newerUsage = priced(6, 2, 8, 0.25);
  const { older, newer } = await harness.commit(async (tx) => {
    const older = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(older, { kind: UserEntry.kind, model: [user(T1, "first") as never] });
    await tx.appendEntry(older, { kind: AssistantEntry.kind, model: [assistant(T1, olderUsage) as never] });
    await recordUsage(tx, older, "models", "fixture/model-a", olderUsage);
    await recordUsage(tx, older, "models", "fixture/model-a", priced(100, 0, 100, 1));
    const newer = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(newer, { kind: AssistantEntry.kind, model: [assistant(T2, newerUsage) as never] });
    await recordUsage(tx, newer, "models", "fixture/model-a", newerUsage);
    return { older, newer };
  }, durableContext);

  const olderRecord = record("older", `durable:${older}`, new Date(T1 - DAY).toISOString());
  const newerRecord = record("newer", `durable:${newer}`, new Date(T2).toISOString());
  let registry = [olderRecord];
  const reports = new UsageReports(async () => registry);
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  const reads = watchEntryReads();
  try {
    const before = await reports.get(june);
    assert.equal(reads.payloads.get(older), 2, "the two recorded entries are read once");
    assert.deepEqual(sessionTotals(before), [["older", 20, 0.5]]);
    assert.deepEqual(before.unplacedSpend, { totalTokens: 100, costUsd: 1 }, "spend the store keeps outside the entries sits beside the totals");

    registry = [olderRecord, newerRecord];
    const after = await reports.get(june);
    assert.equal(reads.payloads.get(older), 2, "the entries already counted are not read again");
    assert.equal(reads.payloads.get(newer), 1, "the new session's entry is read");
    assert.deepEqual(sessionTotals(after), [["newer", 8, 0.25], ["older", 20, 0.5]]);
    assert.deepEqual(after.coverage, { registeredSessions: 2, readSessions: 2, unavailable: [], undatedRecords: 0 });
    assert.deepEqual(after.unplacedSpend, { totalTokens: 100, costUsd: 1 }, "the remainder the older conversation contributed stays");

    const baseline = sliceUsage(await scanUsage(registry, "UTC"), june);
    assert.deepEqual(after.sessions, baseline.sessions, "a reused read answers what a full read would");
    assert.deepEqual(after.coverage, baseline.coverage);
  } finally {
    reads.restore();
  }
});

test("a cached scan rereads when a later record changes which registered conversation owns shared history", async () => {
  const { UsageReports, scanUsage } = await import("./usage.ts");
  const shared = priced(7, 3, 10, 0.25);
  const own = priced(2, 1, 3, 0.05);
  const { source, answer } = await harness.commit(async (tx) => {
    const source = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    const answer = (await tx.appendEntry(source, { kind: AssistantEntry.kind, model: [assistant(T1, shared) as never] })).id;
    return { source, answer };
  }, durableContext);
  const fork = await harness.commit(async (tx) => {
    const fork = (await tx.forkConversation(source, answer, { ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(fork, { kind: AssistantEntry.kind, model: [assistant(T2, own) as never] });
    return fork;
  }, durableContext);

  const forkRecord = record("fork", `durable:${fork}`, new Date(T1 - 2 * DAY).toISOString(), { parentId: "source" });
  const sourceRecord = record("source", `durable:${source}`, new Date(T1 - DAY).toISOString());
  let registry: SessionRecord[] = [forkRecord];
  const reports = new UsageReports(async () => registry);
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  const agreesWithAFullRead = async (report: UsageReport) => {
    const baseline = sliceUsage(await scanUsage(registry, "UTC"), june);
    assert.deepEqual({ sessions: report.sessions, coverage: report.coverage, unplacedSpend: report.unplacedSpend },
      { sessions: baseline.sessions, coverage: baseline.coverage, unplacedSpend: baseline.unplacedSpend }, "the cached report matches a full read of the same registry");
  };

  const alone = await reports.get(june);
  assert.deepEqual(sessionTotals(alone), [["fork", 13, 0.3]], "while its source is unregistered, a fork holds the history it inherited");
  await agreesWithAFullRead(alone);

  registry = [forkRecord, sourceRecord];
  const owned = await reports.get(june);
  assert.deepEqual(sessionTotals(owned), [["fork", 3, 0.05], ["source", 10, 0.25]],
    "registering the source moves the inherited entry to the conversation that owns it, and never counts it twice");
  await agreesWithAFullRead(owned);

  const reads = watchEntryReads();
  try {
    forkRecord.updatedAt = new Date(T3).toISOString();
    await reports.get(june);
    assert.equal(reads.payloads.get(source) ?? 0, 0, "entries counted through a fork also advance the source's completed read boundary");
  } finally {
    reads.restore();
  }

  const copyRecord = record("source-copy", `durable:${source}`, new Date(T1).toISOString());
  registry = [forkRecord, sourceRecord, copyRecord];
  const copied = await reports.get(june);
  assert.deepEqual(sessionTotals(copied), [["fork", 3, 0.05], ["source-copy", 10, 0.25]],
    "a second record for a counted conversation takes its entries over without counting them twice");
  await agreesWithAFullRead(copied);

  registry = [forkRecord, { ...sourceRecord, worker: "w1" }];
  const remote = await reports.get(june);
  assert.deepEqual(sessionTotals(remote), [["fork", 13, 0.3]], "a source that moves to a remote worker stops being read, so the fork holds its history again");
  await agreesWithAFullRead(remote);

  forkRecord.title = "Renamed fork";
  forkRecord.parentId = "updated-parent";
  const renamed = await reports.get(june);
  assert.equal(renamed.sessions[0]?.title, "Renamed fork", "visible metadata changes without a newer activity clock");
  assert.equal(renamed.sessions[0]?.parentId, "updated-parent");
  forkRecord.piSessionFile = `durable:${source}`;
  const changed = await reports.get(june);
  assert.deepEqual(sessionTotals(changed), [["fork", 10, 0.25]], "a changed source replaces the old history even when the caller mutates its record in place");
  await agreesWithAFullRead(changed);
});

test("an earlier or reordered claimant replaces the fallback owner of inherited history", async () => {
  const { UsageReports } = await import("./usage.ts");
  const source = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    const head = (await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(10, 0, 10, 0.5)) as never] })).id;
    return { id, head };
  }, durableContext);
  const seedFork = (tokens: number) => harness.commit(async (tx) => {
    const id = (await tx.forkConversation(source.id, source.head, { ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T2, priced(tokens, 0, tokens, 0)) as never] });
    return id;
  }, durableContext);
  const later = record("later", `durable:${await seedFork(2)}`, new Date(T2).toISOString());
  const earlier = record("earlier", `durable:${await seedFork(3)}`, new Date(T1).toISOString());
  let registry = [later];
  const reports = new UsageReports(async () => registry);
  const query = usageQuery(new URLSearchParams({ timeZone: "UTC" }));
  const totals = async () => (await reports.get(query)).sessions.map((row) => [row.id, row.metrics.totalTokens]).toSorted();
  assert.deepEqual(await totals(), [["later", 12]]);
  registry = [later, earlier];
  assert.deepEqual(await totals(), [["earlier", 13], ["later", 2]], "a newly registered older claimant receives the inherited entries");
  later.createdAt = earlier.createdAt;
  assert.deepEqual(await totals(), [["earlier", 3], ["later", 12]], "equal creation times use registry order");
  registry = [earlier, later];
  assert.deepEqual(await totals(), [["earlier", 13], ["later", 2]], "reordering tied claimants recomputes attribution");
});

test("a pending scan never answers for a different registry snapshot", async () => {
  const { UsageReports } = await import("./usage.ts");
  const seed = (title: string) => harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(1, 0, 1, 0)) as never] });
    return record(title, `durable:${id}`, new Date(T1).toISOString());
  }, durableContext);
  const firstRecord = await seed("before");
  const nextRecord = await seed("after");
  let registry = [firstRecord];
  const entered = deferred();
  const release = deferred();
  let reads = 0;
  const reports = new UsageReports(async () => registry, async (given, timeZone, previous) => {
    if (++reads === 1) { entered.resolve(); await release.promise; }
    return scanUsage(given, timeZone, previous);
  });
  const query = usageQuery(new URLSearchParams({ timeZone: "UTC" }));
  const first = reports.get(query);
  await entered.promise;
  registry = [nextRecord];
  const next = reports.get(query);
  release.resolve();
  const [before, after] = await Promise.all([first, next]);
  assert.deepEqual(before.sessions.map(({ id }) => id), ["before"]);
  assert.deepEqual(after.sessions.map(({ id }) => id), ["after"], "the second request waits and scans its own registered histories");
});

test("a repeated, emptied or interrupted read never doubles the totals or keeps a stale row", async () => {
  const { scanUsage, sliceUsage } = await import("./usage.ts");
  const june = usageQuery(new URLSearchParams({ from: "2026-06-01", to: "2026-06-02", timeZone: "UTC" }));
  const dir = join(root, "legacy-repeat");
  await mkdir(dir, { recursive: true });
  const transcript = join(dir, "repeat.jsonl");
  const write = (records: unknown[]) => writeFile(transcript, records.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const message = (usage: unknown, timestamp?: number) => ({ type: "message", message: { role: "assistant", provider: "fixture", model: "model-b", content: [], usage, ...(timestamp === undefined ? {} : { timestamp }) } });
  await write([message(priced(1, 0, 1, 0), T1), message(unpriced(1, 0, 1))]);

  const conversation = await harness.commit(async (tx) => {
    const id = (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
    for (let index = 0; index < 10; index += 1) {
      await tx.appendEntry(id, { kind: AssistantEntry.kind, model: [assistant(T1, priced(1, 0, 1, 0)) as never] });
    }
    return id;
  }, durableContext);
  const sessions = [
    record("legacy", transcript, new Date(T1 - DAY).toISOString()),
    record("durable", `durable:${conversation}`, new Date(T1).toISOString()),
  ];
  const counted = (scan: Awaited<ReturnType<typeof scanUsage>>) => {
    const report = sliceUsage(scan, june);
    return {
      undated: report.coverage.undatedRecords,
      calls: report.sessions.reduce((sum, each) => sum + each.metrics.calls, 0),
      rows: report.sessions.map((each) => each.id).toSorted(),
    };
  };

  const first = await scanUsage(sessions, "UTC");
  assert.deepEqual(counted(first), { undated: 1, calls: 11, rows: ["durable", "legacy"] });

  const repeated = await scanUsage(sessions, "UTC", first);
  const repeatedCounts = counted(repeated);

  await rm(transcript);
  const emptied = await scanUsage(sessions, "UTC", repeated);
  const emptiedCounts = counted(emptied);
  assert.deepEqual(sliceUsage(emptied, june).coverage.unavailable, [{ sessionId: "legacy", reason: "The transcript is unavailable." }]);

  await harness.commit(async (tx) => {
    for (let index = 0; index < 201; index += 1) {
      await tx.appendEntry(conversation, { kind: AssistantEntry.kind, model: [assistant(T2, priced(1, 0, 1, 0)) as never] });
    }
  }, durableContext);

  const real = harness.conversation.bind(harness);
  let pages = 0;
  const interrupted = vi.spyOn(harness, "conversation").mockImplementation(async (id, context) => {
    const opened = await real(id, context);
    if (!opened || id !== conversation) return opened;
    const entries = opened.entries.bind(opened);
    opened.entries = (...args) => {
      pages += 1;
      return pages === 2 ? Promise.reject(new Error("the second page was interrupted")) : entries(...args);
    };
    return opened;
  });
  const partial = await scanUsage(sessions, "UTC", emptied).finally(() => interrupted.mockRestore());
  assert.equal(pages, 2, "the interrupted pass read one page and failed on the next");
  assert.deepEqual(sliceUsage(partial, june).coverage.unavailable, [
    { sessionId: "durable", reason: "The local conversation or its spend ledger could not be read." },
    { sessionId: "legacy", reason: "The transcript is unavailable." },
  ], "a pass that could not read every page claims no complete conversation");

  const partialCounts = counted(partial);
  const retried = await scanUsage(sessions, "UTC", partial);
  assert.deepEqual({ repeated: repeatedCounts, emptied: emptiedCounts, partial: partialCounts, retried: counted(retried) }, {
    repeated: { undated: 1, calls: 11, rows: ["durable", "legacy"] },
    emptied: { undated: 0, calls: 10, rows: ["durable"] },
    partial: { undated: 0, calls: 10, rows: ["durable"] },
    retried: { undated: 0, calls: 211, rows: ["durable"] },
  }, "repeated legacy records replace their counts, missing files clear them, and an interrupted page never commits half a conversation");
});

test("Refresh during an incremental scan waits for a full read shared by concurrent refreshes", async () => {
  const { UsageReports } = await import("./usage.ts");
  const conversation = await harness.commit(async (tx) => (await tx.createConversation({ ownership: { kind: "ownerless" } })).id, durableContext);
  const session = record("refresh-race", `durable:${conversation}`, new Date(T1).toISOString());
  let activity = session.updatedAt;
  let pauseNext = false;
  const started = deferred();
  const barrier = deferred();
  const reads: string[] = [];
  const reports = new UsageReports(async () => [{ ...session, updatedAt: activity }], async (given, timeZone, previous) => {
    reads.push(previous ? "incremental" : "full");
    if (pauseNext) {
      pauseNext = false;
      started.resolve();
      await barrier.promise;
    }
    return scanUsage(given, timeZone, previous);
  });
  const query = usageQuery(new URLSearchParams({ timeZone: "UTC" }));
  await reports.get(query);
  activity = new Date(T2).toISOString();
  pauseNext = true;
  const incremental = reports.get(query);
  await started.promise;
  const first = reports.get(query, true);
  const second = reports.get(query, true);
  barrier.resolve();
  await Promise.all([incremental, first, second]);
  assert.deepEqual(reads, ["full", "incremental", "full"], "an in-flight incremental scan cannot consume Refresh, and the full refresh is shared");
});
