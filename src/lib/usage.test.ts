import assert from "node:assert/strict";
import { test } from "vitest";
import type { UsageMetrics, UsageReport, UsageSession } from "../api/schema/diagnostics.ts";
import { sumUsage, usageChartDays, usageCost, usageOverview } from "./usage.ts";

const metrics = (tokens: number, costUsd: number | null): UsageMetrics => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens, costUsd, calls: 1, unpricedCalls: costUsd === null ? 1 : 0, userMessages: 1, assistantMessages: 1, toolResults: 1, errors: 0 });
const session = (id: string, model: string, usage: UsageMetrics): UsageSession => ({ id, title: id, lastActivityAt: 1, metrics: usage, models: [{ provider: "fixture", model, metrics: usage }], days: [{ date: "2026-10-01", metrics: usage }], tools: [{ name: "read", calls: 1, errors: 0 }] });

const report: UsageReport = {
  generatedAt: "2026-10-01T00:00:00Z", range: { from: "2026-10-01", to: "2026-10-03", timeZone: "UTC" },
  coverage: { registeredSessions: 3, readSessions: 3, unavailable: [], undatedRecords: 0 },
  unplacedSpend: { totalTokens: 0, costUsd: 0 },
  sessions: [session("free", "swift", metrics(10, 0)), session("unknown", "swift", metrics(30, null)), session("paid", "large", metrics(20, 0.5))],
};

test("a session search changes every total and ranking, and zero-priced sessions sort before unpriced ones", () => {
  const all = usageOverview(report, "", "cost");
  assert.deepEqual(all.sessions.map(({ id }) => id), ["paid", "free", "unknown"]);
  assert.equal(all.totals.totalTokens, 60);
  assert.equal(all.totals.costUsd, 0.5);
  assert.equal(all.totals.unpricedCalls, 1);
  assert.equal(all.models.find(({ model }) => model === "swift")?.metrics.costUsd, 0);
  assert.equal(all.days[0]?.metrics.totalTokens, 60);
  assert.equal(all.tools[0]?.calls, 3);
  const filtered = usageOverview(report, "  FIXTURE/LARGE ", "tokens");
  assert.equal(filtered.totals.totalTokens, 20);
  assert.equal(filtered.totals.unpricedCalls, 0);
  assert.equal(filtered.providers[0]?.metrics.costUsd, 0.5);
  assert.equal(filtered.days[0]?.metrics.totalTokens, 20);
  assert.equal(filtered.tools[0]?.calls, 1);
  assert.equal(usageOverview(report, "no matches", "recent").totals.costUsd, null);
  assert.equal(usageCost(metrics(1, 0)), "$0.00");
  assert.equal(usageCost(metrics(1, null)), "Unpriced");
  assert.match(usageCost(sumUsage([metrics(1, 0), metrics(1, null)])), /^≥ \$0\.00/u);
});

test("the chart keeps empty days and leap days, groups wide ranges by week and long ones by month", () => {
  const rows = [{ date: "2024-02-29", metrics: metrics(7, null) }];
  const daily = usageChartDays(rows, "2024-02-28", "2024-03-01");
  assert.equal(daily.bucket, "day");
  assert.deepEqual(daily.days.map(({ date, end, metrics }) => [date, end, metrics.totalTokens, metrics.costUsd]), [
    ["2024-02-28", "2024-02-28", 0, null], ["2024-02-29", "2024-02-29", 7, null], ["2024-03-01", "2024-03-01", 0, null],
  ]);

  const weekly = usageChartDays([...rows, { date: "2024-03-30", metrics: metrics(9, 0) }], "2024-01-01", "2024-03-30");
  assert.equal(weekly.bucket, "week");
  assert.equal(weekly.days.length, 13);
  assert.deepEqual(weekly.days[0], { date: "2024-01-01", end: "2024-01-06", metrics: sumUsage([]) });
  assert.deepEqual(weekly.days.find(({ date, end }) => date <= "2024-02-29" && end >= "2024-02-29"), { date: "2024-02-25", end: "2024-03-02", metrics: sumUsage([metrics(7, null)]) });
  assert.deepEqual(weekly.days.at(-1), { date: "2024-03-24", end: "2024-03-30", metrics: sumUsage([metrics(9, 0)]) });
  for (const [index, bucket] of weekly.days.entries()) {
    assert.ok((Date.parse(bucket.end) - Date.parse(bucket.date)) / 86_400_000 + 1 <= 7, "a week holds seven days at most");
    if (index > 0) assert.equal(Date.parse(bucket.date) - Date.parse(weekly.days[index - 1]!.end), 86_400_000, "weeks cover the range without gaps");
  }

  const monthly = usageChartDays([...rows, { date: "2025-01-01", metrics: metrics(9, 0) }], "2024-02-01", "2025-03-01");
  assert.equal(monthly.bucket, "month");
  assert.equal(monthly.days.length, 14);
  assert.deepEqual(monthly.days[0], { date: "2024-02", end: "2024-02-29", metrics: sumUsage([metrics(7, null)]) });
  assert.deepEqual(monthly.days.filter(({ metrics }) => metrics.calls).map(({ date, metrics }) => [date, metrics.totalTokens, metrics.costUsd]), [["2024-02", 7, null], ["2025-01", 9, 0]]);
  assert.deepEqual(monthly.days.at(-1), { date: "2025-03", end: "2025-03-31", metrics: sumUsage([]) });

  assert.equal(usageChartDays([], "2024-01-01", "2024-02-01").bucket, "day", "32 days stay daily");
  assert.equal(usageChartDays([], "2024-01-01", "2024-02-02").bucket, "week", "33 days group by week");
  assert.equal(usageChartDays([], "2024-01-01", "2024-08-11").bucket, "week", "32 weeks stay weekly");
  assert.equal(usageChartDays([], "2024-01-01", "2024-08-12").bucket, "month", "33 weeks group by month");
  assert.equal(usageChartDays([], "2024-01-01", "2024-12-31").bucket, "month", "366 days group by month");
});
