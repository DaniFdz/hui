/** Add provider offers Mistral's API-key sign-in, and cancelling it adds no card (SET-086). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Mistral is offered with API-key sign-in and a cancelled sign-in adds no card", { tags: ["SET-086"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  // The page renders once before its settings load and once after; tap only when the loaded page is there, so the
  // second render cannot swallow the click that opens the provider dialog.
  await expect(screen.getByText("Saved by HUI and applied to new sessions.")).toBeVisible({ timeout: 60_000 });
  const add = screen.getByRole("button", "Add provider");
  await expect(add).toBeVisible();
  await add.tap();
  const close = screen.getByRole("button", "Close provider dialog");
  await expect(close).toBeVisible();
  await screen.getByRole("button", /^Mistral /u).tap();
  await screen.getByRole("button", /^API key /u).tap();
  await expect(screen.getByLabel("Enter Mistral API key", { exact: true })).toBeVisible();
  const cancel = screen.getByRole("button", "Cancel sign-in");
  // The picker stays busy until the host answers the start request.
  await expect(cancel).toBeEnabled();
  await cancel.tap();
  await expect(cancel).toBeHidden();
  await expect(close).toBeEnabled();
  await close.tap();
  await expect(screen.getByText("No providers added yet. Add one to get started.", { exact: true })).toBeVisible();
  await expect(close).toBeHidden();
});
