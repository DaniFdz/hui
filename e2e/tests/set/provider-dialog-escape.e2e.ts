/** Escape closes the provider dialog, keeps Settings → Models open and returns focus to its trigger (SET-036). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape closes the provider dialog and returns focus to Settings → Models", { tags: ["SET-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const add = screen.getByRole("button", "Add provider");

  await hui.open("/settings/models");
  await expect(add).toBeVisible();
  await add.tap();
  const dialog = screen.getByRole("dialog", "Add provider");
  await expect(dialog).toBeVisible();

  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(dialog).toBeHidden();
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Models");
  await expect(add).toBeFocused();
});
