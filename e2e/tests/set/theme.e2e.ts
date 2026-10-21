/** A theme card recolours the whole app at once and stays chosen after a reload; a theme that fails to load leaves the previous one, and without a theme list Settings says the defaults are in use (SET-005). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const MIAMI_DARK = [20, 15, 30];

test("a theme card recolours the app at once in dark and light mode, stays chosen after a reload, and a theme that fails to load changes nothing", { tags: ["SET-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = (name: string, pressed = true) => screen.getByRole("button", { name, pressed });
  const title = screen.getByTestId("settings-page-title");
  const pages = screen.getByLabel("Settings pages");
  const home = screen.getByLabel("Primary navigation");

  await hui.deviceAppearance("dark");
  await hui.open("/");
  const clawHome = await hui.look(home);
  await hui.open("/settings/appearance");
  for (const name of ["Catppuccin", "Claw", "Dracula", "HUI", "Miami", "Rose (OpenClaw)"]) await expect(screen.getByRole("button", name)).toBeVisible();
  await expect(card("Claw")).toBeVisible();
  const claw = await hui.look(title);

  await screen.getByRole("button", "Miami").tap();
  await expect(card("Miami")).toBeVisible();
  await expect(card("Claw", false)).toBeVisible();
  await expect.poll(async () => (await hui.look(title)).background).toEqual(MIAMI_DARK);
  expect((await hui.look(pages)).color).not.toEqual(claw.color);
  await expect.poll(async () => (await hui.api<{ theme: string }>("GET", "/__hui/settings")).theme).toBe("miami");
  await hui.deviceAppearance("light");
  await expect.poll(async () => (await hui.look(title)).background).toEqual([247, 243, 246]);
  await hui.deviceAppearance("dark");

  await hui.reload();
  await expect(card("Miami")).toBeVisible();
  expect((await hui.look(title)).background).toEqual(MIAMI_DARK);
  await screen.getByRole("button", "Exit Settings").tap();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  expect((await hui.look(home)).background).not.toEqual(clawHome.background);
  await hui.open("/settings/appearance");
  await expect(card("Miami")).toBeVisible();

  const file = await hui.intercept("GET", /\/__hui\/themes\/file\/builtin\/dracula\.json$/u);
  await screen.getByRole("button", "Dracula").tap();
  await file.reject(500, "unreadable");
  await expect(card("Miami")).toBeVisible();
  await expect(card("Dracula", false)).toBeVisible();
  expect((await hui.look(title)).background).toEqual(MIAMI_DARK);
  expect((await hui.api<{ theme: string }>("GET", "/__hui/settings")).theme).toBe("miami");
});

test("without a theme list the Theme section says the built-in defaults are in use", { tags: ["SET-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/appearance");
  await expect(screen.getByRole("button", { name: "Claw", pressed: true })).toBeVisible();
  const list = await hui.intercept("GET", /\/__hui\/themes$/u);
  const reloading = hui.reload();
  await list.reject(500, "unavailable");
  await reloading;
  await expect(screen.getByText("No themes could be loaded; the built-in defaults are in use.")).toBeVisible();
  await expect(screen.getByRole("button", "Claw")).toBeHidden();
});
