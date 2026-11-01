/** Tools → Questions sets how long a question card waits before the agent continues, and keeps it across a reload (SET-056). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Tools sets how long a question card waits and keeps it after a reload", { tags: ["SET-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");

  await hui.open("/settings/tools");
  await expect(page.getByRole("button", "Question timeout: Off")).toBeVisible();
  await page.getByRole("button", "Question timeout: Off").tap();
  await screen.getByLabel("Question timeout").getByText("15 minutes", { exact: true }).tap();
  const chosen = page.getByRole("button", "Question timeout: 15 minutes");
  await expect(chosen).toBeVisible();
  expect((await hui.api<{ questions: { timeoutMinutes: number } }>("GET", "/__hui/settings")).questions.timeoutMinutes).toBe(15);

  await hui.reload();
  await expect(chosen).toBeVisible();
});
