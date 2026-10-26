/**
 * The Usage page's report: tokens, recorded PI cost estimates and message
 * counts read from the current histories of the registered local sessions,
 * bucketed into calendar days of one time zone.
 *
 * Durable conversations are read page by page, read-only, through the entries
 * HUI already views; a fork inherits its source's entries under the same entry
 * IDs, so an ID counts once globally and is attributed to the registered
 * conversation that owns it. Legacy PI transcripts are read from the file the
 * registry names, bounded and only for their own path. Nothing is persisted:
 * this scope is the current histories, not background compaction, abandoned
 * branches or provider billing, which stay outside the report.
 */
import { readFile, stat } from "node:fs/promises";

import { CompactionEntry, type ConversationId } from "@earendil-works/pi-durable";
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

type StoredEntryScan = (conversationId: number) => AsyncIterable<StoredEntry>;

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number | null };

type UsageLabel = { provider: string; model: string };

type UsageEvent = {
  role: "user" | "assistant" | "toolResult" | "usage";
  time: number | undefined;
  usage?: Usage;
  label?: UsageLabel;
  tool?: string;
  isError?: boolean;
};

type Accumulator = {
  session: SessionRecord;
  metrics: UsageMetrics;
  days: Map<string, UsageMetrics>;
  models: Map<string, UsageModel>;
  tools: Map<string, UsageTool>;
  lastActivityAt: number;
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

function durableScan(): StoredEntryScan {
  return async function* (conversationId) {
    const harness = await durableHost().open();
    const conversation = await harness.conversation(conversationId as ConversationId, durableContext);
    if (!conversation) throw new Error("That conversation is not in this gateway's Durable store.");
    let cursor;
    do {
      const page = await conversation.entries({}, PAGE, cursor, durableContext);
      yield* page.items;
      cursor = page.next;
      await yieldToEventLoop();
    } while (cursor);
  };
}

export async function readUsageReport(sessions: readonly SessionRecord[], query: UsageQuery): Promise<UsageReport> {
  const now = Date.now();
  const scan = durableScan();
  const dayOf = dayReader(query.timeZone);
  const today = dayOf(now);
  const inRange = (day: string): boolean => query.kind === "all" || (day >= query.from && day <= query.to);

  const accumulators = new Map<string, Accumulator>();
  const accumulatorFor = (session: SessionRecord): Accumulator => {
    let accumulator = accumulators.get(session.id);
    if (!accumulator) {
      accumulators.set(session.id, accumulator = {
        session, metrics: emptyMetrics(), days: new Map(), models: new Map(), tools: new Map(), lastActivityAt: 0,
      });
    }
    return accumulator;
  };

  let undatedRecords = 0;
  const accept = (session: SessionRecord, event: UsageEvent): void => {
    if (event.time === undefined) {
      undatedRecords += 1;
      return;
    }
    const day = dayOf(event.time);
    if (!inRange(day)) return;
    const accumulator = accumulatorFor(session);
    addEvent(accumulator.metrics, event);
    let dayMetrics = accumulator.days.get(day);
    if (!dayMetrics) accumulator.days.set(day, dayMetrics = emptyMetrics());
    addEvent(dayMetrics, event);
    const eventLabel = event.label;
    if (event.usage && eventLabel) {
      const key = `${eventLabel.provider}\u0000${eventLabel.model}`;
      let bucket = accumulator.models.get(key);
      if (!bucket) accumulator.models.set(key, bucket = { provider: eventLabel.provider, model: eventLabel.model, metrics: emptyMetrics() });
      addEvent(bucket.metrics, event);
    }
    if (event.tool) {
      const bucket = accumulator.tools.get(event.tool) ?? { name: event.tool, calls: 0, errors: 0 };
      accumulator.tools.set(event.tool, bucket);
      bucket.calls += 1;
      if (event.isError) bucket.errors += 1;
    }
    accumulator.lastActivityAt = Math.max(accumulator.lastActivityAt, event.time);
  };

  const ordered = sessions.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const owners = new Map<number, SessionRecord>();
  for (const session of ordered) {
    if (session.worker) continue;
    const conversationId = durableConversationId(session.piSessionFile);
    if (conversationId !== undefined) owners.set(conversationId, session);
  }

  const claimedEntries = new Set<number>();
  const readPaths = new Set<string>();
  const unavailable: { sessionId: string; reason: string }[] = [];
  let readSessions = 0;

  for (const session of ordered) {
    const reference = session.piSessionFile;
    if (session.worker) {
      unavailable.push({ sessionId: session.id, reason: "The transcript lives on a remote worker and is not read here." });
      continue;
    }
    if (!reference) continue;

    const conversationId = durableConversationId(reference);
    if (conversationId !== undefined) {
      try {
        for await (const entry of scan(conversationId)) {
          if (claimedEntries.has(entry.id)) continue;
          claimedEntries.add(entry.id);
          const owner = owners.get(entry.conversationId) ?? session;
          for (const message of entry.model ?? []) {
            if (entry.kind === CompactionEntry.kind && message.role === "user") continue;
            const event = messageEvent(message);
            if (event) accept(owner, event);
          }
        }
        readSessions += 1;
      } catch {
        unavailable.push({ sessionId: session.id, reason: "The local conversation could not be read." });
      }
      continue;
    }

    if (readPaths.has(reference)) continue;
    readPaths.add(reference);
    try {
      const info = await stat(reference);
      if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) {
        unavailable.push({ sessionId: session.id, reason: "The transcript is too large or unavailable." });
        continue;
      }
      const source = await readFile(reference, "utf8");
      if (Buffer.byteLength(source) > MAX_TRANSCRIPT_BYTES) {
        unavailable.push({ sessionId: session.id, reason: "The transcript is too large or unavailable." });
        continue;
      }
      readSessions += 1;
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
      if (malformed) unavailable.push({ sessionId: session.id, reason: "Some transcript records could not be read." });
    } catch {
      unavailable.push({ sessionId: session.id, reason: "The transcript is unavailable." });
    }
  }

  const recordedDays = [...accumulators.values()].flatMap((accumulator) => [...accumulator.days.keys()]);
  const latest = recordedDays.reduce((last, day) => (day > last ? day : last), today);
  const from = query.kind === "custom" ? query.from : recordedDays.length ? recordedDays.reduce((first, day) => (day < first ? day : first)) : today;
  const to = query.kind === "custom" ? query.to : latest;

  return {
    generatedAt: new Date(now).toISOString(),
    range: { from, to, timeZone: query.timeZone },
    sessions: [...accumulators.values()]
      .map((accumulator): UsageSession => ({
        id: accumulator.session.id,
        title: accumulator.session.title,
        ...(accumulator.session.parentId ? { parentId: accumulator.session.parentId } : {}),
        lastActivityAt: accumulator.lastActivityAt,
        metrics: accumulator.metrics,
        days: [...accumulator.days.entries()]
          .map(([date, metrics]): UsageDay => ({ date, metrics }))
          .toSorted((left, right) => left.date.localeCompare(right.date)),
        models: [...accumulator.models.values()].toSorted((left, right) => right.metrics.totalTokens - left.metrics.totalTokens
          || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
        tools: [...accumulator.tools.values()].toSorted((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
      }))
      .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt || left.id.localeCompare(right.id)),
    coverage: {
      registeredSessions: sessions.length,
      readSessions,
      unavailable: unavailable.toSorted((left, right) => left.sessionId.localeCompare(right.sessionId)),
      undatedRecords,
    },
  };
}