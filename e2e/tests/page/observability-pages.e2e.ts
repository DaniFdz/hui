/** Activity, Logs, Debug and Usage say they are reading, say Refreshing while Refresh reloads, and recover from a failed read with Retry; Debug's Snapshots lists the gateway's vitals and what exports leave out, and Usage totals tokens, cost, models and partial totals (PAGE-018, PAGE-020, PAGE-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const usage = { sessions: 0, filesRead: 0, records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: null, models: [], unavailable: [] };

test("Activity, Logs, Debug and Usage read while loading, refuse a failed read with Retry, and say Refreshing while Refresh reloads", { tags: ["PAGE-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reading = screen.getByText(/^Reading HUI diagnostics…/u);
  const failure = screen.getByText(/^diagnostics are unavailable/u);
  const refresh = screen.getByRole("button", "Refresh");
  const reloading = screen.getByRole("button", "Refreshing…");
  const observability = /\/__hui\/observability$/u;
  const pages = [["/activity", screen.getByLabel("activity")], ["/logs", screen.getByLabel("logs")], ["/debug", screen.getByText("Snapshots", { exact: true })], ["/usage", screen.getByText("Total tokens", { exact: true })]] as const;

  for (const [path, marker] of pages) {
    const first = await hui.intercept("GET", observability);
    await hui.open(path);
    await first.arrived();
    await expect(reading).toBeVisible();
    await expect(marker).toBeHidden();
    await first.reject(500, "diagnostics are unavailable");
    await expect(failure).toBeVisible();
    await expect(reading).toBeHidden();

    const retried = await hui.intercept("GET", observability);
    await screen.getByRole("button", "Retry").tap();
    await retried.arrived();
    await expect(reloading).toBeVisible();
    await retried.deliver();
    await expect(marker).toBeVisible();
    await expect(failure).toBeHidden();
    await expect(reading).toBeHidden();

    const again = await hui.intercept("GET", observability);
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
test("Usage shows total tokens with the transcripts read, input with cache-read, output with cache-write, Cost or Unavailable, tokens per model and the partial-totals warning", { tags: ["PAGE-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const counted = {
    sessions: 3, filesRead: 2, records: 9, inputTokens: 642, outputTokens: 229, cacheReadTokens: 131, cacheWriteTokens: 61, totalTokens: 871, costUsd: null,
    models: [{ model: "hui-e2e/fixture", tokens: 517 }, { model: "other/model", tokens: 354 }],
    unavailable: ["one.jsonl"],
  };
  const reading = await hui.intercept("GET", /\/__hui\/observability$/u);

  await hui.open("/usage");
  await reading.arrived();
  await reading.answer(JSON.stringify({
    generatedAt: "2026-01-02T03:04:05.000Z",
    retention: { kind: "memory", maximum: 300, since: "2026-01-02T03:00:00.000Z" },
    activity: [],
    logs: [],
    usage: counted,
    debug: { node: "v24.14.0", "platform": "darwin", uptimeSeconds: 12, memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 1 }, eventCount: 1 },
  }));

  await expect(screen.getByText("Total tokens", { exact: true })).toBeVisible();
  await expect(screen.getByText("871", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 PI transcripts read", { exact: true })).toBeVisible();
  await expect(screen.getByText("Input", { exact: true })).toBeVisible();
  await expect(screen.getByText("642", { exact: true })).toBeVisible();
  await expect(screen.getByText("131 cache-read", { exact: true })).toBeVisible();
  await expect(screen.getByText("Output", { exact: true })).toBeVisible();
  await expect(screen.getByText("229", { exact: true })).toBeVisible();
  await expect(screen.getByText("61 cache-write", { exact: true })).toBeVisible();
  await expect(screen.getByText("Cost", { exact: true })).toBeVisible();
  await expect(screen.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(screen.getByText("hui-e2e/fixture", { exact: true })).toBeVisible();
  await expect(screen.getByText("517", { exact: true })).toBeVisible();
  await expect(screen.getByText("other/model", { exact: true })).toBeVisible();
  await expect(screen.getByText("354", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 transcript was unavailable. Totals are partial.", { exact: true })).toBeVisible();

  const bare = await hui.intercept("GET", /\/__hui\/observability$/u);
  await hui.reload();
  await bare.arrived();
  await bare.answer(JSON.stringify({
    generatedAt: "2026-01-02T03:04:05.000Z",
    retention: { kind: "memory", maximum: 300, since: "2026-01-02T03:00:00.000Z" },
    activity: [],
    logs: [],
    usage: { ...counted, totalTokens: 0, models: [], unavailable: [], costUsd: 3.5 },
    debug: { node: "v24.14.0", "platform": "darwin", uptimeSeconds: 12, memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 1 }, eventCount: 1 },
  }));
  await expect(screen.getByText("No token metadata is available yet.", { exact: true })).toBeVisible();
  await expect(screen.getByText("$3.5000", { exact: true })).toBeVisible();
  await expect(screen.getByText("Unavailable", { exact: true })).toBeHidden();
});
