/** Activity, Logs, Debug and Usage say they are reading, say Refreshing while Refresh reloads, and recover from a failed read with Retry; Debug's Snapshots lists the gateway's vitals and what exports leave out, and Usage totals tokens, cost, models and partial totals (PAGE-018, PAGE-020, PAGE-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const usage = { sessions: 0, filesRead: 0, records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: null, models: [], unavailable: [] };
const metrics = { inputTokens: 42, outputTokens: 29, cacheReadTokens: 11, cacheWriteTokens: 6, totalTokens: 88, costUsd: null, unpricedCalls: 3, calls: 5, userMessages: 2, assistantMessages: 3, toolResults: 4, errors: 1 };
const usageReport = {
  generatedAt: "2026-01-02T03:04:05.000Z",
  range: { from: "2026-01-02", to: "2026-01-31", timeZone: "UTC" },
  sessions: [{
    id: "usage-fixture",
    title: "Fixture session",
    lastActivityAt: Date.parse("2026-01-02T03:00:00.000Z"),
    metrics,
    days: [{ date: "2026-01-02", metrics }],
    models: [{ provider: "hui-e2e", model: "fixture", metrics }],
    tools: [{ name: "bash", calls: 4, errors: 1 }],
  }],
  coverage: { registeredSessions: 1, readSessions: 1, unavailable: [{ sessionId: "usage-missing", reason: "unreadable" }], undatedRecords: 0 },
  unplacedSpend: { totalTokens: 0, costUsd: 0 },
};

test("Activity, Logs, Debug and Usage read while loading, refuse a failed read with Retry, and say Refreshing while Refresh reloads", { tags: ["PAGE-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reading = screen.getByText(/^Reading HUI diagnostics…/u);
  const failure = screen.getByText(/diagnostics are unavailable/u);
  const refresh = screen.getByRole("button", "Refresh");
  const reloading = screen.getByRole("button", "Refreshing…");
  const observability = /\/__hui\/observability$/u;
  const usageRoute = /\/__hui\/usage\?/u;
  const pages = [["/activity", screen.getByLabel("activity"), observability], ["/logs", screen.getByLabel("logs"), observability], ["/debug", screen.getByText("Snapshots", { exact: true }), observability], ["/usage", screen.getByText("Total tokens", { exact: true }), usageRoute]] as const;

  for (const [path, marker, endpoint] of pages) {
    const first = await hui.intercept("GET", endpoint);
    await hui.open(path);
    await first.arrived();
    await expect(reading).toBeVisible();
    await expect(marker).toBeHidden();
    await first.reject(500, "diagnostics are unavailable");
    await expect(failure).toBeVisible();
    await expect(reading).toBeHidden();

    const retried = await hui.intercept("GET", endpoint);
    await screen.getByRole("button", "Retry").tap();
    await retried.arrived();
    await expect(reloading).toBeVisible();
    await retried.deliver();
    await expect(marker).toBeVisible();
    await expect(failure).toBeHidden();
    await expect(reading).toBeHidden();

    const again = await hui.intercept("GET", endpoint);
    await refresh.tap();
    await again.arrived();
    await expect(reloading).toBeVisible();
    await expect(refresh).toBeHidden();
    await again.deliver();
    await expect(refresh).toBeVisible();
    await expect(reloading).toBeHidden();
  }
});

test("Debug's Snapshots lists the gateway's status and transport, its Node runtime and platform, memory in use, the events since it started and what exports leave out", { tags: ["PAGE-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const health = await hui.api<{ status: string; transport: string }>("GET", "/__hui/health");
  const snapshot = {
    generatedAt: "2026-01-02T03:04:05.000Z",
    retention: { kind: "memory", maximum: 300, since: "2026-01-02T03:00:00.000Z" },
    activity: [],
    logs: [],
    usage,
    debug: { node: "v24.14.0", "platform": "darwin", uptimeSeconds: 12, memory: { rssBytes: 123456789, heapUsedBytes: 23456789, heapTotalBytes: 45678901 }, eventCount: 321 },
  };
  const reading = await hui.intercept("GET", /\/__hui\/observability$/u);

  await hui.open("/debug");
  await reading.arrived();
  await reading.answer(JSON.stringify(snapshot));

  await expect(screen.getByText("Snapshots", { exact: true })).toBeVisible();
  await expect(screen.getByText(health.status, { exact: true })).toBeVisible();
  await expect(screen.getByText(health.transport, { exact: true })).toBeVisible();
  await expect(screen.getByText("v24.14.0", { exact: true })).toBeVisible();
  await expect(screen.getByText("darwin", { exact: true })).toBeVisible();
  await expect(screen.getByText("117.7 MB", { exact: true })).toBeVisible();
  await expect(screen.getByText("22.4 MB heap used", { exact: true })).toBeVisible();
  await expect(screen.getByText("321", { exact: true })).toBeVisible();
  await expect(screen.getByText("Since gateway start", { exact: true })).toBeVisible();
  await expect(screen.getByText("Exports contain operational metadata and redacted failure causes. HUI never includes prompt text, tool arguments/output, credentials or secret values.")).toBeVisible();
});
test("Usage shows total tokens, PI cost estimate and sessions, the chart's input, output, cache-read and cache-write tokens, the top models and its partial-totals and unplaced-spend notes", { tags: ["PAGE-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reading = await hui.intercept("GET", /\/__hui\/usage\?/u);

  await hui.open("/usage");
  await reading.arrived();
  await reading.answer(JSON.stringify(usageReport));

  await expect(screen.getByText("Total tokens", { exact: true })).toBeVisible();
  await expect(screen.getByText("88", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("5 usage records", { exact: true })).toBeVisible();
  await expect(screen.getByText("PI cost estimate", { exact: true })).toBeVisible();
  await expect(screen.getByText("Unpriced", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("3 unpriced records", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 local history read · 1 registered session", { exact: true })).toBeVisible();
  await expect(screen.getByText("Daily token usage", { exact: true })).toBeVisible();
  await expect(screen.getByText("2026-01-02 to 2026-01-31 · UTC", { exact: true })).toBeVisible();
  await expect(screen.getByText("Input 42", { exact: true })).toBeVisible();
  await expect(screen.getByText("11 cache-read tokens", { exact: true })).toBeVisible();
  await expect(screen.getByText("Output 29", { exact: true })).toBeVisible();
  await expect(screen.getByText("Cache write 6", { exact: true })).toBeVisible();
  await expect(screen.getByText("Cache read 11", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 user · 3 assistant", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 tool recorded", { exact: true })).toBeVisible();
  await expect(screen.getByText("18.6%", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 / 5", { exact: true })).toBeVisible();
  await expect(screen.getByText("hui-e2e/fixture", { exact: true })).toBeVisible();
  await expect(screen.getByText("88 tokens", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("Totals are partial. 1 histories unavailable; 0 records without valid dates were excluded.", { exact: true })).toBeVisible();

  const bare = await hui.intercept("GET", /\/__hui\/usage\?/u);
  await hui.reload();
  await bare.arrived();
  await bare.answer(JSON.stringify({
    ...usageReport,
    sessions: [],
    coverage: { registeredSessions: 0, readSessions: 0, unavailable: [], undatedRecords: 0 },
    unplacedSpend: { totalTokens: 12, costUsd: 0.25 },
  }));
  await expect(screen.getByText("No usage in this range.", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^Also recorded outside these entries: 12 tokens, \$0\.25, for all recorded time\./u)).toBeVisible();
  await expect(screen.getByText("Unavailable", { exact: true }).first()).toBeVisible();
});
