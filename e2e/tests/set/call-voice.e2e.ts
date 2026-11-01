/** Models → Calls keeps the default GPT-Live voice, shows the ChatGPT login row and persists the choice across a reload (SET-051). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Models → Calls chooses the default GPT-Live voice and keeps it after a reload", { tags: ["SET-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");

  await hui.open("/settings/models");
  await expect(page.getByRole("button", "Default GPT-Live voice: Cove (GPT-Live's default)")).toBeVisible();
  await expect(page.getByText("ChatGPT login", { exact: true })).toBeVisible();

  await page.getByRole("button", "Default GPT-Live voice: Cove (GPT-Live's default)").tap();
  await screen.getByLabel("Default GPT-Live voice").getByText("Juniper", { exact: true }).tap();
  const chosen = page.getByRole("button", "Default GPT-Live voice: Juniper");
  await expect(chosen).toBeVisible();
  expect((await hui.api<{ calls: { voice: string } }>("GET", "/__hui/settings")).calls.voice).toBe("juniper");

  await hui.reload();
  await expect(chosen).toBeVisible();
  await expect(page.getByText("ChatGPT login", { exact: true })).toBeVisible();
});
