/** Settings says whether a change was saved: a failed write turns the footer red and Appearance warns, the change applies now and is gone after a reload (SET-004). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the footer and Appearance say a change was saved, and a failed write applies now but is forgotten after a reload", { tags: ["SET-004"] }, async ({ screen, hui }) => {
  const chosen = (name: string) => hui.pressed(screen, name);
  const saved = screen.getByText("Settings saved locally");
  const notSaved = screen.getByText("Settings not saved");

  await hui.deviceAppearance("light");
  await hui.open("/settings/appearance");
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByText("Follows your system setting unless you pick one."));
  await screen.getByRole("button", "Dark").tap();
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ themeMode: string }>("GET", "/__hui/settings")).themeMode).toBe("dark");
  await expect(saved).toBeVisible();
  await expect(screen.getByText("Saved to ~/.config/hui/settings.json")).toBeVisible();
  const ok = await hui.look(saved);

  const write = await hui.intercept("PUT", /\/__hui\/settings$/u);
  await screen.getByRole("button", "Light").tap();
  await write.reject(500, "disk full");
  await expect(notSaved).toBeVisible();
  await expect(saved).toBeHidden();
  await expect(screen.getByText("Could not write settings.json — changes apply now but will not be remembered.")).toBeVisible();
  const [r, g, b] = (await hui.look(notSaved)).color;
  expect(r - Math.max(g, b)).toBeGreaterThan(80);
  expect((await hui.look(notSaved)).color).not.toEqual(ok.color);
  await expect(chosen("Light")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("light");

  await hui.reload();
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByRole("button", "Dark"));
  await expect(chosen("Dark")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("dark");
  await expect(saved).toBeVisible();
});