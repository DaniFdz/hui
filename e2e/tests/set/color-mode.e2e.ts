/** Color mode switches the theme's variant at once, keeps it across a reload, follows the device on System, and is off for a one-variant theme (SET-006). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Color mode switches the variant, keeps it, and System follows the device", { tags: ["SET-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const modes = screen.getByLabel("Color mode");
  const chosen = (name: string) => modes.getByRole("button", { name, pressed: true });

  await hui.deviceAppearance("light");
  await hui.open("/settings/appearance");
  await modes.getByRole("button", "Dark").tap();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");
  await expect.poll(async () => (await hui.api<{ themeMode: string }>("GET", "/__hui/settings")).themeMode).toBe("dark");

  await hui.reload();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");

  await modes.getByRole("button", "Light").tap();
  await expect(chosen("Light")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("light");

  await modes.getByRole("button", "System").tap();
  await expect(chosen("System")).toBeVisible();
  await hui.deviceAppearance("dark");
  await expect.poll(() => hui.appearance()).toBe("dark");
  await hui.deviceAppearance("light");
  await expect.poll(() => hui.appearance()).toBe("light");
});

test("a theme with one variant turns Color mode off", { tags: ["SET-006"], platforms: ["web"] }, async ({ screen, hui }) => {
  const modes = screen.getByLabel("Color mode");

  await hui.api("PUT", "/__hui/settings", { ...(await hui.api<Record<string, unknown>>("GET", "/__hui/settings")), theme: "dracula" });
  await hui.open("/settings/appearance");
  await expect(screen.getByText("This theme only carries a dark variant, so the mode follows the theme.")).toBeVisible();
  for (const name of ["System", "Light", "Dark"]) await expect(modes.getByRole("button", name)).toBeDisabled();
  await expect.poll(() => hui.appearance()).toBe("dark");
});
