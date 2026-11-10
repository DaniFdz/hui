import assert from "node:assert/strict";
import { test } from "vitest";
import { describeMetrics, describeTimings, formatBytes, formatDuration, navigationFromEntry } from "./performance.ts";

test("durations and sizes read at one useful unit", () => {
  assert.equal(formatDuration(0.4), "0 ms");
  assert.equal(formatDuration(942), "942 ms");
  assert.equal(formatDuration(1_420), "1.4 s");
  assert.equal(formatDuration(124_000), "2 min 4 s");
  assert.equal(formatDuration(120_000), "2 min");
  assert.equal(formatDuration(Number.NaN), "unknown");
  assert.equal(formatBytes(412), "412 B");
  assert.equal(formatBytes(412_000), "402 KB");
  assert.equal(formatBytes(12_400_000), "11.8 MB");
  assert.equal(formatBytes(-1), "unknown");
});

test("renderer counters become heap, node, layout and script lines", () => {
  const lines = describeMetrics({
    JSHeapUsedSize: 12_400_000, JSHeapTotalSize: 15_000_000, Nodes: 1_842, Documents: 1, Frames: 3, JSEventListeners: 12,
    LayoutCount: 34, LayoutDuration: 0.128, RecalcStyleCount: 51, RecalcStyleDuration: 0.064,
    ScriptDuration: 0.21, TaskDuration: 0.64,
  });
  assert.equal(lines[0], "heap 11.8 MB of 14.3 MB · nodes 1842 · documents 1 · frames 3 · JS listeners 12");
  assert.equal(lines[1], "layouts 34 (128 ms) · style recalcs 51 (64 ms)");
  assert.equal(lines[2], "script 210 ms of 640 ms task time (33% of task time)");
});

test("missing counters are left out instead of printed as zero", () => {
  const lines = describeMetrics({ Nodes: 10 });
  assert.equal(lines[0], "nodes 10");
  assert.equal(lines.length, 2);
  assert.match(lines[1] ?? "", /Nothing has rendered or run since the counters were enabled\./u);
  assert.deepEqual(describeMetrics({}), [
    "The browser reported no counters for this page.",
    "Nothing has rendered or run since the counters were enabled. Call performance before the navigation you want to measure, then read it again.",
  ]);
});

test("navigation and paint entries become load and paint lines", () => {
  const lines = describeTimings(
    { firstByte: 312, domContentLoaded: 588, load: 942, transferSize: 412_000, decodedBodySize: 1_200_000, type: "navigate" },
    [{ name: "first-paint", start: 401 }, { name: "first-contentful-paint", start: 520 }],
  );
  assert.equal(lines[0], "Load: first byte 312 ms, DOMContentLoaded 588 ms, load 942 ms · document 402 KB (1.1 MB decoded) · type navigate");
  assert.equal(lines[1], "Paints: first-paint 401 ms, first-contentful-paint 520 ms");
});

test("counters enabled after a load are explained instead of read as an idle page", () => {
  const lines = describeMetrics({ Nodes: 527, LayoutCount: 0, RecalcStyleCount: 0, LayoutDuration: 0, RecalcStyleDuration: 0, ScriptDuration: 0.0004, TaskDuration: 0.0006 });
  assert.equal(lines[1], "layouts 0 (0 ms) · style recalcs 0 (0 ms)");
  assert.match(lines[2] ?? "", /Call performance before the navigation you want to measure/u);
  assert.doesNotMatch(lines.join("\n"), /% of task time/u);
});

test("a page still loading says so rather than reporting zeroes", () => {
  assert.deepEqual(describeTimings(undefined, []), [
    "The page has no navigation timing yet; it may still be loading.",
    "Paints: none reported yet.",
  ]);
});

test("a navigation entry is read as milliseconds and drops a zero load mark", () => {
  const timing = navigationFromEntry({
    responseStart: 120.5, domContentLoadedEventEnd: 300, loadEventEnd: 0,
    transferSize: 4_096, decodedBodySize: 8_192, type: "reload", notANumber: "x",
  });
  assert.deepEqual(timing, {
    firstByte: 120.5, domContentLoaded: 300, transferSize: 4_096, decodedBodySize: 8_192, type: "reload",
  });
  assert.equal(navigationFromEntry(undefined), undefined);
  assert.deepEqual(navigationFromEntry({}), {});
});
