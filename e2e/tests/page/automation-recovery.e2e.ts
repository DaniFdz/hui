/** The scheduler's first read fails with Retry, a later refresh keeps the last tasks, and Refresh recovers (PAGE-003). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const at = "2026-01-02T03:00:00.000Z";
const later = "2026-01-02T04:00:00.000Z";

test("the scheduler recovers from a failed read and keeps its tasks when a refresh fails", { tags: ["PAGE-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Scheduler recovery" });
  const snapshot = {
    scheduler: { enabled: true, activeRuns: 0, nextWakeAt: null },
    tasks: [{ id: "task-1", name: "Nightly review", description: "", sessionId: session.id, prompt: "Review the diff", schedule: { kind: "every", everyMs: 3_600_000 }, enabled: true, timeoutSeconds: 900, createdAt: at, updatedAt: at, nextRunAt: later }],
    runs: [],
  };

  const failing = await hui.answerAll("GET", /\/__hui\/automation$/u, JSON.stringify({ error: "The scheduler is not answering." }), 503);
  await hui.open("/cron");
  await expect(screen.getByText(/The scheduler is not answering\./u)).toBeVisible();
  await expect(screen.getByRole("button", "Retry")).toBeVisible();
  await failing.stop();

  const served = await hui.answerAll("GET", /\/__hui\/automation$/u, JSON.stringify(snapshot));
  await screen.getByRole("button", "Refresh").click();
  await expect(screen.getByText("Nightly review", { exact: true })).toBeVisible();
  await served.stop();

  const failedRefresh = await hui.answerAll("GET", /\/__hui\/automation$/u, JSON.stringify({ error: "The scheduler is not answering." }), 503);
  await screen.getByRole("button", "Refresh").click();
  await expect(screen.getByText("Refresh failed: The scheduler is not answering.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Nightly review", { exact: true })).toBeVisible();
  await failedRefresh.stop();

  await screen.getByRole("button", "Refresh").click();
  await expect(screen.getByText(/^Refresh failed:/u)).toBeHidden();
});
