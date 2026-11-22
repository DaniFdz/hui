/** Escape in the *Add Datadog org* dialog of Settings → Integrations, driven against the `datadog` fixture world
 * (`hui.world("datadog")`, whose fake `pup` is installed, so the section offers **Add org**): the dialog closes, Settings
 * stays on screen, and focus goes back to the button that opened it (RICH-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape closes the Add Datadog org dialog, leaves Settings open and puts focus back on Add org", { tags: ["RICH-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("datadog");
  await hui.open(`${world.url}/settings/integrations`);

  // The Datadog section has read pup, so it can add an org.
  const settings = screen.getByTestId("settings-page");
  await expect(settings.getByRole("heading", { name: "Datadog", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(settings.getByText("No orgs yet", { exact: true })).toBeVisible();
  const add = settings.getByRole("button", { name: "Add org", exact: true });

  // The dialog opens on the org name, and Escape — pressed there, as a keyboard user would — closes it.
  await add.tap();
  const dialog = screen.getByRole("dialog", { name: "Add Datadog org" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Org name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Org name", { exact: true }).press("Escape");
  await expect(dialog).toBeHidden();

  // Settings never moved, and the button that opened the dialog has focus back: another Enter opens it again.
  await expect(settings.getByRole("heading", { name: "Datadog", exact: true })).toBeVisible();
  await expect(settings.getByText("No orgs yet", { exact: true })).toBeVisible();
  expect(await hui.url()).toContain("/settings/integrations");
  await expect(add).toBeFocused();
  await add.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(dialog).toBeHidden();
});
