/** Color mode switches the theme's variant at once, keeps it across a reload, follows the device on System, and is off for a one-variant theme (SET-006). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Color mode switches the variant, keeps it, and System follows the device", { tags: ["SET-006"] }, async ({ screen, hui }) => {
  const chosen = (name: string) => hui.pressed(screen, name);

  await hui.deviceAppearance("light");
  await hui.open("/settings/appearance");
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByText("Follows your system setting unless you pick one."));
  await expect(screen.getByLabel("Color mode").first()).toBeVisible();
  await screen.getByRole("button", "Dark").tap();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");
  await expect.poll(async () => (await hui.api<{ themeMode: string }>("GET", "/__hui/settings")).themeMode).toBe("dark");

  await hui.reload();
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByRole("button", "Dark"));
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");

  await screen.getByRole("button", "Light").tap();
  await expect(chosen("Light")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("light");

  await screen.getByRole("button", "System").tap();
  await expect(chosen("System")).toBeVisible();
  await hui.deviceAppearance("dark");
  await expect.poll(() => hui.appearance()).toBe("dark");
  await hui.deviceAppearance("light");
  await expect.poll(() => hui.appearance()).toBe("light");
});

test("a theme with one variant turns Color mode off", { tags: ["SET-006"] }, async ({ screen, hui }) => {
  await hui.api("PUT", "/__hui/settings", { ...(await hui.api<Record<string, unknown>>("GET", "/__hui/settings")), theme: "dracula" });
  await hui.open("/settings/appearance");
  const footer = screen.getByText("This theme only carries a dark variant, so the mode follows the theme.");
  await hui.scrollTo(screen.getByTestId("settings-page"), footer);
  await expect(footer).toBeVisible();
  for (const name of ["System", "Light", "Dark"]) await expect(screen.getByRole("button", name)).toBeDisabled();
  await expect.poll(() => hui.appearance()).toBe("dark");
});
