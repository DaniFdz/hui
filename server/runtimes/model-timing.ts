/** Per-model-request timing HUI measures at the runtime boundary: start to first content token, first token to the
 * completed assistant message, and the usage that message reports. Prompt throughput divides new input tokens by the
 * time to first token, so it includes queue and prefill and is labelled an estimate in the UI. */
import type { ModelMetric } from "../api/model-metrics.ts";

type Timing = {
  startedAt: number;
  provider: string;
  model: string;
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

export class ModelRequestTimer {
  #timing: Timing | undefined;

  /** The assistant partial that begins a request. A non-assistant message is ignored. */
  start(message: unknown, now: number): void {
    const value = record(message);
    if (value?.role !== "assistant") return;
    this.#timing = {
      startedAt: now,
      provider: typeof value.provider === "string" ? value.provider : "unknown",
      model: typeof value.model === "string" ? value.model : "unknown",
      ...(hasContent(message) ? { firstTokenAt: now } : {}),
    };
  }

  /** The first streamed block or delta after the start. */
  update(changes: readonly unknown[], now: number): void {
    if (!this.#timing || this.#timing.firstTokenAt !== undefined) return;
    if (changes.some(changeHasContent)) this.#timing.firstTokenAt = now;
  }

  /** The completed assistant message, or undefined when no assistant request started. */
  finish(message: unknown, now: number): ModelMetric | undefined {
    const timing = this.#timing;
    this.#timing = undefined;
    if (!timing) return undefined;
    const value = record(message);
    const usage = record(value?.usage);
    const inputTokens = number(usage?.input);
    const outputTokens = number(usage?.output);
    const cacheReadTokens = number(usage?.cacheRead);
    const cacheWriteTokens = number(usage?.cacheWrite);
    const durationMs = Math.max(0, now - timing.startedAt);
    const ttftMs = timing.firstTokenAt === undefined ? undefined : Math.max(0, timing.firstTokenAt - timing.startedAt);
    const generationMs = timing.firstTokenAt === undefined ? undefined : Math.max(0, now - timing.firstTokenAt);
    return {
      at: Date.now(),
      provider: typeof value?.provider === "string" ? value.provider : timing.provider,
      model: typeof value?.model === "string" ? value.model : timing.model,
      status: value?.stopReason === "error" ? "error" : "ok",
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
      ...(ttftMs === undefined ? {} : { ttftMs }),
      durationMs,
      ...(generationMs === undefined ? {} : { generationMs }),
      ...(outputTokens !== undefined && generationMs ? { tokensPerSecond: outputTokens / (generationMs / 1000) } : {}),
      ...(inputTokens !== undefined && ttftMs ? { promptTokensPerSecond: inputTokens / (ttftMs / 1000) } : {}),
    };
  }
}
