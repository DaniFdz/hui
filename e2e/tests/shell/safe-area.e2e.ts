/**
 * A phone's own chrome — the status bar, the notch, the home indicator — never covers HUI's: the header a phone draws
 * starts below the top inset, so its menu button is a tap and not a guess, and the composer ends above the bottom
 * one (SHELL-049).
 *
 * The insets are the ones a device reports; an emulator reports zero. The fixture states them (`hui.insets`) the way the
 * installed app's shell does, and the page is read where the cutout would be. The rule under test pads only in a browser
 * (`display-mode: browser`): the installed app pads the page's frame natively and a standalone page pads `body`, so
 * neither counts the inset twice — which is why this is a web-target case with a phone's insets, not a device capture.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const TOP = 47;
const BOTTOM = 34;

test("the phone's status bar and home indicator never cover HUI's header or composer", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Clear of the cutout" });
  const viewport = await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);

  const header = screen.getByTestId("chat-header");
  const menu = header.getByRole("button").first();
  const composer = screen.getByLabel("Message");
  await expect(header).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(composer).toBeVisible();

  /** Where an element sits now, read once it is laid out. */
  const box = async (target: typeof header) => {
    const measured = await target.boundingBox();
    if (!measured) throw new Error("nothing was laid out to measure");
    return measured;
  };

  // A screen with no cutout: the header is at the top of the page and the composer near the bottom.
  const plain = { header: await box(header), menu: await box(menu), composer: await box(composer) };
  expect(plain.header.y).toBeLessThan(TOP);
  expect(viewport.height - (plain.composer.y + plain.composer.height)).toBeLessThan(BOTTOM + 40);

  await hui.insets({ top: TOP, bottom: BOTTOM });

  // The header starts below the status bar, and its menu button is entirely inside the tappable area below it: the
  // button's own box is what a tap lands on, so a menu drawn under the clock would leave its top at 14. The promise is
  // that the inset cleared, so a pixel of layout rounding either way is not a failure.
  await expect.poll(async () => Math.round((await box(header)).y)).toBeGreaterThanOrEqual(TOP);
  const cutoutHeader = await box(header);
  const cutoutMenu = await box(menu);
  expect(Math.round(cutoutHeader.y)).toBeGreaterThanOrEqual(TOP);
  expect(cutoutMenu.y).toBeGreaterThanOrEqual(TOP);
  // It really moved: the button used to sit inside the band the status bar draws over.
  expect(plain.menu.y).toBeLessThan(TOP);

  // The composer ends above the home indicator rather than under it. The room it gives back is the inset plus or minus a
  // pixel of layout rounding, so the promise is that it cleared the inset, not that it cleared it exactly.
  await expect.poll(async () => {
    const now = await box(composer);
    return Math.round((plain.composer.y + plain.composer.height) - (now.y + now.height));
  }).toBeGreaterThanOrEqual(BOTTOM - 1);
  const cutoutComposer = await box(composer);
  const gaveBack = (plain.composer.y + plain.composer.height) - (cutoutComposer.y + cutoutComposer.height);
  expect(gaveBack).toBeLessThanOrEqual(BOTTOM + 2);
  expect(cutoutComposer.y + cutoutComposer.height).toBeLessThanOrEqual(viewport.height - BOTTOM + 1);
});
