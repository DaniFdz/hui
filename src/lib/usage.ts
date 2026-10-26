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

export function usageChartDays(days: readonly UsageDay[], from: string, to: string): { monthly: boolean; days: UsageDay[] } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const monthly = (end - start) / 86_400_000 >= 366;
  const grouped = new Map<string, UsageMetrics[]>();
  for (const row of days) {
    const key = monthly ? row.date.slice(0, 7) : row.date;
    grouped.set(key, [...(grouped.get(key) ?? []), row.metrics]);
  }
  const result: UsageDay[] = [];
  const cursor = new Date(monthly ? `${from.slice(0, 7)}-01T00:00:00Z` : start);
  while (cursor.valueOf() <= end) {
    const date = cursor.toISOString().slice(0, monthly ? 7 : 10);
    result.push({ date, metrics: sumUsage(grouped.get(date) ?? []) });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { monthly, days: result };
}

export function usageCost(value: Pick<UsageMetrics, "costUsd" | "unpricedCalls">): string {
  return value.costUsd === null ? "Unpriced" : `${value.unpricedCalls ? "≥ " : ""}${usd.format(value.costUsd)}`;
}
