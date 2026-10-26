/** The boot screen covers the page while HUI's code downloads: its name and loading bar on the background the system preference asks for, the slow-connection line with Reload after six seconds, and nothing left once the app has drawn; a chosen theme and accent make the next load paint it in their colours (SHELL-020, SHELL-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Miami's dark background and strong text, from public/themes/miami.css. */
const MIAMI_BACKGROUND = [20, 15, 30];
const MIAMI_TEXT = [239, 234, 249];
const BLUE_ACCENT = [91, 156, 246];

test("the boot screen shows HUI's name and loading bar on the dark background, adds the slow line after six seconds, and clears once the app draws", { tags: ["SHELL-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByText("HUI", { exact: true });
  const bar = screen.getByRole("progressbar", "Loading HUI");
  const slow = screen.getByText(/^Still loading — the connection is slow\./u);
  const reload = screen.getByRole("link", "Reload");

  await hui.deviceAppearance("dark");
  const code = await hui.intercept("GET", /\/src\/hui-app\.ts/u);
  await hui.open("/");
  await code.arrived();

  await expect(name).toBeVisible();
  await expect(bar).toBeVisible();
  expect((await hui.look(name)).background).toEqual([14, 16, 21]);
  expect((await hui.look(slow)).opacity).toBe(0);

  await expect.poll(async () => (await hui.look(slow)).opacity).toBe(1);
  await expect(reload).toBeVisible();

  await code.deliver();
  await expect(hui.appChrome()).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(slow).toBeHidden();
});

test("a chosen theme and accent paint the boot screen of the next load in their colours", { tags: ["SHELL-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = screen.getByText("HUI", { exact: true });
  const title = screen.getByTestId("settings-page-title");
  const reload = screen.getByRole("link", "Reload");

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await screen.getByRole("button", "Miami").tap();
  await expect.poll(async () => (await hui.look(title)).background).toEqual(MIAMI_BACKGROUND);
  await screen.getByLabel("Accent color").getByRole("button", "Blue").tap();
  await expect.poll(async () => (await hui.look(title)).color).toEqual(BLUE_ACCENT);

  const code = await hui.intercept("GET", /\/src\/hui-app\.ts/u);
  await hui.reload();
  await code.arrived();

  const boot = await hui.look(name);
  expect(boot.background).toEqual(MIAMI_BACKGROUND);
  expect(boot.color).toEqual(MIAMI_TEXT);
  expect((await hui.look(reload)).color).toEqual(BLUE_ACCENT);

  await code.deliver();
  await expect(reload).toBeHidden();
  await expect.poll(async () => (await hui.look(title)).background).toEqual(MIAMI_BACKGROUND);
});