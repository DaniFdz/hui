/** The Worktrees page saves a default branch prefix, adds a missing trailing slash, and keeps it across a reload (SET-032). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Worktrees page saves a default branch prefix with its trailing slash", { tags: ["SET-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const field = page.getByLabel("Workspace branch prefix");

  await hui.open("/settings/worktrees");
  await expect(field).toHaveValue("feature/");
  await field.fill("hui-e2e");
  await field.press("Enter");
  await expect(field).toHaveValue("hui-e2e/");
  expect((await hui.api<{ branchPrefix: string }>("GET", "/__hui/settings")).branchPrefix).toBe("hui-e2e/");

  await hui.reload();
  await expect(field).toHaveValue("hui-e2e/");
});
