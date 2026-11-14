import assert from "node:assert/strict";
import { test } from "vitest";
import { toolCardOutcome, toolTiming } from "./tool-cards.ts";

const read = (extra: Record<string, unknown> = {}) => ({ kind: "tool" as const, id: "t1", name: "read", args: { path: "a.ts" }, status: "succeeded" as const, ...extra });

test("a finished tool card carries the duration the gateway measured for the call", () => {
  assert.equal(toolTiming(read({ metrics: { durationMs: 87 } })), " in 87 ms");
  assert.equal(toolTiming(read({ metrics: { durationMs: 4_100 } })), " in 4s");
  // A call the gateway did not time, or one still running, shows no duration at all.
  assert.equal(toolTiming(read()), "");
  assert.equal(toolTiming(read({ metrics: { inputTokens: 10 } })), "");
  assert.equal(toolTiming(read({ status: "running", metrics: { durationMs: 87 } })), "");
});

test("a card's outcome line says what happened and how long it took, as the message footer words a duration", () => {
  assert.equal(toolCardOutcome(read({ metrics: { durationMs: 87 } })), "Completed in 87 ms");
  assert.equal(toolCardOutcome(read({ status: "failed", metrics: { durationMs: 1_200 } })), "failed in 1s");
  assert.equal(toolCardOutcome(read({ failed: true })), "failed");
  assert.equal(toolCardOutcome(read({ status: "running" })), "Running");
});
