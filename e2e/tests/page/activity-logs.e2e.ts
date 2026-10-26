/** Activity lists gateway, session, runtime and automation events newest first, expands to its area, level, time, session and detail, says when it has none and forgets them when the gateway restarts; Logs shows warnings, errors and lifecycle with secret-shaped values redacted or says it has none (PAGE-016, PAGE-017). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const usage = { sessions: 0, filesRead: 0, records: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: null, models: [], unavailable: [] };
const snapshot = (activity: unknown[], logs: unknown[]) => JSON.stringify({
  generatedAt: "2026-01-02T03:04:05.000Z",
  retention: { kind: "memory", maximum: 300, since: "2026-01-02T03:00:00.000Z" },
  activity,
  logs,
  usage,
  debug: { node: "v24.14.0", "platform": "darwin", uptimeSeconds: 12, memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 1 }, eventCount: 1 },
});
const event = (id: number, area: string, action: string, summary: string, rest: Record<string, unknown> = {}) => ({ id, timestamp: "2026-01-02T03:03:00.000Z", area, level: "info", action, summary, ...rest });

test("Activity lists events newest first, expands to area, level, time, session and detail, says when it has none and forgets them after a gateway restart", { tags: ["PAGE-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const stream = screen.getByLabel("activity");
  const newer = event(2, "session", "settled", "Agent turn settled", { detail: "The newer event" });
  const older = event(1, "runtime", "tool_start", "Tool started: read", { detailed: true, level: "warning", sessionId: "abcdefgh-1234", detail: "The older event" });
  const first = await hui.intercept("GET", /\/__hui\/observability$/u);

  await hui.open("/activity");
  await first.arrived();
  await first.answer(snapshot([newer, older], []));
  await expect(stream.getByText("Agent turn settled", { exact: true })).toBeVisible();
  expect((await stream.getByText("Agent turn settled", { exact: true }).boundingBox())!.y)
    .toBeLessThan((await stream.getByText("Tool started: read", { exact: true }).boundingBox())!.y);
  await expect(stream.getByText(/^\d{1,2}:\d{2}/u).first()).toBeVisible();

  await stream.getByText("Tool started: read", { exact: true }).tap();
  await expect(stream.getByText("runtime", { exact: true })).toBeVisible();
  await expect(stream.getByText("warning", { exact: true })).toBeVisible();
  await expect(stream.getByText("Session abcdefgh-1234", { exact: true })).toBeVisible();
  await expect(stream.getByText("The older event", { exact: true })).toBeVisible();
  await expect(stream.getByText("The newer event", { exact: true })).toBeHidden();

  const empty = await hui.intercept("GET", /\/__hui\/observability$/u);
  await hui.reload();
  await empty.arrived();
  await empty.answer(snapshot([], []));
  await expect(screen.getByText("No activity yet. Events appear after this gateway handles session or automation work.", { exact: true })).toBeVisible();

  const session = await hui.createSession({ title: "Activity restart" });
  await hui.prompt(session, "Settle this turn");
  const settled = async () => (await hui.api<{ activity: { summary: string }[] }>("GET", "/__hui/observability")).activity.some((entry) => entry.summary === "Agent turn settled");
  await expect.poll(settled, { timeout: 60_000 }).toBe(true);
  await hui.reload();
  await expect(stream.getByText("Agent turn settled", { exact: true })).toBeVisible();

  await hui.restartGateway();
  await hui.reload();
  await expect(screen.getByLabel("activity").getByText("HUI gateway started", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("activity").getByText("Agent turn settled", { exact: true })).toBeHidden();
});

test("Logs shows warnings, errors and lifecycle events with their time, level, area, action, summary and detail, redacts secret-shaped values, and says when it has none", { tags: ["PAGE-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.restartGateway();
  const empty = await hui.intercept("GET", /\/__hui\/observability$/u);
  await hui.open("/logs");
  await empty.arrived();
  await empty.answer(snapshot([], []));
  await expect(screen.getByText("No logs yet. Events appear after this gateway handles session or automation work.", { exact: true })).toBeVisible();

  const entry = event(1, "gateway", "probe", "Crafted warning", { level: "warning", detail: "Crafted detail" });
  const shaped = await hui.intercept("GET", /\/__hui\/observability$/u);
  await hui.reload();
  await shaped.arrived();
  await shaped.answer(snapshot([], [entry]));
  const stream = screen.getByLabel("logs");
  await expect(stream.getByText(/^probe: Crafted warning/u)).toBeVisible();
  await expect(stream.getByText("warning", { exact: true })).toBeVisible();
  await expect(stream.getByText("gateway", { exact: true })).toBeVisible();
  await expect(stream.getByText("Crafted detail", { exact: true })).toBeVisible();
  await expect(stream.getByText(/^\d{1,2}:\d{2}/u).first()).toBeVisible();

  await hui.api("POST", "/__hui/diagnostics/ui-errors", {
    reports: [{ kind: "uncaught_error", message: "Copy failed with password=hunter2-logs", location: "app.js:12" }],
  });
  await hui.reload();
  await expect(screen.getByLabel("logs").getByText(/^Copy failed with password=\[redacted\] at app\.js:12$/u)).toBeVisible();
  await expect(screen.getByLabel("logs").getByText(/hunter2/u)).toBeHidden();
  await expect(screen.getByLabel("logs").getByText("start: HUI gateway started", { exact: true })).toBeVisible();
});
