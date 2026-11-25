/** The boot screen covers the page while HUI's code downloads: its name and loading bar on HUI's dark or light background for the system preference, the slow-connection line with Reload only after six seconds, and nothing left once the app has drawn; a chosen theme and accent make the next load paint it in their colours (SHELL-020, SHELL-021); code that fails to download swaps the bar for the connection message and a Reload that loads the page again (SHELL-022). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Miami's dark background and strong text, from public/themes/miami.css. */
const MIAMI_BACKGROUND = [20, 15, 30];
const MIAMI_TEXT = [239, 234, 249];
const BLUE_ACCENT = [91, 156, 246];

test("the boot screen shows HUI's name and loading bar on the background the system preference asks for, adds the slow line after six seconds, and leaves nothing once the app draws", { tags: ["SHELL-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByText("HUI", { exact: true });
  const bar = screen.getByRole("progressbar", "Loading HUI");
  const slow = screen.getByText(/^Still loading — the connection is slow\./u);
  const reload = screen.getByRole("link", "Reload");

  await hui.clearOffline();
  await hui.deviceAppearance("dark");
  let code = await hui.holdAppChunks();
  const started = Date.now();
  await hui.open("/");
  await code.arrived();
  await expect(name).toBeVisible();
  await expect(bar).toBeVisible();
  expect((await hui.look(name)).background).toEqual([14, 16, 21]);

  await expect.poll(async () => (await hui.look(slow)).opacity).toBe(1);
  expect(Date.now() - started).toBeGreaterThanOrEqual(6_000);
  await expect(reload).toBeVisible();
  await code.deliver();
  await hui.sessionList();
  await expect(hui.appChrome()).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(slow).toHaveCount(0);

  await hui.deviceAppearance("light");
  // The app registered its offline worker while it drew; a reload with it installed would be served from its cache and
  // the held chunk would never be requested.
  await hui.clearOffline();
  code = await hui.holdAppChunks();
  await hui.reload();
  await code.arrived();
  await expect(name).toBeVisible();
  await expect(bar).toBeVisible();
  expect((await hui.look(name)).background).toEqual([250, 249, 247]);
  await code.deliver();
  await hui.sessionList();
  await expect(hui.appChrome()).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test("a chosen theme and accent paint the boot screen of the next load in their colours", { tags: ["SHELL-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByText("HUI", { exact: true });
  const title = screen.getByTestId("settings-page-title");
  const reload = screen.getByRole("link", "Reload");

  await hui.clearOffline();
  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await screen.getByRole("button", "Miami").tap();
  await expect.poll(async () => (await hui.look(title)).background).toEqual(MIAMI_BACKGROUND);
  await screen.getByLabel("Accent color").getByRole("button", "Blue").tap();
  await expect.poll(async () => (await hui.look(title)).color).toEqual(BLUE_ACCENT);
  // The theme and accent are this device's, so they are what its next load paints the boot screen in.
  await expect.poll(async () => (await hui.storedAppearance())?.theme).toBe("miami");
  expect((await hui.storedAppearance())?.accent).toBe("#5b9cf6");
  expect((await hui.api<Record<string, unknown>>("GET", "/__hui/settings")).theme).toBeUndefined();

  // Reading the settings page installed the offline worker; drop it so the next load asks for the held chunk.
  await hui.clearOffline();
  const code = await hui.holdAppChunks();
  await hui.reload();
  await code.arrived();
  const boot = await hui.look(name);
  expect(boot.background).toEqual(MIAMI_BACKGROUND);
  expect(boot.color).toEqual(MIAMI_TEXT);
  expect((await hui.look(reload)).color).toEqual(BLUE_ACCENT);

  await code.deliver();
  await expect.poll(async () => (await hui.look(title)).background).toEqual(MIAMI_BACKGROUND);
  await expect(reload).toBeHidden();
});

test("code that never downloads swaps the loading bar for the connection message and Reload loads the page again", { tags: ["SHELL-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bar = screen.getByRole("progressbar", "Loading HUI");
  const failure = screen.getByText("HUI could not load over this connection.", { exact: true });
  const reload = screen.getByRole("button", "Reload");

  await hui.clearOffline();
  const code = await hui.holdAppChunks();
  await hui.open("/");
  await code.arrived();
  await expect(bar).toBeVisible();
  await code.reject(500, "the module did not arrive");
  await expect(failure).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(reload).toBeVisible();

  await reload.tap();
  await hui.sessionList();
  await expect(hui.appChrome()).toBeVisible();
  await expect(failure).toHaveCount(0);
});
