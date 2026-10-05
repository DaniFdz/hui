import assert from "node:assert/strict";
import test from "node:test";
import { formatKilobytes, memoryBudgetLabel, memoryChildren, memoryUsageLabel, MemoryZoomError, parseMemoryView, parseMemoryZoom } from "./bot-memory.ts";

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

test("sizes read against the 128 KB budget and usage leaves out unknown parts", () => {
  assert.equal(memoryBudgetLabel(92_000), "92/128 KB");
  assert.equal(memoryBudgetLabel(0), "0/128 KB");
  assert.equal(formatKilobytes(1_536), "1.5");
  assert.equal(formatKilobytes(2_000), "2");
  assert.equal(memoryUsageLabel({ input: 12_345, output: 678, cacheRead: 1_000, cacheWrite: 24, cost: 0.004 }), "12,345 in · 678 out · 1,024 cached · $0.0040");
  assert.equal(memoryUsageLabel({ output: 5, cost: 1.5 }), "5 out · $1.50");
  assert.equal(memoryUsageLabel(undefined), "");
  assert.equal(memoryUsageLabel({}), "");
});
