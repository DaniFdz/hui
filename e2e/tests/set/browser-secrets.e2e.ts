/** A site secret saves by name and origin, is never shown again, and can be deleted (SET-091). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a site secret is stored by name and origin and never shown again", { tags: ["SET-091"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/tools");
  await expect(screen.getByText("None stored.", { exact: false })).toBeVisible();

  await screen.getByLabel("Secret name").fill("github");
  await screen.getByLabel("Secret origin").fill("https://github.com");
  await screen.getByLabel("Secret value").fill("hunter2");
  await screen.getByRole("button", "Add secret").click();

  await expect(screen.getByText("github", { exact: true })).toBeVisible();
  await expect(screen.getByText("https://github.com", { exact: false })).toBeVisible();
  await expect(screen.getByText("hunter2")).toHaveCount(0);
  // The form remounts after a save, so the write-only value field is empty again.
  await expect(screen.getByLabel("Secret name")).toHaveValue("");

  await hui.reload();
  await expect(screen.getByText("https://github.com", { exact: false })).toBeVisible();
  await expect(screen.getByText("hunter2")).toHaveCount(0);

  await screen.getByRole("button", "Delete github").click();
  await expect(screen.getByText("None stored.", { exact: false })).toBeVisible();
});
