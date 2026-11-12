/** Appearance is saved on the device that shows it: the store keeps it, no settings write leaves the page, and a storage that refuses a write says so (SET-004). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("an Appearance change is saved on this device without a settings write, and survives a reload", { tags: ["SET-004"] }, async ({ screen, hui }) => {
  const chosen = (name: string) => hui.pressed(screen, name);
  const saved = screen.getByText("Saved on this device. Another browser, app or phone keeps its own appearance.");

  await hui.deviceAppearance("light");
  await hui.open("/settings/appearance");
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByText("Follows your system setting unless you pick one."));
  await screen.getByRole("button", "Dark").tap();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(async () => (await hui.storedAppearance())?.themeMode).toBe("dark");
  await expect(saved).toBeVisible();
  // The gateway keeps no appearance: this choice never left the page.
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");
  expect(settings.themeMode).toBeUndefined();
  expect(settings.theme).toBeUndefined();
  expect(settings.accent).toBeUndefined();
  expect(settings.chat).toEqual({ toolMarks: {}, toolIcons: {} });

  await hui.reload();
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByRole("button", "Dark"));
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");
  await expect(saved).toBeVisible();
});

test("a device whose storage refuses the write applies the change, says so, and forgets it after a reload", { tags: ["SET-004"] }, async ({ screen, hui }) => {
  const chosen = (name: string) => hui.pressed(screen, name);
  const refused = screen.getByText("Could not save on this device — the change applies now and is gone after a reload.");

  await hui.deviceAppearance("light");
  await hui.open("/settings/appearance");
  await screen.getByRole("button", "Dark").tap();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(async () => (await hui.storedAppearance())?.themeMode).toBe("dark");

  await hui.refuseStorage();
  await screen.getByRole("button", "Light").tap();
  await expect(refused).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("light");
  await expect(chosen("Light")).toBeVisible();

  await hui.reload();
  await expect.poll(() => hui.appearance()).toBe("light");
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByRole("button", "Dark"));
  await expect(chosen("Dark")).toBeVisible();
});
