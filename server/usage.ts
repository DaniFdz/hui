/**
 * The Usage page's report: tokens, recorded PI cost estimates and message
 * counts read from the current histories of the registered local sessions,
 * bucketed into calendar days of one time zone.
 *
 * Durable conversations are read page by page, read-only, through the entries
 * HUI already views; a fork inherits its source's entries under the same entry
 * IDs, so an ID counts once globally and is attributed to the registered
 * conversation that owns it. Legacy PI transcripts are read from the file the
 * registry names, bounded and only for their own path. Durable's ledger also
 * records compaction summaries, tool-side model calls and imported history
 * outside the entries. That remainder is reported beside the dated totals,
 * without inventing dates. A ledger and its entry boundary are read together
 * so a concurrent reply cannot inflate the remainder. Nothing is persisted,
 * and provider billing stays outside this report.
 *
 * One scan is range-independent: it buckets every recorded day, so any range,
 * zone or filter is answered by slicing it. The gateway keeps that scan per
 * time zone and, once the registry records newer activity, reads only the
 * entries appended since it read the conversation last.
 */
import { readFile, stat } from "node:fs/promises";

import { CompactionEntry, type ConversationId, type EntryId } from "@earendil-works/pi-durable";
import type { UsageDay, UsageMetrics, UsageModel, UsageReport, UsageSession, UsageTool } from "./api/diagnostics.ts";
import { durableContext, durableHost } from "./runtimes/durable-host.ts";
import { durableConversationId } from "./runtimes/durable.ts";
import type { SessionRecord } from "./sessions/sessions.ts";

const PAGE = 200;
const LINES_PER_YIELD = 1000;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_LABEL = 160;
const MAX_RANGE_DAYS = 366;
const MAX_TIME = 8.64e15;
const DAY_MS = 86_400_000;
const UNKNOWN = "Unknown";

export class UsageQueryError extends Error {}

export type UsageQuery = { timeZone: string } & ({ kind: "all" } | { kind: "custom"; from: string; to: string });

type StoredMessage = {
  readonly role?: unknown;
  readonly timestamp?: unknown;
  readonly provider?: unknown;
  readonly model?: unknown;
  readonly usage?: unknown;
  readonly stopReason?: unknown;
  readonly isError?: unknown;
  readonly toolName?: unknown;
};

type StoredEntry = {
  readonly id: number;
  readonly conversationId: number;
  readonly kind: string;
  readonly model?: readonly StoredMessage[];
};

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number | null };

type Spend = { totalTokens: number; cost: number };

type UsageLabel = { provider: string; model: string };

type UsageEvent = {
  role: "user" | "assistant" | "toolResult" | "usage";
  time: number | undefined;
  usage?: Usage;
  label?: UsageLabel;
  tool?: string;
  isError?: boolean;
};

type DayBucket = {
  metrics: UsageMetrics;
  lastActivityAt: number;
  models: Map<string, UsageModel>;
  tools: Map<string, UsageTool>;
};

/** One pass over every registered history, bucketed by day and independent of the range a request asks for. */
export type UsageScan = {
  sessions: Map<string, { session: SessionRecord; days: Map<string, DayBucket> }>;
  /** Highest entry ID already counted per conversation, so a later pass reads only newer entries. */
  marks: Map<number, number>;
  /** Entry IDs already counted anywhere, so history a fork inherits counts once. */
  claimed: Set<number>;
  recordedSpend: Map<number, Spend>;
  unplacedSpend: UsageReport["unplacedSpend"];
  registeredSessions: number;
  undatedRecords: number;
  unavailable: { sessionId: string; reason: string }[];
  readSessions: number;
};

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function label(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_LABEL) : UNKNOWN;
}

function stampOf(value: unknown): number | undefined {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 && time <= MAX_TIME ? time : undefined;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function readUsage(raw: unknown): Usage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const usage = raw as Record<string, unknown>;
  const input = count(usage["input"]) ?? count(usage["inputTokens"]) ?? count(usage["input_tokens"]) ?? 0;
  const output = count(usage["output"]) ?? count(usage["outputTokens"]) ?? count(usage["output_tokens"]) ?? 0;
  const cacheRead = count(usage["cacheRead"]) ?? count(usage["cacheReadTokens"]) ?? count(usage["cache_read_input_tokens"]) ?? 0;
  const cacheWrite = count(usage["cacheWrite"]) ?? count(usage["cacheWriteTokens"]) ?? count(usage["cache_creation_input_tokens"]) ?? 0;
  const recorded = count(usage["total"]) ?? count(usage["totalTokens"]) ?? count(usage["total_tokens"]);
  const cost = usage["cost"];
  const parts = typeof cost === "object" && cost !== null ? (cost as Record<string, unknown>) : undefined;
  const priced = parts
    ? count(parts["total"]) ?? count(parts["usd"]) ?? count(parts["totalCost"])
    : count(cost) ?? count(usage["totalCost"]) ?? count(usage["costUsd"]) ?? count(usage["cost_usd"]);
  return {
    input, output, cacheRead, cacheWrite,
    totalTokens: recorded ?? input + output + cacheRead + cacheWrite,
    cost: priced ?? null,
  };
}

function emptyMetrics(): UsageMetrics {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    costUsd: null, unpricedCalls: 0, calls: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, errors: 0,
  };
}

function sumOf(rows: readonly UsageMetrics[]): UsageMetrics {
  const total = emptyMetrics();
  for (const row of rows) addMetrics(total, row);
  return total;
}

function addMetrics(target: UsageMetrics, row: UsageMetrics): void {
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "unpricedCalls", "calls", "userMessages", "assistantMessages", "toolResults", "errors"] as const) {
    target[key] += row[key];
  }
  if (row.costUsd !== null) target.costUsd = (target.costUsd ?? 0) + row.costUsd;
}

function addEvent(target: UsageMetrics, event: UsageEvent): void {
  if (event.role === "user") target.userMessages += 1;
  if (event.role === "assistant") target.assistantMessages += 1;
  if (event.role === "toolResult") target.toolResults += 1;
  if (event.isError) target.errors += 1;
  const usage = event.usage;
  if (!usage) return;
  target.calls += 1;
  target.inputTokens += usage.input;
  target.outputTokens += usage.output;
  target.cacheReadTokens += usage.cacheRead;
  target.cacheWriteTokens += usage.cacheWrite;
  target.totalTokens += usage.totalTokens;
  if (usage.cost === null) target.unpricedCalls += 1;
  else target.costUsd = (target.costUsd ?? 0) + usage.cost;
}

function messageEvent(message: StoredMessage, time = stampOf(message.timestamp)): UsageEvent | undefined {
  if (message.role === "user") return { role: "user", time };
  if (message.role === "assistant") {
    return {
      role: "assistant", time, usage: readUsage(message.usage), isError: message.stopReason === "error",
      label: { provider: label(message.provider), model: label(message.model) },
    };
  }
  if (message.role === "toolResult") {
    return { role: "toolResult", time, usage: readUsage(message.usage), isError: message.isError === true, tool: label(message.toolName) };
  }
  return undefined;
}

function legacyEvent(record: Record<string, unknown>): UsageEvent | undefined {
  const message = typeof record["message"] === "object" && record["message"] !== null
    ? record["message"] as Record<string, unknown>
    : undefined;
  const time = stampOf(message?.["timestamp"]) ?? stampOf(record["timestamp"]);
  const event = message ? messageEvent(message, time) : undefined;
  if (event) return event;
  const usage = readUsage(record["usage"]);
  if (!usage) return undefined;
  return { role: "usage", time, usage, label: { provider: label(record["provider"]), model: label(record["model"]) } };
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function dayValue(day: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const value = Date.UTC(year, month - 1, date);
  const written = new Date(value);
  return written.getUTCFullYear() === year && written.getUTCMonth() === month - 1 && written.getUTCDate() === date ? value : undefined;
}

export function usageQuery(params: URLSearchParams): UsageQuery {
  const timeZone = params.get("timeZone")?.trim() || "UTC";
  if (!isTimeZone(timeZone)) throw new UsageQueryError("timeZone is not a known IANA time zone.");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!from && !to) return { kind: "all", timeZone };
  if (!from || !to) throw new UsageQueryError("from and to are given together.");
  const first = dayValue(from);
  const last = dayValue(to);
  if (first === undefined || last === undefined) throw new UsageQueryError("from and to are calendar days, YYYY-MM-DD.");
  const days = (last - first) / DAY_MS + 1;
  if (days < 1) throw new UsageQueryError("to is before from.");
  if (days > MAX_RANGE_DAYS) throw new UsageQueryError(`A range covers at most ${MAX_RANGE_DAYS} calendar days.`);
  return { kind: "custom", from, to, timeZone };
}

function dayReader(timeZone: string): (time: number) => string {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (time) => {
    const parts = format.formatToParts(new Date(time));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

function spendOf(buckets: readonly (Record<string, Record<string, unknown>> | undefined)[]): Spend {
  let totalTokens = 0;
  let cost = 0;
  for (const bucket of buckets) {
    for (const entry of Object.values(bucket ?? {})) {
      totalTokens += count(entry["totalTokens"]) ?? 0;
      const parts = typeof entry["cost"] === "object" && entry["cost"] !== null ? entry["cost"] as Record<string, unknown> : undefined;
      cost += parts ? count(parts["total"]) ?? 0 : 0;
    }
  }
  return { totalTokens, cost };
}

function entrySpend(entry: StoredEntry): Spend {
  let totalTokens = 0;
  let cost = 0;
  for (const message of entry.model ?? []) {
    const usage = readUsage(message.usage);
    if (!usage) continue;
    totalTokens += usage.totalTokens;
    cost += usage.cost ?? 0;
  }
  return { totalTokens, cost };
}

function durableScan(): (conversationId: number, lastEntryId: EntryId | null, after: number | undefined) => AsyncIterable<StoredEntry> {
  return async function* (conversationId, lastEntryId, after) {
    if (lastEntryId === null) return;
    const harness = await durableHost().open();
    const conversation = await harness.conversation(conversationId as ConversationId, durableContext);
    if (!conversation) throw new Error("That conversation is not in this gateway's Durable store.");
    let cursor;
    do {
      const page = await conversation.entries({ maxEntryId: lastEntryId, ...(after === undefined ? {} : { minEntryId: after as EntryId }) }, PAGE, cursor, durableContext);
      yield* page.items;
      cursor = page.next;
      await yieldToEventLoop();
    } while (cursor);
  };
}

export async function scanUsage(sessions: readonly SessionRecord[], timeZone: string, previous?: UsageScan): Promise<UsageScan> {
  const scan = durableScan();
  const dayOf = dayReader(timeZone);
  const found: UsageScan = {
    sessions: new Map(), marks: new Map(previous?.marks ?? []), claimed: previous?.claimed ?? new Set(),
    recordedSpend: new Map(previous?.recordedSpend), unplacedSpend: { totalTokens: 0, costUsd: 0 },
    registeredSessions: sessions.length, undatedRecords: 0, unavailable: [], readSessions: 0,
  };
  /** Sessions whose buckets in this pass replace the cached ones instead of adding to them. */
  const replaced = new Set<string>();

  const accept = (session: SessionRecord, event: UsageEvent): void => {
    if (event.time === undefined) {
      found.undatedRecords += 1;
      return;
    }
    const day = dayOf(event.time);
    let sessionUsage = found.sessions.get(session.id);
    if (!sessionUsage) found.sessions.set(session.id, sessionUsage = { session, days: new Map() });
    let bucket = sessionUsage.days.get(day);
    if (!bucket) sessionUsage.days.set(day, bucket = { metrics: emptyMetrics(), lastActivityAt: 0, models: new Map(), tools: new Map() });
    addEvent(bucket.metrics, event);
    bucket.lastActivityAt = Math.max(bucket.lastActivityAt, event.time);
    const eventLabel = event.label;
    if (event.usage && eventLabel) {
      const key = `${eventLabel.provider}\u0000${eventLabel.model}`;
      let model = bucket.models.get(key);
      if (!model) bucket.models.set(key, model = { provider: eventLabel.provider, model: eventLabel.model, metrics: emptyMetrics() });
      addEvent(model.metrics, event);
    }
    if (event.tool) {
      const tool = bucket.tools.get(event.tool) ?? { name: event.tool, calls: 0, errors: 0 };
      bucket.tools.set(event.tool, tool);
      tool.calls += 1;
      if (event.isError) tool.errors += 1;
    }
  };

  const ordered = sessions.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const owners = new Map<number, SessionRecord>();
  for (const session of ordered) {
    if (session.worker) continue;
    const conversationId = durableConversationId(session.piSessionFile);
    if (conversationId !== undefined) owners.set(conversationId, session);
  }

  const readPaths = new Set<string>();
  const ledgers = new Map<number, Spend>();
  const readConversations = new Set<number>();

  for (const session of ordered) {
    const reference = session.piSessionFile;
    if (session.worker) {
      found.unavailable.push({ sessionId: session.id, reason: "The transcript lives on a remote worker and is not read here." });
      continue;
    }
    if (!reference) continue;

    const conversationId = durableConversationId(reference);
    if (conversationId !== undefined) {
      if (readConversations.has(conversationId)) continue;
      readConversations.add(conversationId);
      const after = previous?.marks.get(conversationId);
      const counted = new Set<number>();
      const spent = new Map<number, Spend>();
      let highest = after;
      try {
        await durableHost().open();
        const ledger = await durableHost().conversationUsage(conversationId as ConversationId);
        if (!ledger) throw new Error("The local spend ledger is unavailable.");
        for await (const entry of scan(conversationId, ledger.lastEntryId, after === undefined ? undefined : after + 1)) {
          if (after !== undefined && entry.id <= after) continue;
          if (found.claimed.has(entry.id) || counted.has(entry.id)) continue;
          counted.add(entry.id);
          highest = Math.max(highest ?? 0, entry.id);
          const spend = entrySpend(entry);
          const already = spent.get(entry.conversationId);
          spent.set(entry.conversationId, {
            totalTokens: (already?.totalTokens ?? 0) + spend.totalTokens,
            cost: (already?.cost ?? 0) + spend.cost,
          });
          const owner = owners.get(entry.conversationId) ?? session;
          for (const message of entry.model ?? []) {
            if (entry.kind === CompactionEntry.kind && message.role === "user") continue;
            const event = messageEvent(message);
            if (event) accept(owner, event);
          }
        }
        for (const [owner, spend] of spent) {
          const already = found.recordedSpend.get(owner);
          found.recordedSpend.set(owner, { totalTokens: (already?.totalTokens ?? 0) + spend.totalTokens, cost: (already?.cost ?? 0) + spend.cost });
        }
        for (const id of counted) found.claimed.add(id);
        if (highest !== undefined) found.marks.set(conversationId, highest);
        found.readSessions += 1;
        ledgers.set(conversationId, spendOf([ledger.models, ledger.tools]));
      } catch {
        found.unavailable.push({ sessionId: session.id, reason: "The local conversation or its spend ledger could not be read." });
      }
      continue;
    }

    if (readPaths.has(reference)) continue;
    readPaths.add(reference);
    replaced.add(session.id);
    try {
      const info = await stat(reference);
      if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) {
        found.unavailable.push({ sessionId: session.id, reason: "The transcript is too large or unavailable." });
        continue;
      }
      const source = await readFile(reference, "utf8");
      if (Buffer.byteLength(source) > MAX_TRANSCRIPT_BYTES) {
        found.unavailable.push({ sessionId: session.id, reason: "The transcript is too large or unavailable." });
        continue;
      }
      found.readSessions += 1;
      let malformed = false;
      let lines = 0;
      for (const line of source.split("\n")) {
        if (lines > 0 && lines % LINES_PER_YIELD === 0) await yieldToEventLoop();
        lines += 1;
        if (!line.trim()) continue;
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          malformed = true;
          continue;
        }
        if (typeof record !== "object" || record === null) continue;
        const event = legacyEvent(record as Record<string, unknown>);
        if (event) accept(session, event);
      }
      if (malformed) found.unavailable.push({ sessionId: session.id, reason: "Some transcript records could not be read." });
    } catch {
      found.unavailable.push({ sessionId: session.id, reason: "The transcript is unavailable." });
    }
  }

  for (const [conversationId, ledger] of ledgers) {
    const entries = found.recordedSpend.get(conversationId);
    found.unplacedSpend.totalTokens += Math.max(0, ledger.totalTokens - (entries?.totalTokens ?? 0));
    found.unplacedSpend.costUsd += Math.max(0, ledger.cost - (entries?.cost ?? 0));
  }

  if (!previous) return found;
  mergeScan(previous, found, replaced);
  return previous;
}

/** Adds a later pass into the scan held in memory, which no other code mutates while this runs. */
function mergeScan(target: UsageScan, delta: UsageScan, replaced: ReadonlySet<string>): void {
  for (const [id, incoming] of delta.sessions) {
    const held = target.sessions.get(id);
    const sessionUsage = { session: held?.session ?? incoming.session, days: replaced.has(id) ? new Map() : new Map(held?.days) };
    target.sessions.set(id, sessionUsage);
    for (const [date, added] of incoming.days) {
      let bucket = sessionUsage.days.get(date);
      if (!bucket) sessionUsage.days.set(date, bucket = { metrics: emptyMetrics(), lastActivityAt: 0, models: new Map(), tools: new Map() });
      addMetrics(bucket.metrics, added.metrics);
      bucket.lastActivityAt = Math.max(bucket.lastActivityAt, added.lastActivityAt);
      for (const [key, model] of added.models) {
        const held = bucket.models.get(key);
        bucket.models.set(key, held ? { ...held, metrics: sumOf([held.metrics, model.metrics]) } : model);
      }
      for (const tool of added.tools.values()) {
        const held = bucket.tools.get(tool.name);
        bucket.tools.set(tool.name, held ? { ...held, calls: held.calls + tool.calls, errors: held.errors + tool.errors } : tool);
      }
    }
  }
  target.marks = delta.marks;
  target.claimed = delta.claimed;
  target.recordedSpend = delta.recordedSpend;
  target.unplacedSpend = delta.unplacedSpend;
  target.registeredSessions = delta.registeredSessions;
  target.undatedRecords += delta.undatedRecords;
  target.unavailable = delta.unavailable;
  target.readSessions = delta.readSessions;
}

export function sliceUsage(scan: UsageScan, query: UsageQuery): UsageReport {
  const now = Date.now();
  const today = dayReader(query.timeZone)(now);
  const inRange = (day: string): boolean => query.kind === "all" || (day >= query.from && day <= query.to);
  const sessions: UsageSession[] = [];
  const recordedDays: string[] = [];

  for (const { session, days } of scan.sessions.values()) {
    const kept = [...days.entries()].filter(([day]) => inRange(day)).toSorted(([left], [right]) => left.localeCompare(right));
    if (!kept.length) continue;
    const metrics = emptyMetrics();
    const models = new Map<string, UsageModel>();
    const tools = new Map<string, UsageTool>();
    let lastActivityAt = 0;
    for (const [date, bucket] of kept) {
      recordedDays.push(date);
      addMetrics(metrics, bucket.metrics);
      lastActivityAt = Math.max(lastActivityAt, bucket.lastActivityAt);
      for (const [key, row] of bucket.models) {
        const previous = models.get(key);
        models.set(key, { ...row, metrics: sumOf(previous ? [previous.metrics, row.metrics] : [row.metrics]) });
      }
      for (const row of bucket.tools.values()) {
        const previous = tools.get(row.name);
        tools.set(row.name, { name: row.name, calls: (previous?.calls ?? 0) + row.calls, errors: (previous?.errors ?? 0) + row.errors });
      }
    }
    sessions.push({
      id: session.id,
      title: session.title,
      ...(session.parentId ? { parentId: session.parentId } : {}),
      lastActivityAt,
      metrics,
      days: kept.map(([date, bucket]): UsageDay => ({ date, metrics: bucket.metrics })),
      models: [...models.values()].toSorted((left, right) => right.metrics.totalTokens - left.metrics.totalTokens
        || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
      tools: [...tools.values()].toSorted((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
    });
  }

  const latest = recordedDays.reduce((last, day) => (day > last ? day : last), today);
  const from = query.kind === "custom" ? query.from : recordedDays.length ? recordedDays.reduce((first, day) => (day < first ? day : first)) : today;
  const to = query.kind === "custom" ? query.to : latest;

  return {
    generatedAt: new Date(now).toISOString(),
    range: { from, to, timeZone: query.timeZone },
    sessions: sessions.toSorted((left, right) => right.lastActivityAt - left.lastActivityAt || left.id.localeCompare(right.id)),
    unplacedSpend: scan.unplacedSpend,
    coverage: {
      registeredSessions: scan.registeredSessions,
      readSessions: scan.readSessions,
      unavailable: scan.unavailable.toSorted((left, right) => left.sessionId.localeCompare(right.sessionId)),
      undatedRecords: scan.undatedRecords,
    },
  };
}

function coverageStamp(sessions: readonly SessionRecord[]): string {
  return JSON.stringify(sessions.map(({ id, updatedAt, runStartedAt }) => [id, updatedAt, runStartedAt]));
}

/**
 * Keeps one scan of every history per time zone and answers any range from it.
 * A scan is reused until the registry records newer activity, so changing the
 * range, the zone or the filters costs a slice instead of another read of every
 * conversation. `refresh` always reads them again.
 */
export class UsageReports {
  #scans = new Map<string, { scan: UsageScan; stamp: string; sessions: string }>();
  #pending = new Map<string, Promise<UsageScan>>();
  #registry: () => Promise<readonly SessionRecord[]>;
  #read: (sessions: readonly SessionRecord[], timeZone: string, previous?: UsageScan) => Promise<UsageScan>;

  constructor(registry: () => Promise<readonly SessionRecord[]>, read = scanUsage) {
    this.#registry = registry;
    this.#read = read;
  }

  async get(query: UsageQuery, refresh = false): Promise<UsageReport> {
    const sessions = await this.#registry();
    const stamp = coverageStamp(sessions);
    const members = sessions.map((session) => session.id).toSorted().join("\n");
    const cached = this.#scans.get(query.timeZone);
    if (cached && cached.stamp === stamp && !refresh) return sliceUsage(cached.scan, query);
    const previous = refresh || cached?.sessions !== members ? undefined : cached.scan;
    return sliceUsage(await this.#rescan(query.timeZone, sessions, stamp, members, previous), query);
  }

  #rescan(timeZone: string, sessions: readonly SessionRecord[], stamp: string, members: string, previous: UsageScan | undefined): Promise<UsageScan> {
    const pending = this.#pending.get(timeZone);
    if (pending) return pending;
    const scan = this.#read(sessions, timeZone, previous).then((found) => {
      this.#scans.set(timeZone, { scan: found, stamp, sessions: members });
      return found;
    }).finally(() => this.#pending.delete(timeZone));
    this.#pending.set(timeZone, scan);
    return scan;
  }
}
