/** Automations and Tasks, the same scheduler surface under each title, read while loading and then show the Scheduler, the Tasks table and Run history, with their empty wording and the in-flight count (PAGE-002). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const task = {
  id: "task-1",
  name: "Nightly review",
  description: "Crafted task",
  sessionId: "session-1",
  prompt: "Review the diff",
  schedule: { kind: "every", everyMs: 3_600_000 },
  enabled: true,
  timeoutSeconds: 900,
  createdAt: "2026-01-02T03:00:00.000Z",
  updatedAt: "2026-01-02T03:00:00.000Z",
  nextRunAt: "2026-01-02T04:00:00.000Z",
};
const run = {
  id: "run-1",
  taskId: task.id,
  taskName: task.name,
  sessionId: task.sessionId,
  source: "manual",
  status: "completed",
  createdAt: "2026-01-02T03:10:00.000Z",
  startedAt: "2026-01-02T03:10:00.000Z",
  finishedAt: "2026-01-02T03:11:00.000Z",
  summary: "Crafted run summary",
};
const snapshot = { scheduler: { enabled: true, activeRuns: 2, nextWakeAt: "2026-01-02T04:00:00.000Z" }, tasks: [task], runs: [run] };

test("Automations reads while loading, shows the Scheduler and the empty wording with nothing stored, and Tasks shows the in-flight count with its table and run history", { tags: ["PAGE-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const title = screen.getByTestId("page-title");
  const reading = screen.getByText(/^\s*Reading automation state…\s*$/u);
  const first = await hui.intercept("GET", /\/__hui\/automation$/u);

  await hui.open("/cron");
  await first.arrived();
  await expect(reading).toBeVisible();
  await first.deliver();
  await expect(title).toHaveText("Automations");
  await expect(screen.getByText("Scheduler", { exact: true })).toBeVisible();
  await expect(screen.getByText("Next wake", { exact: true })).toBeVisible();
  await expect(screen.getByText("Idle.", { exact: true })).toBeVisible();
  await expect(screen.getByText("No tasks configured.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Nothing scheduled", { exact: true })).toBeVisible();
  await expect(screen.getByText("No runs recorded yet.", { exact: true })).toBeVisible();
  await expect(screen.getByText("No runs", { exact: true })).toBeVisible();

  await hui.open("/tasks");
  await expect(title).toHaveText("Tasks");
  await expect(screen.getByText("No tasks configured.", { exact: true })).toBeVisible();

  const shown = await hui.intercept("GET", /\/__hui\/automation$/u);
  await hui.reload();
  await shown.arrived();
  await shown.answer(JSON.stringify(snapshot));
  await expect(screen.getByText("2 runs in flight", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Edit Nightly review")).toBeVisible();
  await expect(screen.getByText("Every hour", { exact: true })).toBeVisible();
  await expect(screen.getByText("Nightly review", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("Crafted run summary", { exact: true })).toBeVisible();
  await expect(screen.getByText("1 recorded run", { exact: true })).toBeVisible();
  await expect(screen.getByText("Idle.", { exact: true })).toBeHidden();
});