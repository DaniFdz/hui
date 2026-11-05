import assert from "node:assert/strict";
import { test } from "vitest";
import type { UsageDay, UsageMetrics, UsageModel, UsageReport, UsageSession } from "../api/schema/diagnostics.ts";
import { sumUsage, usageChartDays, usageComparison, usageCost, usageDailyCsv, usageDetail, usageErrorDays, usageHeatmap, usageInvestigations, usageOverview, usagePullRequests, usageSessionCsv } from "./usage.ts";

const metrics = (tokens: number, costUsd: number | null): UsageMetrics => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens, costUsd, calls: 1, unpricedCalls: costUsd === null ? 1 : 0, userMessages: 1, assistantMessages: 1, toolResults: 1, errors: 0 });
const model = (name: string, usage: UsageMetrics): UsageModel => ({ provider: "fixture", model: name, metrics: usage });
const day = (date: string, usage: UsageMetrics, models: UsageModel[] = []): UsageDay => ({ date, metrics: usage, models });
const session = (id: string, name: string, usage: UsageMetrics): UsageSession => ({ id, title: id, lastActivityAt: 1, metrics: usage, models: [model(name, usage)], days: [day("2026-10-01", usage, [model(name, usage)])], tools: [{ name: "read", calls: 1, errors: 0, outputChars: 10 }] });

const report: UsageReport = {
  generatedAt: "2026-10-01T00:00:00Z", range: { from: "2026-10-01", to: "2026-10-03", timeZone: "UTC" },
  investigations: [],
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
  assert.deepEqual(all.days[0]?.models.map(({ model: name, metrics: value }) => [name, value.totalTokens]), [["swift", 40], ["large", 20]], "a day names each model by its own tokens");
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
  const rows = [day("2024-02-29", metrics(7, null), [model("swift", metrics(7, null))])];
  const daily = usageChartDays(rows, "2024-02-28", "2024-03-01");
  assert.equal(daily.bucket, "day");
  assert.deepEqual(daily.days.map(({ date, end, metrics }) => [date, end, metrics.totalTokens, metrics.costUsd]), [
    ["2024-02-28", "2024-02-28", 0, null], ["2024-02-29", "2024-02-29", 7, null], ["2024-03-01", "2024-03-01", 0, null],
  ]);

  const weekly = usageChartDays([...rows, day("2024-03-30", metrics(9, 0), [model("large", metrics(9, 0))])], "2024-01-01", "2024-03-30");
  assert.equal(weekly.bucket, "week");
  assert.equal(weekly.days.length, 13);
  assert.deepEqual(weekly.days[0], { date: "2024-01-01", end: "2024-01-06", metrics: sumUsage([]), models: [] });
  assert.deepEqual(weekly.days.find(({ date, end }) => date <= "2024-02-29" && end >= "2024-02-29"), { date: "2024-02-25", end: "2024-03-02", metrics: sumUsage([metrics(7, null)]), models: [model("swift", metrics(7, null))] });
  assert.deepEqual(weekly.days.at(-1), { date: "2024-03-24", end: "2024-03-30", metrics: sumUsage([metrics(9, 0)]), models: [model("large", metrics(9, 0))] });
  for (const [index, bucket] of weekly.days.entries()) {
    assert.ok((Date.parse(bucket.end) - Date.parse(bucket.date)) / 86_400_000 + 1 <= 7, "a week holds seven days at most");
    if (index > 0) assert.equal(Date.parse(bucket.date) - Date.parse(weekly.days[index - 1]!.end), 86_400_000, "weeks cover the range without gaps");
  }

  const monthly = usageChartDays([...rows, day("2025-01-01", metrics(9, 0))], "2024-02-01", "2025-03-01");
  assert.equal(monthly.bucket, "month");
  assert.equal(monthly.days.length, 14);
  assert.deepEqual(monthly.days[0], { date: "2024-02", end: "2024-02-29", metrics: sumUsage([metrics(7, null)]), models: [model("swift", metrics(7, null))] });
  assert.deepEqual(monthly.days.filter(({ metrics }) => metrics.calls).map(({ date, metrics }) => [date, metrics.totalTokens, metrics.costUsd]), [["2024-02", 7, null], ["2025-01", 9, 0]]);
  assert.deepEqual(monthly.days.at(-1), { date: "2025-03", end: "2025-03-31", metrics: sumUsage([]), models: [] });

  assert.equal(usageChartDays([], "2024-01-01", "2024-02-01").bucket, "day", "32 days stay daily");
  assert.equal(usageChartDays([], "2024-01-01", "2024-02-02").bucket, "week", "33 days group by week");
  assert.equal(usageChartDays([], "2024-01-01", "2024-08-11").bucket, "week", "32 weeks stay weekly");
  assert.equal(usageChartDays([], "2024-01-01", "2024-08-12").bucket, "month", "33 weeks group by month");
  assert.equal(usageChartDays([], "2024-01-01", "2024-12-31").bucket, "month", "366 days group by month");
});

test("a bar's detail names its tokens, price, type split and records", () => {
  const mixed = { ...metrics(2048, 0.5), inputTokens: 1000, outputTokens: 400, cacheReadTokens: 648, cacheWriteTokens: 0, calls: 3, unpricedCalls: 1, errors: 1 };
  assert.deepEqual(usageDetail(mixed), ["2,048 tokens · ≥ $0.50", "Input 1,000 · Output 400 · Cache read 648", "3 usage records · 1 unpriced · 1 error"]);
  assert.deepEqual(usageDetail({ ...metrics(0, null), calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, unpricedCalls: 0 }), ["0 tokens · No recorded usage", "0 usage records"]);
  assert.deepEqual(usageDetail({ ...metrics(7, 0), calls: 1, inputTokens: 7, outputTokens: 0, errors: 2 }), ["7 tokens · $0.00", "Input 7", "1 usage record · 2 errors"]);
});

test("the activity calendar keeps empty days, buckets a year by quartile and never paints outside the range", () => {
  const calendar = usageHeatmap([day("2024-02-29", metrics(7, null))], "2024-02-28", "2024-03-01");
  assert.equal(calendar.weeks.length, 1);
  assert.deepEqual(calendar.monthLabels, ["Feb"]);
  assert.deepEqual(calendar.weeks[0]?.map((cell) => cell?.date ?? null), [null, null, null, "2024-02-28", "2024-02-29", "2024-03-01", null]);
  assert.deepEqual(calendar.weeks[0]?.slice(3, 6).map((cell) => [cell?.date, cell?.metrics.totalTokens, cell?.level]), [["2024-02-28", 0, 0], ["2024-02-29", 7, 4], ["2024-03-01", 0, 0]]);

  const year = usageHeatmap(
    [1, 2, 3, 4].map((tokens, index) => day(`2024-0${index + 1}-01`, metrics(tokens, 0))),
    "2023-01-01", "2024-12-31",
  );
  assert.ok(year.weeks.length <= 53, "a calendar covers at most its trailing 52 weeks");
  assert.equal(year.weeks.flat().filter((cell) => cell !== null).length, 364, "the cap trims the oldest days");
  assert.deepEqual(year.weeks.flat().filter((cell) => cell !== null).slice(0, 3).map((cell) => cell?.date), ["2024-01-03", "2024-01-04", "2024-01-05"], "the grid starts at the range's last 364 days");
  const busyDays = year.weeks.flat().filter((cell) => cell !== null && cell.metrics.totalTokens > 0).map((cell) => [cell!.metrics.totalTokens, cell!.level]).toSorted((left, right) => left[0]! - right[0]!);
  assert.equal(busyDays.length, 3, "the trimmed day leaves the calendar");
  assert.ok(busyDays.every(([, level], index) => index === 0 || level! >= busyDays[index - 1]![1]!), "a busier day is never lighter than a quieter one");
  assert.equal(busyDays.at(-1)?.[1], 4, "the busiest day is the darkest");
});

test("days with errors rank by failure rate, and CSVs quote what a spreadsheet would break on", () => {
  const rows = [
    day("2024-03-01", { ...metrics(10, 0), errors: 2, userMessages: 2, assistantMessages: 2 }),
    day("2024-03-02", { ...metrics(10, 0), errors: 0, userMessages: 2, assistantMessages: 2 }),
    day("2024-03-03", { ...metrics(10, 0), errors: 1, userMessages: 10, assistantMessages: 10 }),
    day("2024-03-04", { ...metrics(10, 0), errors: 3, userMessages: 0, assistantMessages: 0 }),
  ];
  assert.deepEqual(usageErrorDays(rows).map((row) => [row.date, row.rate, row.errors, row.messages]), [["2024-03-01", 0.5, 2, 4], ["2024-03-03", 0.05, 1, 20]]);

  const daily = usageDailyCsv([rows[0]!, rows[2]!]);
  assert.equal(daily.split("\n")[0], "date,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,costUsd,unpricedCalls,calls,userMessages,assistantMessages,toolResults,errors");
  assert.match(daily, /^2024-03-01,10,0,0,0,10,0,0,1,2,2,1,2$/mu);

  const sessions = usageSessionCsv([{ ...session("a", "swift", metrics(1, 0)), title: 'Hello, "world"' }]);
  assert.match(sessions, /"Hello, ""world"""/u, "a comma and quote survive the round trip");
  assert.equal(sessions.split("\n")[0], "id,title,parentId,lastActive,models,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,costUsd,unpricedCalls,calls,userMessages,assistantMessages,toolResults,errors");
});

test("the last week is compared with the week before it, inside the range", () => {
  const dayOf = (date: string, tokens: number, extra: Partial<UsageMetrics> = {}) => day(date, { ...metrics(tokens, tokens ? 1 : null), ...extra });
  const days = [
    dayOf("2024-03-01", 10), dayOf("2024-03-02", 20), dayOf("2024-03-03", 30), dayOf("2024-03-04", 40), dayOf("2024-03-05", 50),
    dayOf("2024-03-06", 60), dayOf("2024-03-07", 70), dayOf("2024-03-08", 80), dayOf("2024-03-09", 90), dayOf("2024-03-10", 100),
    dayOf("2024-03-11", 110, { errors: 2 }), dayOf("2024-03-12", 120), dayOf("2024-03-13", 130), dayOf("2024-03-14", 140),
  ];
  const compared = usageComparison(days, "2024-03-01", "2024-03-14");
  assert.equal(compared.window, 7);
  assert.equal(compared.recent.totalTokens, 770, "the range's last seven days");
  assert.equal(compared.previous.totalTokens, 280, "the seven days before them");
  assert.equal(compared.recent.errors, 2);
  assert.equal(usageComparison(days, "2024-03-14", "2024-03-14").window, 0, "a single day has no baseline");
  assert.equal(usageComparison(days, "2024-03-08", "2024-03-14").window, 3, "a week compares three days with three");
});

test("a chart bar sums each model over the days it covers, so a week names every model it used", () => {
  const rows = [day("2026-10-01", metrics(10, 0), [model("swift", metrics(10, 0))]), day("2026-10-02", metrics(20, 0.5), [model("large", metrics(20, 0.5)), model("swift", metrics(5, 0))])];
  const daily = usageChartDays(rows, "2026-10-01", "2026-10-02").days;
  assert.deepEqual(daily.map(({ date, models }) => [date, models.map(({ model: name, metrics: value }) => [name, value.totalTokens])]), [
    ["2026-10-01", [["swift", 10]]], ["2026-10-02", [["large", 20], ["swift", 5]]],
  ]);
  const week = usageChartDays(rows, "2026-08-01", "2026-10-02").days.at(-1);
  assert.equal(week?.date, "2026-09-26", "the last bar covers the week that ends on the range's last day");
  assert.deepEqual(week?.models.map(({ model: name, metrics: value }) => [name, value.totalTokens, value.costUsd]), [["large", 20, 0.5], ["swift", 15, 0]], "one model used on two days counts once");
});

test("the pull-request card groups sessions by the pull requests they created, most expensive first", () => {
  const pullRequest = (repository: string, number: number) => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });
  const rows: UsageSession[] = [
    { ...session("webhook", "large", metrics(20, 0.5)), pullRequests: [pullRequest("acme/web", 12), pullRequest("acme/docs", 7)] },
    { ...session("retry", "swift", metrics(10, 0.25)), pullRequests: [pullRequest("acme/web", 12)] },
    { ...session("plain", "swift", metrics(5, 0.1)) },
  ];
  const grouped = usagePullRequests(rows);
  assert.deepEqual(grouped.map((row) => [`${row.repository}#${row.number}`, row.sessions.map((each) => each.id), row.metrics.totalTokens, row.metrics.costUsd]), [
    ["acme/web#12", ["webhook", "retry"], 30, 0.75],
    ["acme/docs#7", ["webhook"], 20, 0.5],
  ], "a session that created two pull requests counts under each, and a session without one is not a row");
  assert.equal(grouped[0]?.url, "https://github.com/acme/web/pull/12");
  assert.deepEqual(usagePullRequests([]), []);
});

test("the page matches an answered target with the report HUI already started for it", () => {
  const report: UsageReport = {
    generatedAt: "2026-10-02T00:00:00Z", range: { from: "2026-10-01", to: "2026-10-02", timeZone: "UTC" },
    sessions: [], coverage: { registeredSessions: 1, readSessions: 0, unavailable: [], undatedRecords: 0 }, unplacedSpend: { totalTokens: 0, costUsd: 0 },
    investigations: [
      { id: "answered-session", title: "Why was x expensive?", target: { kind: "session", id: "x" }, range: { from: "2026-09-01", to: "2026-09-30", timeZone: "Europe/Madrid" }, createdAt: "2026-10-01T00:00:00Z" },
      { id: "answered-pr", title: "Why was acme/web#12 expensive?", target: { kind: "pullRequest", repository: "Acme/Web", number: 12 }, range: { from: "2026-09-01", to: "2026-09-30", timeZone: "UTC" }, createdAt: "2026-10-01T01:00:00Z" },
    ],
  };
  const answered = usageInvestigations(report);
  assert.equal(answered.get("session:x")?.id, "answered-session");
  assert.equal(answered.get("pullRequest:acme/web#12")?.id, "answered-pr", "a repository matches whatever its case");
  assert.equal(answered.size, 2);
});
