import assert from "node:assert/strict";
import test from "node:test";
import { formatKilobytes, formatMemoryCost, memoryBudgetLabel, memoryChildren, memoryStatusChanged, memoryUsageDetail, memoryUsageLabel, MemoryZoomError, parseMemoryView, parseMemoryZoom } from "./bot-memory.ts";
import type { BotMemoryStatus } from "./bots.ts";

test("the view's lines are parsed without the chat wrapper", () => {
  const lines = parseMemoryView("<chat>\n0+8|user asked for links; talk: found three\n8+2|user: thanks\n10+1|(not summarized yet: zoom it)\n</chat>");
  assert.deepEqual(lines, [
    { id: 0, n: 8, address: "0+8", text: "user asked for links; talk: found three" },
    { id: 8, n: 2, address: "8+2", text: "user: thanks" },
    { id: 10, n: 1, address: "10+1", text: "(not summarized yet: zoom it)" },
  ]);
  assert.deepEqual(parseMemoryView(""), []);
  assert.deepEqual(parseMemoryView("<chat>\n</chat>"), []);
  assert.deepEqual(parseMemoryView("0+1|first\nstray continuation").map(({ text }) => text), ["first stray continuation"]);
});

test("zooming a summary returns its two halves and a single message whole", () => {
  assert.deepEqual(parseMemoryZoom("0+4|user asked; talk answered\n4+4|tool read; echo file", { id: 0, n: 8 }).map(({ address, text }) => [address, text]), [["0+4", "user asked; talk answered"], ["4+4", "tool read; echo file"]]);
  assert.deepEqual(parseMemoryZoom("3+0|user: line one\nline two", { id: 3, n: 1 }), [{ id: 3, n: 1, address: "3+0", text: "user: line one\nline two", message: true }]);
  assert.throws(() => parseMemoryZoom("No line 5+3.", { id: 5, n: 3 }), MemoryZoomError);
});

test("children address the two halves down to single messages", () => {
  assert.deepEqual(memoryChildren({ id: 8, n: 4 }), [{ id: 8, n: 2 }, { id: 10, n: 2 }]);
  assert.deepEqual(memoryChildren({ id: 10, n: 2 }), [{ id: 10, n: 1 }, { id: 11, n: 1 }]);
  assert.equal(memoryChildren({ id: 11, n: 1 }), undefined);
});

test("the summarizer's spend reads as calls, tokens in and out, and a cost only when one was reported", () => {
  const none = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  assert.equal(memoryUsageLabel(none), "No model calls yet");
  assert.equal(memoryUsageLabel({ ...none, calls: 1, input: 1, output: 1 }), "1 call · 1 token in, 1 out", "the fixture's one compactor call");
  assert.equal(
    memoryUsageLabel({ calls: 12, input: 48_000, output: 1_200, cacheRead: 30_000, cacheWrite: 2_000, cost: 0.0421 }),
    "12 calls · 80,000 tokens in, 1,200 out · $0.0421",
    "cache reads and writes count as input",
  );
  assert.equal(
    memoryUsageDetail({ calls: 12, input: 48_000, output: 1_200, cacheRead: 30_000, cacheWrite: 2_000, cost: 0.0421 }),
    "12 model calls; tokens: 48,000 input, 30,000 cache read, 2,000 cache write, 1,200 output; $0.0421 reported",
  );
  assert.equal(memoryUsageDetail({ ...none, calls: 1, input: 1, output: 1 }), "1 model call; tokens: 1 input, 0 cache read, 0 cache write, 1 output");
  assert.equal(formatMemoryCost(0.00004), "<$0.0001");
  assert.equal(formatMemoryCost(1.5), "$1.5000");
});

test("the open Memory tab reads again only when the pushed status differs from the one shown", () => {
  const shown: BotMemoryStatus = { messages: 4, built: 7, pending: 0, viewBytes: 92, viewLines: 4, usage: { calls: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 } };
  assert.equal(memoryStatusChanged(shown, { ...shown, usage: { ...shown.usage } }), false, "an equal copy is no change");
  assert.equal(memoryStatusChanged(shown, undefined), false, "a bot without a readable memory pushes nothing to follow");
  assert.equal(memoryStatusChanged(undefined, shown), true, "nothing shown yet");
  for (const pushed of [
    { ...shown, messages: 5 },
    { ...shown, pending: 1 },
    { ...shown, viewBytes: 120, viewLines: 5 },
    { ...shown, waiting: true },
    { ...shown, failing: { node: "4+1", error: "429", since: "2026-10-05T20:00:00.000Z" } },
    { ...shown, usage: { ...shown.usage, calls: 2, input: 2, output: 2 } },
  ]) {
    assert.equal(memoryStatusChanged(shown, pushed), true, JSON.stringify(pushed));
  }
  assert.equal(memoryStatusChanged({ ...shown, waiting: false }, shown), false, "waiting false and absent read the same");
});

test("sizes read against the 128 KB budget", () => {
  assert.equal(memoryBudgetLabel(92_000), "92/128 KB");
  assert.equal(memoryBudgetLabel(0), "0/128 KB");
  assert.equal(formatKilobytes(1_536), "1.5");
  assert.equal(formatKilobytes(2_000), "2");
});
