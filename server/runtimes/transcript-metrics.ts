/** Optional transcript measurements, never inferred from neighbouring messages: sanitizing them, and what each
 * runtime's own events carry. */
import type { TranscriptMetrics } from "../api/sessions.ts";

export type { TranscriptMetrics };

export function validMetric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function sanitizeMetrics(value: unknown): TranscriptMetrics {
  if (!value || typeof value !== "object") return {};
  const result: TranscriptMetrics = {};
  for (const key of ["timestamp", "completedAt", "durationMs", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
    const number = validMetric((value as Record<string, unknown>)[key]);
    if (number !== undefined && (!(key === "timestamp" || key === "completedAt") || number <= 8.64e15)) result[key] = number;
  }
  return result;
}

/** The fields `RuntimeTimings` reads from a runtime's own event. */
export type TimingEvent = {
  readonly type?: unknown;
  readonly message?: unknown;
  readonly toolCallId?: unknown;
  /** Durable commits entries, so its `message_end` carries the entry whose first model message is the answer. */
  readonly entry?: { readonly model?: readonly unknown[] };
};

/** What `RuntimeTimings` reads from `event`, which for Durable's commit events is not what PI's raw events carry:
 * Durable's `message_end` holds the committed entry (`entry.model[0]` is the message PI reports on its own) and its
 * tool events carry only a call ID, keyed on the answer that declared it. Anything else measures nothing, and an odd
 * shape is an event without measurements rather than a reason to fail the stream. */
export function timingEvent(event: TimingEvent): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const type = typeof event.type === "string" ? event.type : undefined;
  if (type === "message_end") {
    const model = event.entry?.model;
    return { type, message: Array.isArray(model) ? model[0] : undefined };
  }
  if (
    type === "message_start" || type === "tool_execution_start" || type === "tool_execution_update" ||
    type === "tool_execution_end"
  ) {
    return { type, message: event.message, toolCallId: event.toolCallId };
  }
  return {};
}

/** Measurements survive browser reconnects, but not a runtime restart. PI owns persistence. */
export class RuntimeTimings {
  private messageTimestamp: number | undefined;
  /** A message's start, keyed by the message's own timestamp. */
  private messageStarts = new Map<string, number>();
  /** A tool's start, keyed by its call ID alone: a runtime may run the call before it commits the answer that declared
   * it, so no message is known yet when the call begins. */
  private toolStarts = new Map<string, number>();
  private completed = new Map<string, TranscriptMetrics>();
  observe(raw: Record<string, unknown>, now = Date.now()): void {
    const message = raw.message as Record<string, unknown> | undefined;
    const type = raw.type;
    if (type === "message_start" && message?.role === "assistant") this.messageTimestamp = validMetric(message.timestamp);
    if (type === "message_start" || type === "message_end") {
      if (message?.role !== "assistant") return;
      const id = validMetric(message?.timestamp);
      if (id === undefined) return;
      const key = `message:${id}`;
      if (type === "message_start") this.messageStarts.set(key, now);
      else {
        const start = this.messageStarts.get(key);
        this.completed.set(key, { completedAt: now, ...(start !== undefined && now >= start ? { durationMs: now - start } : {}) });
        this.messageStarts.delete(key);
      }
      return;
    }
    if (type !== "tool_execution_start" && type !== "tool_execution_update" && type !== "tool_execution_end") return;
    const id = raw.toolCallId;
    if (typeof id !== "string" || !id) return;
    if (type === "tool_execution_start") {
      this.toolStarts.set(id, now);
      return;
    }
    if (type !== "tool_execution_end") return;
    const start = this.toolStarts.get(id);
    this.toolStarts.delete(id);
    // The completed entry is stored where `transcriptFrom` looks for it: under the answer that declared the call.
    this.completed.set(`tool:${this.messageTimestamp}:${id}`, {
      completedAt: now,
      ...(start !== undefined && now >= start ? { durationMs: now - start } : {}),
    });
  }
  get(kind: "message" | "tool", id: unknown, messageTimestamp?: unknown): TranscriptMetrics {
    const key = kind === "message" ? `message:${id}` : `tool:${messageTimestamp}:${id}`;
    return this.completed.get(key) ?? {};
  }
}
