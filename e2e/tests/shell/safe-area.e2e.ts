/**
 * SHELL-050: the header, tappable menu and composer clear the display's unsafe bands on every target.
 * Browsers retain exact synthetic 47/34 CSS insets; Android uses a real system cutout overlay and independently
 * measured system-bar bounds and native WebView origin. Native page tokens stay shell-owned (zero), not injected.
 * Effective before/after bounds account for Android's already-fitted bars and its unchanged navigation-bar inset.
 */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { DisplayArea } from "../../fixtures/display-area.ts";

const TOP = 47;
const BOTTOM = 34;

const contained = async (area: DisplayArea, target: Locator) => {
  const box = await area.box(target);
  expect(box.x).toBeGreaterThanOrEqual(area.left - 1);
  expect(box.y).toBeGreaterThanOrEqual(area.top - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(area.right + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(area.bottom + 1);
  return box;
};

test("the phone's status bar and home indicator never cover HUI's header or composer", { tags: ["SHELL-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Clear of the cutout" });
  await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);

  const header = screen.getByTestId("chat-header");
  const menu = header.getByRole("button").first();
  const composer = screen.getByLabel("Message");
  await expect(header).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(composer).toBeVisible();

  const plainArea = await hui.safeDisplay();
  const plain = { header: await contained(plainArea, header), menu: await contained(plainArea, menu), composer: await contained(plainArea, composer) };
  expect(plain.header.y - plainArea.top).toBeLessThan(TOP);
  expect(plainArea.bottom - (plain.composer.y + plain.composer.height)).toBeLessThan(BOTTOM + 40);

  const cutout = await hui.safeDisplay({ top: TOP, bottom: BOTTOM });
  // A positive change at the top is mandatory, including on Android: an ineffective overlay cannot pass.
  const topChange = cutout.top - plainArea.top;
  const bottomChange = plainArea.bottom - cutout.bottom;
  expect(topChange).toBeGreaterThan(0);
  expect(cutout.height - cutout.bottom).toBeGreaterThan(0);
  await expect.poll(async () => Math.round((await cutout.box(header)).y)).toBeGreaterThanOrEqual(Math.round(cutout.top));
  const cutoutHeader = await contained(cutout, header);
  const cutoutMenu = await contained(cutout, menu);
  expect(Math.round(cutoutHeader.y)).toBeGreaterThanOrEqual(Math.round(cutout.top));
  expect(cutoutMenu.y).toBeGreaterThanOrEqual(cutout.top);
  expect(plain.menu.y).toBeLessThan(cutout.top);
  // Exact effective movement also catches double-padding; browsers still require the original 47px movement.
  expect(cutoutHeader.y - plain.header.y).toBeGreaterThanOrEqual(topChange - 1);
  expect(cutoutHeader.y - plain.header.y).toBeLessThanOrEqual(topChange + 1);

  await expect.poll(async () => {
    const now = await cutout.box(composer);
    return Math.round((plain.composer.y + plain.composer.height) - (now.y + now.height));
  }).toBeGreaterThanOrEqual(bottomChange - 1);
  const cutoutComposer = await contained(cutout, composer);
  const gaveBack = (plain.composer.y + plain.composer.height) - (cutoutComposer.y + cutoutComposer.height);
  expect(gaveBack).toBeLessThanOrEqual(bottomChange + 2);
  expect(cutoutComposer.y + cutoutComposer.height).toBeLessThanOrEqual(cutout.bottom + 1);
  expect(await hui.overflowsSideways()).toBe(false);
  expect(await hui.reachable(menu)).toBe(true);
  expect(await hui.reachable(composer)).toBe(true);
});

test("every route's own chrome starts below the status bar, not only the shell's", { tags: ["SHELL-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.phoneScreen();
  const starts = [
    { route: "/", chrome: "Open navigation" },
    { route: "/sessions", chrome: "Open navigation" },
    { route: "/kanban", chrome: "Open navigation" },
    { route: "/usage", chrome: "Open navigation" },
    { route: "/settings/appearance", chrome: "Open settings navigation" },
    { route: "/settings/integrations", chrome: "Open settings navigation" },
  ];
  for (const { route, chrome } of starts) {
    await hui.open(route);
    const area = await hui.safeDisplay({ top: TOP });
    expect(area.top).toBeGreaterThan(0);
    const control = screen.getByRole("button", chrome).first();
    await expect(control).toBeVisible();
    await expect.poll(async () => Math.round((await area.box(control)).y)).toBeGreaterThanOrEqual(Math.round(area.top));
    await contained(area, control);
    expect(await hui.overflowsSideways()).toBe(false);
    expect(await hui.reachable(control)).toBe(true);
  }
});
