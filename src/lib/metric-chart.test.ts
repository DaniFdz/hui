import assert from "node:assert/strict";
import { test } from "vitest";
import type { HostMetrics } from "../api/schema/host.ts";
import { CHART_METRICS, CHART_METRIC_KEYS, chartSeries, snapTime, valueAt } from "./metric-chart.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");

function sample(secondsAgo: number, overrides: Partial<HostMetrics> = {}): HostMetrics {
  return {
    sampledAt: new Date(NOW - secondsAgo * 1_000).toISOString(),
    host: { platform: "darwin", cores: 8 },
    cpu: { percent: 40, load: [1, 1, 1] },
    memory: { totalBytes: 100, usedBytes: 25 },
    disk: { path: "/config", totalBytes: 100, usedBytes: 50 },
    network: { rxBytesPerSecond: 1_000, txBytesPerSecond: 2_000 },
    gpu: null,
    gateway: { cpuPercent: 12, rssBytes: 1 },
    ...overrides,
  };
}

test("a point sits where its sample is in the window and how full the axis it is", () => {
  const { top, series } = chartSeries([[sample(300), sample(150), sample(0, { cpu: { percent: 80, load: [1, 1, 1] } })]], "cpu", 5, NOW);
  assert.equal(top, 80, "a utilization axis follows the busiest sample");
  assert.deepEqual(series[0]?.points, [
    { x: 0, y: 0.5, at: NOW - 300_000 }, { x: 0.5, y: 0.5, at: NOW - 150_000 }, { x: 1, y: 1, at: NOW },
  ]);
  assert.equal(series[0]?.latest, 80);
  assert.equal(chartSeries([[sample(0, { cpu: { percent: 3, load: [1, 1, 1] } })]], "cpu", 5, NOW).top, 10, "an idle machine's axis stops at a tenth, not at its noise");
  assert.equal(chartSeries([[sample(0, { memory: { totalBytes: 100, usedBytes: 12 } })]], "memory", 5, NOW).top, 100, "how full a disk is keeps its full scale");
});

test("each metric reads its own value, and memory and disk are shares of their totals", () => {
  const one = sample(0, { memory: { totalBytes: 200, usedBytes: 50 }, disk: { path: "/", totalBytes: 10, usedBytes: 9 } });
  const value = (metric: Parameters<typeof chartSeries>[1]) => chartSeries([[one]], metric, 5, NOW).series[0]?.latest;
  assert.equal(value("memory"), 25);
  assert.equal(value("disk"), 90);
  assert.equal(value("network"), 3_000, "receive and transmit together");
  assert.equal(value("process"), 12);
  assert.equal(value("gpu"), null, "a machine without one has no point");
});

test("a machine's line leaves out what it cannot report, and the window leaves out what is old", () => {
  const samples = [sample(280), sample(150, { gpu: { percent: 30 } }), sample(60, { gpu: { percent: 50 } })];
  const gpu = chartSeries([samples], "gpu", 5, NOW);
  assert.equal(gpu.top, 50);
  assert.deepEqual(gpu.series[0]?.points.map((point) => point.y), [0.6, 1], "the sample without a GPU is not a zero");
  assert.equal(chartSeries([samples], "cpu", 5, NOW).series[0]?.points.length, 3, "five minutes hold all three");
  assert.equal(chartSeries([samples], "cpu", 1, NOW).series[0]?.points.length, 1, "one minute holds the newest");
});

test("machines share one axis, which a rate metric stretches to the busiest machine", () => {
  const quiet = [sample(0, { network: { rxBytesPerSecond: 500, txBytesPerSecond: 500 } })];
  const busy = [sample(0, { network: { rxBytesPerSecond: 3_000, txBytesPerSecond: 1_000 } })];
  const chart = chartSeries([quiet, busy], "network", 5, NOW);
  assert.equal(chart.top, 4_000);
  assert.deepEqual(chart.series.map((series) => series.points.map((point) => point.y)), [[0.25], [1]]);
  assert.equal(chartSeries([quiet], "process", 5, NOW).top, 12, "a process share is no percentage: its axis follows it");
  assert.equal(chartSeries([[sample(0, { gateway: { cpuPercent: 0, rssBytes: 1 } })]], "process", 5, NOW).top, 10, "and never draws idle noise as a mountain");
  assert.equal(chartSeries([[sample(0, { gateway: { cpuPercent: 42, rssBytes: 1 } })]], "process", 5, NOW).top, 42, "and follows a busy one");
});

test("every metric offers a label and a reading for the switch", () => {
  assert.deepEqual(CHART_METRIC_KEYS, ["cpu", "memory", "disk", "gpu", "network", "process"]);
  const one = sample(0);
  for (const key of CHART_METRIC_KEYS) {
    assert.ok(CHART_METRICS[key].label.length > 0);
    const value = CHART_METRICS[key].read(one);
    assert.ok(value === null || Number.isFinite(value), key);
  }
});

test("a hover names a time something was read at, and each line answers with its nearest sample", () => {
  const quiet = chartSeries([[sample(300), sample(60)]], "cpu", 5, NOW).series[0]!;
  const busy = chartSeries([[sample(240), sample(15, { cpu: { percent: 90, load: [1, 1, 1] } })]], "cpu", 5, NOW).series[0]!;
  assert.equal(snapTime([quiet, busy], NOW - 59_000), NOW - 60_000, "the nearest sample across the machines");
  assert.equal(snapTime([quiet, busy], NOW - 20_000), NOW - 15_000);
  assert.equal(snapTime([], NOW), null, "nothing to snap to");
  const snapped = snapTime([quiet, busy], NOW - 20_000)!;
  assert.equal(valueAt(quiet, snapped)?.at, NOW - 60_000, "a line answers with its own nearest sample");
  assert.equal(valueAt(busy, snapped)?.at, NOW - 15_000);
  assert.equal(valueAt(quiet, NOW - 180_000), null, "a line with nothing near that instant says nothing");
  assert.equal(valueAt(undefined, NOW), null);
});
