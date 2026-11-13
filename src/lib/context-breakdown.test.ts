import assert from "node:assert/strict";
import { test } from "vitest";
import { contextBreakdown } from "./context-breakdown.ts";

test("the breakdown fits its estimated parts to the measured total", () => {
  const rows = contextBreakdown([
    { id: "system", tokens: 60 },
    { id: "tools", tokens: 30, count: 2 },
    { id: "conversation", tokens: 10, count: 4 },
    { id: "summary", tokens: 0 },
  ], 1_000, 10_000);
  assert.deepEqual(rows.map((row) => row.id), ["system", "tools", "conversation"], "a part with no tokens has no row");
  assert.deepEqual(rows.map((row) => row.tokens), [600, 300, 100]);
  assert.deepEqual(rows.map((row) => row.label), ["System prompt", "Tool definitions", "Conversation"]);
  assert.deepEqual(rows.map((row) => row.detail), [undefined, "2 tools", "4 messages"]);
  assert.deepEqual(rows.map((row) => row.percent), [6, 3, 1], "each share is of the whole window");
});

test("rounding never gives more than the total it fits, in the order the parts come", () => {
  const rows = contextBreakdown([
    { id: "system", tokens: 1 }, { id: "tools", tokens: 1 }, { id: "conversation", tokens: 1 },
  ], 10, 100);
  assert.deepEqual(rows.map((row) => row.tokens), [3, 4, 3]);
  const tiny = contextBreakdown([
    { id: "system", tokens: 1 }, { id: "tools", tokens: 1 }, { id: "conversation", tokens: 1 }, { id: "summary", tokens: 1 },
  ], 2, 100);
  assert.deepEqual(tiny.map((row) => row.tokens).reduce((sum, tokens) => sum + tokens, 0), 2, "four equal parts of a two-token total still add up");
});

test("without a measured total or any estimate there is no breakdown", () => {
  assert.deepEqual(contextBreakdown([{ id: "system", tokens: 5 }], 0, 1_000), []);
  assert.deepEqual(contextBreakdown([{ id: "system", tokens: 0 }], 100, 1_000), []);
  assert.deepEqual(contextBreakdown([], 100, 1_000), []);
});
