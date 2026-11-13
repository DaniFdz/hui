import assert from "node:assert/strict";
import { test } from "vitest";
import { ModelRequestTimer } from "./model-timing.ts";

const partial = { role: "assistant", provider: "llama-local", model: "qwen", content: [] };
const done = {
  role: "assistant", provider: "llama-local", model: "qwen", stopReason: "end",
  content: [{ type: "text", text: "Hello" }],
  usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 },
};

test("measures time to first token, generation and prompt throughput", () => {
  const timer = new ModelRequestTimer();
  timer.start(partial, 1_000);
  timer.update([{ type: "text_start", contentIndex: 0 }], 1_050);
  timer.update([{ type: "text_delta", contentIndex: 0, delta: "H" }], 1_400);
  timer.update([{ type: "text_delta", contentIndex: 0, delta: "i" }], 1_500);
  const metric = timer.finish(done, 3_400);
  assert.ok(metric);
  assert.equal(metric.provider, "llama-local");
  assert.equal(metric.model, "qwen");
  assert.equal(metric.status, "ok");
  assert.equal(metric.ttftMs, 400);
  assert.equal(metric.durationMs, 2_400);
  assert.equal(metric.generationMs, 2_000);
  assert.equal(metric.tokensPerSecond, 10);
  assert.equal(metric.promptTokensPerSecond, 250);
  assert.equal(metric.inputTokens, 100);
  assert.equal(metric.outputTokens, 20);
  assert.equal(metric.cacheReadTokens, 40);
  assert.ok(metric.at > 0);
});

test("a message that already holds text at start reports no separate token wait", () => {
  const timer = new ModelRequestTimer();
  timer.start({ ...partial, content: [{ type: "thinking", thinking: "Plan" }] }, 2_000);
  const metric = timer.finish(done, 2_500);
  assert.equal(metric?.ttftMs, 0);
  assert.equal(metric?.generationMs, 500);
  assert.equal(metric?.tokensPerSecond, 40);
});

test("a request with no content reports its duration but no invented throughput", () => {
  const timer = new ModelRequestTimer();
  timer.start(partial, 0);
  const metric = timer.finish({ ...done, stopReason: "error", usage: undefined }, 1_000);
  assert.equal(metric?.status, "error");
  assert.equal(metric?.ttftMs, undefined);
  assert.equal(metric?.tokensPerSecond, undefined);
  assert.equal(metric?.promptTokensPerSecond, undefined);
  assert.equal(metric?.durationMs, 1_000);
});

test("ignores a non-assistant message and only finishes a started request once", () => {
  const timer = new ModelRequestTimer();
  timer.start({ role: "user", content: [] }, 0);
  assert.equal(timer.finish(done, 100), undefined);
  timer.start(partial, 0);
  timer.update([{ type: "text_delta", delta: "x" }], 100);
  assert.ok(timer.finish(done, 200));
  assert.equal(timer.finish(done, 300), undefined);
});
