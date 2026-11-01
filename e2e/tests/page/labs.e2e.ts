/** Labs' Dense observability packs Activity and Logs rows closer and restores the normal spacing when off, and its Detailed debug adds Debug's Runtime detail with the heap total and snapshot time, changes no PI configuration, and both switches survive a reload (PAGE-022, PAGE-023). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const usage = { sessions: 0, filesRead: 0, records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: null, models: [], unavailable: [] };
const logs = [
  { id: 2, timestamp: "2026-01-02T03:03:00.000Z", area: "ui", level: "warning", action: "alpha", summary: "Dense row alpha", detail: "First cause" },
  { id: 1, timestamp: "2026-01-02T03:02:00.000Z", area: "runtime", level: "error", action: "beta", summary: "Dense row beta", detail: "Second cause" },
];
const activity = [
  { id: 2, timestamp: "2026-01-02T03:03:00.000Z", area: "session", level: "info", action: "settled", summary: "Dense event alpha" },
  { id: 1, timestamp: "2026-01-02T03:02:00.000Z", area: "runtime", level: "info", action: "ready", summary: "Dense event beta" },
];
const snapshot = JSON.stringify({
  generatedAt: "2026-01-02T03:04:05.000Z",
  retention: { kind: "memory", maximum: 300, since: "2026-01-02T03:00:00.000Z" },
  activity,
  logs,
  usage,
  debug: { node: "v24.14.0", "platform": "darwin", uptimeSeconds: 12, memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 45678901 }, eventCount: 1 },
});

test("Dense observability packs Activity and Logs rows closer, normal spacing returns when it is off, and the switch survives a reload", { tags: ["PAGE-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const dense = screen.getByRole("switch", "Dense observability");
  const gap = async (first: ReturnType<typeof screen.getByText>, second: ReturnType<typeof screen.getByText>) =>
    (await second.boundingBox())!.y - (await first.boundingBox())!.y;
  const crafted = async (path: string) => {
    const reading = await hui.intercept("GET", /\/__hui\/observability$/u);
    await hui.open(path);
    await reading.arrived();
    await reading.answer(snapshot);
  };
  const logsGap = async () => gap(screen.getByText(/^alpha: Dense row alpha/u), screen.getByText(/^beta: Dense row beta/u));
  const activityGap = async () => gap(screen.getByText("Dense event alpha", { exact: true }), screen.getByText("Dense event beta", { exact: true }));

  await crafted("/logs");
  await expect(screen.getByLabel("logs").getByText(/^beta: Dense row beta/u)).toBeVisible();
  const spacedLogs = await logsGap();
  await crafted("/activity");
  await expect(screen.getByLabel("activity").getByText("Dense event beta", { exact: true })).toBeVisible();
  const spacedActivity = await activityGap();

  await hui.open("/labs");
  await hui.flip(dense);
  await expect(dense).toBeChecked();

  await crafted("/logs");
  await expect(screen.getByLabel("logs").getByText(/^beta: Dense row beta/u)).toBeVisible();
  await expect.poll(logsGap).toBeLessThan(spacedLogs);
  const packedLogs = await logsGap();
  await crafted("/activity");
  await expect(screen.getByLabel("activity").getByText("Dense event beta", { exact: true })).toBeVisible();
  await expect.poll(activityGap).toBeLessThan(spacedActivity);

  await hui.open("/labs");
  await expect(dense).toBeChecked();
  await hui.flip(dense);
  await expect(dense).toBeChecked({ checked: false });

  await crafted("/logs");
  await expect(screen.getByLabel("logs").getByText(/^beta: Dense row beta/u)).toBeVisible();
  await expect.poll(async () => Math.abs(await logsGap() - spacedLogs)).toBeLessThan(1);
  expect(await logsGap()).toBeGreaterThan(packedLogs);
});

test("Detailed debug adds Debug's Runtime detail with the heap total and snapshot time, removes it again, changes no PI configuration and survives a reload", { tags: ["PAGE-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const detailed = screen.getByRole("switch", "Detailed debug");
  const detail = screen.getByText("Runtime detail", { exact: true });
  const pi = async () => {
    const snapshot = await hui.api<{ settings: unknown; model: unknown }>("GET", "/__hui/pi");
    return { settings: snapshot.settings, model: snapshot.model };
  };
  const crafted = async (path: string) => {
    const reading = await hui.intercept("GET", /\/__hui\/observability$/u);
    await hui.open(path);
    await reading.arrived();
    await reading.answer(snapshot);
  };

  const before = await pi();
  await crafted("/debug");
  await expect(screen.getByText("Snapshots", { exact: true })).toBeVisible();
  await expect(detail).toBeHidden();
  await expect(screen.getByText("Heap total", { exact: true })).toBeHidden();

  await hui.open("/labs");
  await hui.flip(detailed);
  await expect(detailed).toBeChecked();
  expect(await pi()).toEqual(before);

  await crafted("/debug");
  await expect(detail).toBeVisible();
  await expect(screen.getByText("Heap total", { exact: true })).toBeVisible();
  await expect(screen.getByText("43.6 MB", { exact: true })).toBeVisible();
  await expect(screen.getByText("2026-01-02T03:04:05.000Z", { exact: true })).toBeVisible();

  await hui.reload();
  await expect(detail).toBeVisible();
  await expect(screen.getByText("Heap total", { exact: true })).toBeVisible();

  await hui.open("/labs");
  await expect(detailed).toBeChecked();
  await hui.flip(detailed);
  await expect(detailed).toBeChecked({ checked: false });
  expect(await pi()).toEqual(before);

  await crafted("/debug");
  await expect(screen.getByText("Snapshots", { exact: true })).toBeVisible();
  await expect(detail).toBeHidden();
});