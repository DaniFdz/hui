/** Combines usage-report rows for the page's session search, rankings and calendar chart. */
import type { UsageDay, UsageMetrics, UsageModel, UsageReport, UsageSession, UsageTool } from "../api/schema/diagnostics.ts";

export type UsageSort = "recent" | "tokens" | "cost";
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const USAGE_COUNTERS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "unpricedCalls", "calls", "userMessages", "assistantMessages", "toolResults", "errors"] as const;

export function sumUsage(rows: readonly UsageMetrics[]): UsageMetrics {
  const result: UsageMetrics = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: null, unpricedCalls: 0, calls: 0, userMessages: 0, assistantMessages: 0, toolResults: 0, errors: 0 };
  for (const row of rows) {
    for (const key of USAGE_COUNTERS) result[key] += row[key];
    if (row.costUsd !== null) result.costUsd = (result.costUsd ?? 0) + row.costUsd;
  }
  return result;
}

export function usageOverview(report: UsageReport, query: string, sort: UsageSort) {
  const search = query.trim().toLocaleLowerCase();
  const sessions = report.sessions.filter((session) => !search || [session.title, session.id, ...session.models.map(({ model, provider }) => `${provider}/${model}`)].join(" ").toLocaleLowerCase().includes(search));
  sessions.sort((a, b) => (sort === "cost" ? (b.metrics.costUsd ?? -1) - (a.metrics.costUsd ?? -1) : sort === "tokens" ? b.metrics.totalTokens - a.metrics.totalTokens : b.lastActivityAt - a.lastActivityAt) || a.title.localeCompare(b.title));
  const models = new Map<string, UsageModel>();
  const days = new Map<string, UsageDay>();
  const tools = new Map<string, UsageTool>();
  for (const session of sessions) {
    for (const row of session.models) {
      const key = JSON.stringify([row.provider, row.model]);
      const previous = models.get(key);
      models.set(key, { ...row, metrics: sumUsage(previous ? [previous.metrics, row.metrics] : [row.metrics]) });
    }
    for (const row of session.days) {
      const previous = days.get(row.date);
      days.set(row.date, { date: row.date, metrics: sumUsage(previous ? [previous.metrics, row.metrics] : [row.metrics]) });
    }
    for (const row of session.tools) {
      const previous = tools.get(row.name);
      tools.set(row.name, { name: row.name, calls: (previous?.calls ?? 0) + row.calls, errors: (previous?.errors ?? 0) + row.errors });
    }
  }
  const rankedModels = [...models.values()].sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens);
  const providers = new Map<string, UsageMetrics[]>();
  for (const row of rankedModels) providers.set(row.provider, [...(providers.get(row.provider) ?? []), row.metrics]);
  return {
    sessions, totals: sumUsage(sessions.map(({ metrics }) => metrics)), days: [...days.values()], models: rankedModels,
    providers: [...providers].map(([provider, rows]) => ({ provider, metrics: sumUsage(rows) })).sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens),
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
  };
}

const DAY_MS = 86_400_000;
const CHART_BARS = 32;

type UsageChartBucket = { date: string; end: string; metrics: UsageMetrics };

export function usageChartDays(days: readonly UsageDay[], from: string, to: string): { bucket: "day" | "week" | "month"; days: UsageChartBucket[] } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const count = Math.round((end - start) / DAY_MS) + 1;
  const bucket = count <= CHART_BARS ? "day" : Math.ceil(count / 7) <= CHART_BARS ? "week" : "month";
  const bounds: { start: number; end: number }[] = [];
  if (bucket === "month") {
    for (let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7)) - 1; ;) {
      const first = Date.UTC(year, month, 1);
      if (first > end) break;
      bounds.push({ start: first, end: Date.UTC(year, month + 1, 1) - DAY_MS });
      if (++month === 12) { month = 0; year += 1; }
    }
  } else if (bucket === "week") {
    for (let last = end; last >= start; last -= 7 * DAY_MS) bounds.push({ start: Math.max(start, last - 6 * DAY_MS), end: last });
    bounds.reverse();
  } else {
    for (let at = start; at <= end; at += DAY_MS) bounds.push({ start: at, end: at });
  }
  const recorded = new Map<number, UsageMetrics>();
  for (const row of days) {
    const at = Date.parse(`${row.date}T00:00:00Z`);
    const held = recorded.get(at);
    recorded.set(at, held ? sumUsage([held, row.metrics]) : row.metrics);
  }
  return {
    bucket,
    days: bounds.map(({ start: first, end: last }) => {
      const parts: UsageMetrics[] = [];
      for (let at = first; at <= last; at += DAY_MS) {
        const held = recorded.get(at);
        if (held) parts.push(held);
      }
      const date = new Date(first).toISOString().slice(0, 10);
      return { date: bucket === "month" ? date.slice(0, 7) : date, end: new Date(last).toISOString().slice(0, 10), metrics: sumUsage(parts) };
    }),
  };
}

type HeatmapCell = { date: string; metrics: UsageMetrics; level: number };

/** The counters a CSV carries, in the order a spreadsheet expects them. */
const CSV_COUNTERS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUsd", "unpricedCalls", "calls", "userMessages", "assistantMessages", "toolResults", "errors"] as const;

/** Days as a Sunday-first calendar grid, capped at its last 52 weeks; days outside the range stay empty. */
export function usageHeatmap(days: readonly UsageDay[], from: string, to: string): { weeks: (HeatmapCell | null)[][]; monthLabels: string[] } {
  const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);
  const start = Math.max(noon(from), noon(to) - (52 * 7 - 1) * DAY_MS);
  const end = noon(to);
  const recorded = new Map(days.map((day) => [day.date, day.metrics]));
  const busy = days.filter((day) => day.metrics.totalTokens > 0).map((day) => day.metrics.totalTokens).toSorted((left, right) => left - right);
  const quartile = (ratio: number) => busy[Math.min(busy.length - 1, Math.floor(busy.length * ratio))] ?? 0;
  const thresholds = [quartile(0.25), quartile(0.5), quartile(0.75)];
  const level = (tokens: number) => (tokens <= 0 ? 0 : tokens < thresholds[0]! ? 1 : tokens < thresholds[1]! ? 2 : tokens < thresholds[2]! ? 3 : 4);
  const monthOf = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
  const weeks: (HeatmapCell | null)[][] = [];
  const monthLabels: string[] = [];
  let previousMonth = -1;
  for (let week = start - new Date(start).getUTCDay() * DAY_MS; week <= end; week += 7 * DAY_MS) {
    const cells: (HeatmapCell | null)[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const at = week + weekday * DAY_MS;
      if (at < start || at > end) { cells.push(null); continue; }
      const date = new Date(at).toISOString().slice(0, 10);
      const metrics = recorded.get(date) ?? sumUsage([]);
      cells.push({ date, metrics, level: level(metrics.totalTokens) });
    }
    weeks.push(cells);
    const first = cells.find((cell): cell is HeatmapCell => cell !== null);
    if (!first) { monthLabels.push(""); continue; }
    const month = new Date(noon(first.date)).getUTCMonth();
    monthLabels.push(month === previousMonth ? "" : monthOf.format(new Date(noon(first.date))));
    previousMonth = month;
  }
  return { weeks, monthLabels };
}

/** The days where recorded failures were most common, as an insight list. */
export function usageErrorDays(days: readonly UsageDay[], limit = 5): { date: string; rate: number; errors: number; messages: number }[] {
  return days
    .map(({ date, metrics }) => ({ date, errors: metrics.errors, messages: metrics.userMessages + metrics.assistantMessages, rate: metrics.errors / Math.max(1, metrics.userMessages + metrics.assistantMessages) }))
    .filter((day) => day.errors > 0 && day.messages > 0)
    .toSorted((left, right) => right.rate - left.rate || right.errors - left.errors || left.date.localeCompare(right.date))
    .slice(0, limit);
}

/** One CSV line per day, with the counters a spreadsheet can sum. */
export function usageDailyCsv(days: readonly UsageDay[]): string {
  return ["date", ...CSV_COUNTERS].join(",") + "\n" + days.map(({ date, metrics }) => [date, ...CSV_COUNTERS.map((key) => metrics[key] ?? "")].join(",")).join("\n") + "\n";
}

/** One CSV line per session row the page shows, with its models and counters. */
export function usageSessionCsv(sessions: readonly UsageSession[]): string {
  const cell = (value: string | number | null) => (/[",\n]/u.test(String(value)) ? `"${String(value).replace(/"/gu, '""')}"` : String(value));
  return [["id", "title", "parentId", "lastActive", "models", ...CSV_COUNTERS].join(",")]
    .concat(sessions.map((session) => [
      session.id, session.title, session.parentId ?? "", new Date(session.lastActivityAt).toISOString(),
      session.models.map(({ provider, model }) => `${provider}/${model}`).join(" "),
      ...CSV_COUNTERS.map((key) => session.metrics[key]),
    ].map(cell).join(",")))
    .join("\n") + "\n";
}

export function usageCost(value: Pick<UsageMetrics, "costUsd" | "unpricedCalls">): string {
  return value.costUsd === null ? "Unpriced" : `${value.unpricedCalls ? "≥ " : ""}${usd.format(value.costUsd)}`;
}

const exact = new Intl.NumberFormat().format;
const TYPE_PARTS = [["inputTokens", "Input"], ["outputTokens", "Output"], ["cacheWriteTokens", "Cache write"], ["cacheReadTokens", "Cache read"]] as const;

/** What one chart bucket recorded, as the lines a bar's hover and selection show. */
export function usageDetail(value: UsageMetrics): string[] {
  const types = TYPE_PARTS.filter(([key]) => value[key] > 0).map(([key, label]) => `${label} ${exact(value[key])}`);
  const records = `${exact(value.calls)} usage ${value.calls === 1 ? "record" : "records"}`;
  return [
    `${exact(value.totalTokens)} tokens · ${value.calls ? usageCost(value) : "No recorded usage"}`,
    ...(types.length ? [types.join(" · ")] : []),
    [records, ...(value.unpricedCalls ? [`${exact(value.unpricedCalls)} unpriced`] : []), ...(value.errors ? [`${exact(value.errors)} ${value.errors === 1 ? "error" : "errors"}`] : [])].join(" · "),
  ];
}
