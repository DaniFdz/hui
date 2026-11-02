/** The managed browser's headless choice persists, and an executable path that does not run is reported (SET-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the managed browser's headless choice persists and a missing executable is reported", { tags: ["SET-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const headless = screen.getByRole("switch", "Run headless");

  await hui.open("/settings/tools");
  await expect(headless).toBeChecked();
  await headless.press("Space");
  await expect(headless).not.toBeChecked();
  const settings = await hui.api<{ browser: { headless: boolean } }>("GET", "/__hui/settings");
  expect(settings.browser.headless).toBe(false);
  await hui.reload();
  await expect(headless).not.toBeChecked();

  const path = "/tmp/hui-no-browser-here";
  await screen.getByLabel("Browser executable").fill(path);
  await screen.getByLabel("Browser executable").press("Enter");
  await expect(screen.getByText(`No executable browser was found at ${path}.`, { exact: false })).toBeVisible();
  await expect(screen.getByText("Browser not found", { exact: false })).toBeVisible();
});
