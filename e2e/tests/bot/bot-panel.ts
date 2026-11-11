/**
 * Reaching a bot's roster and its panel at either width: the wide layout keeps the roster in the sidebar and docks the
 * panel beside the chat, while a phone keeps the roster in the navigation drawer and opens the panel as a sheet over
 * the chat (BOT-024). A test calls these instead of reading a width or a platform, so one test proves its use case where
 * a desktop draws both side by side and where a phone shows one screen at a time.
 *
 * Every step waits for whichever arrangement the page settles into: `count()` and `isVisible()` answer at once, so a
 * check that ran before the page had rendered its layout would take the other width's route.
 */
import { expect, type Locator, type Screen } from "e2e";
import type { Hui } from "../../fixtures/hui.ts";

/** The bot's panel, docked or as a sheet, once it is on screen. */
export const botPanel = (screen: Screen, name: string): Locator => screen.getByLabel(`${name}: bot panel`);

/**
 * Puts the navigation drawer away, which only a phone draws: the roster covers the chat until it is dismissed, while the
 * wide layout keeps the same roster in the sidebar with nothing to close. A drawer that is already away, or absent, is
 * left alone.
 */
export const hideRoster = async (screen: Screen): Promise<void> => {
  // A phone dismisses the drawer by tapping outside it (SHELL-011). The drawer's backdrop is the whole screen with the
  // drawer over its left side, so the tap goes at the backdrop's own right edge, clear of the drawer's body.
  const backdrop = screen.getByRole("button", "Close navigation", { visible: true }).first();
  if (await backdrop.count()) {
    const box = (await backdrop.boundingBox())!;
    await screen.tapAt({ x: Math.round(box.x + box.width) - 12, y: Math.round(box.y + box.height / 2) });
  }
  await expect(screen.getByRole("button", "Close navigation", { visible: true })).toHaveCount(0);
};

/**
 * Shows the bot's panel, which a phone's chat opens without, and leaves it on the page it last showed. Closing it is the
 * caller's: the sheet covers the chat a test may go on to use.
 */
export const showBotPanel = async (screen: Screen, name: string): Promise<Locator> => {
  // A phone keeps the roster in the navigation drawer, over the chat the panel belongs to; the wide layout has no drawer
  // to dismiss, and one the page never opened is not there at all.
  await hideRoster(screen);
  const panel = botPanel(screen, name);
  const show = screen.getByRole("button", "Show the bot panel");
  await expect.poll(async () => (await panel.count()) > 0 || (await show.count()) > 0).toBe(true);
  if (await panel.count() === 0) await show.tap();
  await expect(panel).toBeVisible();
  return panel;
};

/** Shows the panel and walks back to the bot's overview, whatever page the sheet last showed. */
export const panelOverview = async (screen: Screen, name: string): Promise<Locator> => {
  const panel = await showBotPanel(screen, name);
  const back = screen.getByRole("button", `Back to ${name}`);
  if (await back.count()) await back.tap();
  await expect(screen.getByLabel(`About ${name}`)).toBeVisible();
  return panel;
};

/** Closes the panel at either width, so a phone's sheet stops covering the chat a test goes on to use. */
export const hideBotPanel = async (screen: Screen): Promise<void> => {
  const close = screen.getByRole("button", "Close the bot panel");
  if (await close.count()) await close.last().tap();
  await expect(screen.getByRole("button", "Show the bot panel")).toBeVisible();
};

/** The roster, switched to Bots: the sidebar's tab on the web, the drawer a phone opens first. The tab's own label
 * carries the roster's mark while a bot has a turn nobody read ("Bots , unread"), which is still the Bots tab. */
export const roster = async (screen: Screen, hui: Hui): Promise<void> => {
  await hui.sessionList();
  await screen.getByRole("tab", /^Bots(?:\s*, unread)?$/u).tap();
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
};

/** Opens a bot's chat from its roster, which a phone draws in the navigation drawer. */
export const openBot = async (screen: Screen, hui: Hui, name: string): Promise<void> => {
  const row = screen.getByLabel(new RegExp(`^${name},`, "u"));
  await roster(screen, hui);
  await expect(row).toBeVisible();
  await row.tap();
};
