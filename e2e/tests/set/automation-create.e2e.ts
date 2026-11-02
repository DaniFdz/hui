/** A prompt can be scheduled as an automation task and the task survives a reload (SET-067). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a prompt can be scheduled as an automation task and survives a reload", { tags: ["SET-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Automation task" });

  await hui.open("/cron");
  await screen.getByPlaceholder("Nightly review").fill("Scheduled prompt");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Automation task", { exact: true }).last().tap();
  await screen.getByPlaceholder("What should the session do?").fill("Summarise the day");
  await screen.getByPlaceholder("0 9 * * 1-5").fill("*/5 * * * *");
  await screen.getByRole("button", "Create task").tap();

  await expect(screen.getByText("Scheduled prompt", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^Cron \*\/5 \* \* \* \* \(/u)).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("Scheduled prompt", { exact: true })).toBeVisible();
});
