/** Delete… asks "Delete <name>?" saying what goes and what stays, Cancel keeps the bot, and Delete removes it with
 * "Deleted <name>.", returning home when its chat was open (BOT-016). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const exists = async (hui: Hui, id: string) =>
  [...(await hui.api<{ bots: { id: string }[] }>("GET", "/__hui/bots")).bots,
    ...(await hui.api<{ bots: { id: string }[] }>("GET", "/__hui/bots?archived=1")).bots].some((bot) => bot.id === id);

test("Delete… asks first and names what leaves HUI and what stays, Cancel keeps the bot, and Delete takes it off the roster from its chat's menu or a row's and returns home", { tags: ["BOT-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const doomed = await makeBot(hui, "Doomed");
  await hui.open(`/bots/${doomed.id}`);
  const header = screen.getByTestId("chat-header");

  await header.getByRole("button", "Actions for Doomed").tap();
  await screen.getByText("Delete…", { exact: true, visible: true }).tap();
  const dialog = screen.getByRole("dialog", { name: "Delete Doomed?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveText(/Doomed is deleted for good: its chat leaves HUI, and its routines, its memory and its folder \(SOUL\.md and every file in it\) go\. A workspace you chose for it stays\. This cannot be undone\./u);
  await expect(dialog.getByRole("button", "Cancel")).toBeFocused();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${doomed.id}$`, "u"));
  expect(await exists(hui, doomed.id)).toBe(true);

  await header.getByRole("button", "Actions for Doomed").tap();
  await screen.getByText("Delete…", { exact: true, visible: true }).tap();
  await screen.getByRole("dialog", { name: "Delete Doomed?" }).getByRole("button", "Delete").tap();
  await expect(screen.getByText("Deleted Doomed.")).toBeVisible();
  await expect.poll(() => hui.url()).not.toMatch(/\/bots\//u);
  await expect.poll(() => exists(hui, doomed.id)).toBe(false);
  await roster(screen, hui);
  await expect(screen.getByLabel(/^Doomed,/u)).toBeHidden();

  // A row's ⋯ → Delete… removes a bot whose chat is not open, and leaves the chat showing.
  const shelved = await makeBot(hui, "Unwanted");
  await expect(screen.getByLabel(/^Unwanted,/u)).toBeVisible();
  const row = screen.getByLabel(/^Unwanted,/u);
  await hui.peek(row);
  await screen.getByRole("button", "Actions for Unwanted").tap();
  await screen.getByText("Delete…", { exact: true, visible: true }).tap();
  await screen.getByRole("dialog", { name: "Delete Unwanted?" }).getByRole("button", "Delete").tap();
  await expect(screen.getByText("Deleted Unwanted.")).toBeVisible();
  await expect(row).toBeHidden();
  await expect.poll(() => exists(hui, shelved.id)).toBe(false);
});
