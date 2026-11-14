/** Per-model-request timing HUI measures at the runtime boundary: the request start PI records on the message to the
 * first content token HUI sees, that token to the completed message, and the usage that message reports.
 *
 * Durable persists a streamed partial only once it holds content, so the partial HUI first sees usually holds the first
 * token already, and counting from that observation would always measure zero. Time to first token therefore counts
 * from the request start PI records on the message (`timestamp`) and includes the progress-persistence interval before
 * the partial's commit. Prompt throughput divides new input tokens by the time to first token, so it includes queue and
 * prefill and is labelled an estimate in the UI. */
import type { ModelMetric } from "../api/model-metrics.ts";

type Timing = {
  provider: string;
  model: string;
  /** When HUI saw the partial that began the request, on the clock this timer's `now` readings use. */
  observedAt: number;
  /** The request start PI recorded for that partial, on this timer's clock; absent when it recorded none. */
  requestStart?: number;
  /** Whether the request was still streaming when HUI saw it: a `pending` partial, not an answer handed over whole. */
  streaming: boolean;
  /** When HUI saw the first content token, on this timer's clock. */
  firstTokenAt?: number;
};

const CONTENT_DELTA = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function contentBlocks(message: unknown): unknown[] {
  const content = record(message)?.content;
  return Array.isArray(content) ? content : [];
}

/** Whether a partial message already holds a token, as one can at `message_start`. */
function hasContent(message: unknown): boolean {
  return contentBlocks(message).some((block) => {
    const value = record(block);
    if (!value) return false;
    if (value.type === "text") return typeof value.text === "string" && value.text.length > 0;
    if (value.type === "thinking") return typeof value.thinking === "string" && value.thinking.length > 0;
    return value.type === "toolCall" || value.type === "tool_call";
  });
}

function changeHasContent(change: unknown): boolean {
  const value = record(change);
  if (!value || typeof value.type !== "string") return false;
  if (CONTENT_DELTA.has(value.type)) return typeof value.delta === "string" && value.delta.length > 0;
  if (value.type === "block") {
    const block = record(value.block);
    if (block?.type === "thinking" || block?.type === "text") return typeof block.text === "string" && block.text.length > 0;
    return block?.type === "toolCall" || block?.type === "tool_call";
  }
  return false;
}

/** The request start recorded on a message (`timestamp`, epoch ms), moved onto this timer's clock; `now` and `epoch` are
 * the same instant. Undefined when the message carries none, or one no request could have started at. */
function requestStart(message: Record<string, unknown>, now: number, epoch: number): number | undefined {
  const recorded = number(message.timestamp);
  return recorded !== undefined && recorded > 0 && recorded <= epoch ? now - (epoch - recorded) : undefined;
}

export class ModelRequestTimer {
  #timing: Timing | undefined;

  /** The assistant partial that begins a request: `now` on this timer's clock, and `epoch` (wall-clock ms) for that same
   * instant, which places PI's recorded request start on it. A non-assistant message is ignored. */
  start(message: unknown, now: number, epoch = Date.now()): void {
    const value = record(message);
    if (value?.role !== "assistant") return;
    const streaming = value.stopReason === "pending";
    const startedAt = requestStart(value, now, epoch);
    this.#timing = {
      provider: typeof value.provider === "string" ? value.provider : "unknown",
      model: typeof value.model === "string" ? value.model : "unknown",
      observedAt: now,
      ...(startedAt === undefined ? {} : { requestStart: startedAt }),
      streaming,
      // A partial that already holds a token was first seen with it: the observation is HUI's only evidence of when it
      // arrived. An answer handed over whole shows no token of its stream, so nothing is timed from it.
      ...(streaming && hasContent(message) ? { firstTokenAt: now } : {}),
    };
  }

  /** The first streamed block or delta after the start. */
  update(changes: readonly unknown[], now: number): void {
    if (!this.#timing?.streaming || this.#timing.firstTokenAt !== undefined) return;
    if (changes.some(changeHasContent)) this.#timing.firstTokenAt = now;
  }

  /** The completed assistant message, or undefined when the request did not end here: a user, tool or call entry ends
   * while the request still streams, and only a request that started is reported once. */
  finish(message: unknown, now: number): ModelMetric | undefined {
    const value = record(message);
    if (value?.role !== "assistant") return undefined;
    const timing = this.#timing;
    this.#timing = undefined;
    if (!timing) return undefined;
    const usage = record(value.usage);
    const inputTokens = number(usage?.input);
    const outputTokens = number(usage?.output);
    const cacheReadTokens = number(usage?.cacheRead);
    const cacheWriteTokens = number(usage?.cacheWrite);
    const firstTokenAt = timing.firstTokenAt;
    // HUI's own span covers the whole request, so time to first token and generation add up to it. A request it saw no
    // token of keeps PI's own duration instead, which it times from the request start.
    const measuredMs = Math.max(0, now - (timing.requestStart ?? timing.observedAt));
    const durationMs = firstTokenAt === undefined ? number(value.durationMs) ?? measuredMs : measuredMs;
    const generationMs = firstTokenAt === undefined ? undefined : Math.max(0, now - firstTokenAt);
    const ttftMs = firstTokenAt === undefined || timing.requestStart === undefined
      ? undefined
      : Math.max(0, firstTokenAt - timing.requestStart);
    // Without a first token seen there is no generation to divide by: the whole request is the measured span.
    const throughputMs = generationMs || durationMs;
    return {
      at: Date.now(),
      provider: typeof value.provider === "string" ? value.provider : timing.provider,
      model: typeof value.model === "string" ? value.model : timing.model,
      status: value.stopReason === "error" ? "error" : "ok",
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
      ...(ttftMs === undefined ? {} : { ttftMs }),
      durationMs,
      ...(generationMs === undefined ? {} : { generationMs }),
      ...(outputTokens !== undefined && throughputMs > 0 ? { tokensPerSecond: outputTokens / (throughputMs / 1000) } : {}),
      ...(inputTokens !== undefined && ttftMs ? { promptTokensPerSecond: inputTokens / (ttftMs / 1000) } : {}),
    };
  }
}
