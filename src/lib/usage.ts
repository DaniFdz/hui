/** Combines usage-report rows for the page's session search, rankings and calendar chart. */
import type { UsageDay, UsageMetrics, UsageModel, UsageReport, UsageTool } from "../api/schema/diagnostics.ts";

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
const CHART_DAYS = 42;
const CHART_YEAR = 366;

type UsageChartBucket = { date: string; end: string; metrics: UsageMetrics };

export function usageChartDays(days: readonly UsageDay[], from: string, to: string): { bucket: "day" | "week" | "month"; days: UsageChartBucket[] } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const count = Math.round((end - start) / DAY_MS) + 1;
  const bucket = count >= CHART_YEAR ? "month" : count > CHART_DAYS ? "week" : "day";
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

export function usageCost(value: Pick<UsageMetrics, "costUsd" | "unpricedCalls">): string {
  return value.costUsd === null ? "Unpriced" : `${value.unpricedCalls ? "≥ " : ""}${usd.format(value.costUsd)}`;
}
