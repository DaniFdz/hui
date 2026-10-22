/** Deleting an automation task: refused with its reason while a run is in flight, then removed while its past runs stay in Run history (SET-071). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("run now shows the run settle in Run history, refuses a second run and a delete in flight, cancels, and a delete keeps past runs", { tags: ["SET-071"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Automation target" });
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Held", sessionId: session.id, prompt: "E2E_REPLAY", schedule: { kind: "every", everyMs: 3_600_000 }, enabled: true,
  });
  const runNow = screen.getByRole("button", "Run now: Held");

  const manual = screen.getByText("Manual · started", { exact: false });
  const completed = screen.getByText("Completed");
  const cancelled = screen.getByText("Cancelled");

  await hui.open("/settings/automation");
  await expect(runNow).toBeVisible();
  const runs = await manual.count();
  const completedBefore = await completed.count();
  const cancelledBefore = await cancelled.count();
  await runNow.tap();
  await hui.provider.held();
  await expect(screen.getByText("1 run in flight")).toBeVisible();
  await expect(screen.getByText("Running")).toHaveCount(2);
  await expect(manual).toHaveCount(runs + 1);
  await expect(manual.first()).not.toContainText("finished");
  await expect(screen.getByRole("button", "Cancel")).toBeVisible();

  await runNow.tap();
  await expect(screen.getByText("This task is already running.")).toBeVisible();
  await screen.getByRole("button", "Actions for Held").tap();
  await screen.getByText("Delete", { exact: true }).tap();
  await expect(screen.getByText("Stop the active run before deleting this task.")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Held")).toBeVisible();

  await hui.provider.release();
  await expect(completed).toHaveCount(completedBefore + 2);
  await expect(manual.first()).toContainText("finished");
  await expect(screen.getByText("Replay prefix — replay suffix").first()).toBeVisible();
  await expect(screen.getByRole("button", "Cancel")).toBeHidden();
  await expect(screen.getByText("Idle.")).toBeVisible();

  await runNow.tap();
  await hui.provider.held();
  await expect(screen.getByRole("button", "Cancel")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(cancelled).toHaveCount(cancelledBefore + 2);
  await expect(screen.getByRole("button", "Cancel")).toBeHidden();

  await screen.getByRole("button", "Actions for Held").tap();
  await screen.getByText("Delete", { exact: true }).tap();
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();
  await expect(manual).toHaveCount(runs + 2);
});
