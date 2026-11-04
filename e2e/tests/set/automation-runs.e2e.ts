/** A task pauses and resumes with its state kept, and Run now records a manual run that completes (SET-069, SET-070). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a task pauses and resumes and keeps that state across a reload", { tags: ["SET-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Pausable prompt session" });
  await hui.open("/cron");
  await screen.getByPlaceholder("Nightly review").fill("Pausable prompt");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Pausable prompt session", { exact: true }).last().tap();
  await screen.getByPlaceholder("What should the session do?").fill("Summarise the day");
  await screen.getByPlaceholder("0 9 * * 1-5").fill("*/5 * * * *");
  await screen.getByRole("button", "Create task").tap();

  const toggle = screen.getByRole("switch", "Enable Pausable prompt");
  await expect(toggle).toBeChecked();
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  await hui.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.press("Space");
  await expect(toggle).toBeChecked();
});

test("Run now records a manual run that finishes on its own", { tags: ["SET-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Runnable prompt session" });
  await hui.open("/cron");
  await screen.getByPlaceholder("Nightly review").fill("Runnable prompt");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Runnable prompt session", { exact: true }).last().tap();
  await screen.getByPlaceholder("What should the session do?").fill("Summarise the day");
  await screen.getByPlaceholder("0 9 * * 1-5").fill("*/5 * * * *");
  await screen.getByRole("button", "Create task").tap();

  // Run history lists every task's runs and one fixture keeps them across the
  // suite, so read this task's newest entry instead of any "Manual · started" row.
  const run = screen.getByTestId("automation-run").filter({ hasText: "Runnable prompt" }).first();
  await screen.getByRole("button", "Run now: Runnable prompt").tap();
  await expect(run.getByText(/Manual · started /u)).toBeVisible();
  await expect(run.getByText("Completed", { exact: true })).toBeVisible({ timeout: 60_000 });
});
