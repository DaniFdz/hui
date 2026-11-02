/** A task loads into the form for editing and Update task saves the change across a reload (SET-068). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a task can be edited from its row and the change saves", { tags: ["SET-068"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Editable prompt session" });
  await hui.open("/cron");
  await screen.getByPlaceholder("Nightly review").fill("Editable prompt");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Editable prompt session", { exact: true }).last().tap();
  await screen.getByPlaceholder("What should the session do?").fill("Summarise the day");
  await screen.getByPlaceholder("0 9 * * 1-5").fill("*/5 * * * *");
  await screen.getByRole("button", "Create task").tap();

  await screen.getByRole("button", "Edit Editable prompt").tap();
  await expect(screen.getByText("Edit task", { exact: true })).toBeVisible();
  const name = screen.getByPlaceholder("Nightly review");
  await expect(name).toHaveValue("Editable prompt");
  await name.fill("Edited prompt");
  await screen.getByRole("button", "Update task").tap();
  await expect(screen.getByText("Edited prompt", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("Editable prompt", { exact: true })).toHaveCount(0);

  await hui.reload();
  await expect(screen.getByText("Edited prompt", { exact: true }).first()).toBeVisible();
});
