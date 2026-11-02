/** Appearance fits a phone screen in both orientations without sideways scrolling (SET-085). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Appearance fits a phone in portrait and landscape without scrolling sideways", { tags: ["SET-085"], platforms: ["web"] }, async ({ screen, hui }) => {
  const title = screen.getByTestId("settings-page-title");
  const github = screen.getByRole("switch", "GitHub link previews");

  await hui.phoneScreen();
  await hui.open("/settings/appearance");
  await expect(title).toHaveText("Appearance");
  await expect(github).toBeVisible();
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.phoneScreen("landscape");
  await expect(title).toHaveText("Appearance");
  await expect(github).toBeVisible();
  expect(await hui.overflowsSideways()).toBe(false);

  await hui.deviceAppearance("dark");
  expect(await hui.overflowsSideways()).toBe(false);
});
