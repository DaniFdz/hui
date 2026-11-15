/** Archive… asks "Archive <name>?" with the focus on Cancel, and Archive takes the bot off the roster, disables its
 * routines, stops a running turn and offers Restore in its toast, while Cancel leaves the bot as it was (BOT-014). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

type Bot = { id: string; sessionId: string; archived?: boolean; status?: string };

test("Archive… asks first with the focus on Cancel, and Archive takes the bot off the roster with its routines off and its turn stopped while Cancel leaves it as it was", { tags: ["BOT-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: Bot }>("POST", "/__hui/bots", { name: "Sleeper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Early check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 7 * * *", timezone: "UTC" },
  });
  const stored = async (archived = false) => (await hui.api<{ bots: Bot[] }>("GET", `/__hui/bots${archived ? "?archived=1" : ""}`)).bots.find((candidate) => candidate.id === bot.id);
  const routines = async () => (await hui.api<{ tasks: { sessionId: string; enabled: boolean }[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);

  await hui.open(`/bots/${bot.id}`);
  const header = screen.getByTestId("chat-header");
  const archiveItem = async () => {
    await header.getByRole("button", "Actions for Sleeper").tap();
    await screen.getByText("Archive…", { exact: true, visible: true }).tap();
  };

  await archiveItem();
  const dialog = screen.getByRole("dialog", { name: "Archive Sleeper?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", "Cancel")).toBeFocused();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));
  expect((await stored())?.archived).toBeUndefined();

  // A turn under way is stopped along with the bot, which leaves its chat.
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await archiveItem();
  await screen.getByRole("dialog", { name: "Archive Sleeper?" }).getByRole("button", "Archive").tap();
  await expect(screen.getByText("Archived “Sleeper”. Its chat and memory are kept.")).toBeVisible();
  await expect(screen.getByRole("button", "Restore")).toBeVisible();
  await expect.poll(() => hui.url()).not.toMatch(/\/bots\//u);
  await expect.poll(async () => (await stored(true))?.archived).toBe(true);
  await expect.poll(async () => (await stored(true))?.status).not.toBe("working");
  await expect.poll(async () => (await routines()).map((task) => task.enabled)).toEqual([false]);
  await hui.provider.release();

  await roster(screen, hui);
  await expect(screen.getByLabel(/^Sleeper,/u)).toBeHidden();
  await expect(screen.getByRole("button", "Show archived (1)")).toBeVisible();
});
