/** A device's appearance is its own: the gateway keeps none of it, and a client that stored nothing starts from HUI's defaults rather than another client's choices (SET-095). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const GATEWAY_APPEARANCE = ["theme", "themeMode", "accent", "fontUi", "fontChat", "fontTerminal", "textScale"];

test("a choice stays on this device, and a client that stored nothing starts from HUI's defaults, not another client's", { tags: ["SET-095"] }, async ({ screen, hui }) => {
  const card = (name: string, pressed = true) => hui.pressed(screen, name, pressed);

  await hui.deviceAppearance("dark");
  await hui.open("/settings/appearance");
  await expect(screen.getByText("Saved on this device. Another browser, app or phone keeps its own appearance.")).toBeVisible();
  await screen.getByRole("button", "Miami").tap();
  await expect(card("Miami")).toBeVisible();
  await hui.scrollTo(screen.getByTestId("settings-page"), screen.getByLabel("Accent color").getByRole("button", "Violet"));
  await screen.getByLabel("Accent color").getByRole("button", "Violet").tap();
  await expect.poll(async () => (await hui.look(screen.getByTestId("settings-page-title"))).color).toEqual([167, 139, 250]);
  await expect.poll(async () => (await hui.storedAppearance())?.theme).toBe("miami");
  expect((await hui.storedAppearance())?.accent).toBe("#a78bfa");

  // The gateway serving this page keeps none of it, so nothing can carry it to another client.
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");
  expect(Object.keys(settings).filter((key) => GATEWAY_APPEARANCE.includes(key))).toEqual([]);

  // Another device on the same gateway: its own storage, the same gateway. It starts from HUI's defaults.
  await hui.clearState();
  await hui.open("/settings/appearance");
  await expect(card("Claw")).toBeVisible();
  await expect(card("Miami", false)).toBeVisible();
  await expect.poll(async () => (await hui.storedAppearance())?.theme ?? null).toBe(null);
  await expect.poll(() => hui.appearance()).toBe("dark");
  expect((await hui.api<Record<string, unknown>>("GET", "/__hui/settings")).theme).toBeUndefined();
});

test("the Settings footer still reports a gateway setting that fails to save", { tags: ["SET-004"] }, async ({ screen, hui }) => {
  const saved = screen.getByText("Settings saved locally");
  const notSaved = screen.getByText("Settings not saved");

  await hui.open("/settings/notifications");
  await expect(saved).toBeVisible();
  const ok = await hui.look(saved);

  const write = await hui.intercept("PUT", /\/__hui\/settings$/u);
  await hui.flip(screen.getByRole("switch", "Run finished"));
  await write.reject(500, "disk full");
  await expect(notSaved).toBeVisible();
  await expect(saved).toBeHidden();
  const [r, g, b] = (await hui.look(notSaved)).color;
  expect(r - Math.max(g, b)).toBeGreaterThan(80);
  expect((await hui.look(notSaved)).color).not.toEqual(ok.color);
});
