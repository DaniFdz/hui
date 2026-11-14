import assert from "node:assert/strict";
import { test } from "vitest";
import { ModelRequestTimer } from "./model-timing.ts";

/** PI stamps a partial with the epoch ms its request started, and `pending` while it streams. */
const requestedAt = 1_700_000_000_000;
const partial = { role: "assistant", provider: "llama-local", model: "qwen", stopReason: "pending", timestamp: requestedAt, content: [] };
const done = {
  role: "assistant", provider: "llama-local", model: "qwen", stopReason: "stop", timestamp: requestedAt,
  content: [{ type: "text", text: "Hello" }],
  usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 },
};
/** The timer's readings are milliseconds after the request started, which keeps the arithmetic readable. */
const epoch = (now: number) => requestedAt + now;

test("measures time to first token from the request start, generation and prompt throughput", () => {
  const timer = new ModelRequestTimer();
  // HUI first sees the partial 300 ms into the request, before any token is streamed.
  timer.start(partial, 300, epoch(300));
  timer.update([{ type: "text_start", contentIndex: 0 }], 350);
  timer.update([{ type: "text_delta", contentIndex: 0, delta: "H" }], 700);
  timer.update([{ type: "text_delta", contentIndex: 0, delta: "i" }], 800);
  const metric = timer.finish(done, 2_700);
  assert.ok(metric);
  assert.equal(metric.provider, "llama-local");
  assert.equal(metric.model, "qwen");
  assert.equal(metric.status, "ok");
  assert.equal(metric.ttftMs, 700);
  assert.equal(metric.durationMs, 2_700);
  assert.equal(metric.generationMs, 2_000);
  assert.equal(metric.tokensPerSecond, 10);
  assert.equal(metric.promptTokensPerSecond, 100 / 0.7);
  assert.equal(metric.inputTokens, 100);
  assert.equal(metric.outputTokens, 20);
  assert.equal(metric.cacheReadTokens, 40);
  assert.ok(metric.at > 0);
});

test("a partial that already holds the first token counts from the request start, never zero", () => {
  const timer = new ModelRequestTimer();
  // Durable commits a partial only once it holds content, so the usual first sight already has a token: the partial
  // arrives 900 ms into the request, and the answer ends 600 ms later.
  timer.start({ ...partial, content: [{ type: "text", text: "Hello" }] }, 900, epoch(900));
  const metric = timer.finish(done, 1_500);
  assert.equal(metric?.ttftMs, 900);
  assert.equal(metric?.generationMs, 600);
  assert.equal(metric?.durationMs, 1_500);
  assert.equal(metric?.tokensPerSecond, 20 / 0.6);
});

test("an answer handed over whole reports its duration and throughput but no invented split", () => {
  const timer = new ModelRequestTimer();
  // Durable commits no partial for a response it streamed within its progress interval: HUI only sees the answer whole.
  timer.start({ ...done, durationMs: 2_000 }, 2_000, epoch(2_000));
  const metric = timer.finish({ ...done, durationMs: 2_000 }, 2_002);
  assert.equal(metric?.ttftMs, undefined);
  assert.equal(metric?.generationMs, undefined);
  assert.equal(metric?.durationMs, 2_000);
  assert.equal(metric?.tokensPerSecond, 10);
  assert.equal(metric?.promptTokensPerSecond, undefined);
});

test("a request with no recorded start reports no time to first token rather than zero", () => {
  const timer = new ModelRequestTimer();
  timer.start({ ...partial, timestamp: undefined, content: [{ type: "text", text: "Hello" }] }, 0);
  const metric = timer.finish(done, 600);
  assert.equal(metric?.ttftMs, undefined);
  assert.equal(metric?.generationMs, 600);
  assert.equal(metric?.durationMs, 600);
  assert.equal(metric?.promptTokensPerSecond, undefined);
});

test("a request with no content reports its duration but no invented throughput", () => {
  const timer = new ModelRequestTimer();
  timer.start(partial, 0, epoch(0));
  const metric = timer.finish({ ...done, stopReason: "error", usage: undefined, durationMs: 1_000 }, 1_000);
  assert.equal(metric?.status, "error");
  assert.equal(metric?.ttftMs, undefined);
  assert.equal(metric?.tokensPerSecond, undefined);
  assert.equal(metric?.promptTokensPerSecond, undefined);
  assert.equal(metric?.durationMs, 1_000);
});

test("a request start recorded in the future is no start at all", () => {
  const timer = new ModelRequestTimer();
  timer.start({ ...partial, timestamp: requestedAt + 5_000, content: [{ type: "text", text: "Hi" }] }, 0, epoch(0));
  assert.equal(timer.finish(done, 500)?.ttftMs, undefined);
});

test("a user or tool entry ending leaves the request it interrupts running", () => {
  const timer = new ModelRequestTimer();
  timer.start({ ...partial, content: [{ type: "text", text: "Hello" }] }, 900, epoch(900));
  // A steered input arrives while the answer streams: its entry ends in the same loop.
  assert.equal(timer.finish({ role: "user", content: "Wait" }, 1_000), undefined);
  assert.equal(timer.finish({ role: "toolResult", toolCallId: "a" }, 1_100), undefined);
  const metric = timer.finish(done, 1_500);
  assert.equal(metric?.ttftMs, 900);
  assert.equal(metric?.generationMs, 600);
});

test("ignores a non-assistant message and only finishes a started request once", () => {
  const timer = new ModelRequestTimer();
  timer.start({ role: "user", content: [] }, 0);
  assert.equal(timer.finish(done, 100), undefined);
  timer.start(partial, 0, epoch(0));
  timer.update([{ type: "text_delta", delta: "x" }], 100);
  assert.ok(timer.finish(done, 200));
  assert.equal(timer.finish(done, 300), undefined);
});
