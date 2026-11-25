/** Settings → Model saves the bot's model, thinking level and utility model on their own, the row saying Saving… while
 * it is sent, they apply from its next turn, Gateway default clears what the bot had, and the overview's Setup row shows
 * the choice (BOT-029). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Stored = { model?: string; thinking?: string; memoryModel?: string };

const OPUS = "hui-e2e/anthropic/claude-opus-5-5";

test("Settings → Model saves the bot's model, thinking level and utility model each on its own with Saving… while it is sent, Gateway default clears the model and the thinking, and the Setup row shows the choice", { tags: ["BOT-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Chooser", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Chooser");
  const before = await stored();
  await screen.getByRole("button", /^Model/u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Applies from its next turn")).toBeVisible();

  const row = (title: string) => screen.getByTestId("bot-setting").filter({ has: screen.getByText(title, { exact: true }) });
  const pick = async (label: string, option: RegExp) => {
    await panel.getByLabel(new RegExp(`^${label}: `, "u")).tap();

    await screen.getByRole("listbox", label).getByRole("option", { name: option }).tap();
  };
  const modelRow = row("Model");
  const thinkingRow = row("Thinking");
  await expect(panel.getByLabel(/^Thinking: /u)).toBeVisible();
  await expect(panel.getByLabel(/^Utility model: /u)).toBeVisible();

  const save = await hui.intercept("PATCH", new RegExp(`/__hui/bots/${bot.id}$`, "u"));
  await pick("Model", /Opus fixture/u);
  await save.arrived();
  await expect(modelRow.getByText("Saving…")).toBeVisible();
  await expect(thinkingRow.getByText("Saving…")).toHaveCount(0);
  await save.deliver();
  await expect(modelRow.getByText("Saving…")).toBeHidden();
  await expect(panel.getByLabel("Model: Opus fixture")).toBeVisible();
  await expect.poll(async () => (await stored()).model).toBe(OPUS);
  await expect.poll(async () => (await stored()).thinking).toBe(before.thinking);

  await pick("Thinking", /^High$/u);
  await expect.poll(async () => (await stored()).thinking).toBe("high");
  await expect(panel.getByLabel("Thinking: High")).toBeVisible();
  await expect.poll(async () => (await stored()).model).toBe(OPUS);

  await pick("Utility model", /Opus fixture/u);
  await expect.poll(async () => (await stored()).memoryModel).toBe(OPUS);
  await expect(panel.getByLabel("Utility model: Opus fixture")).toBeVisible();
  await expect.poll(async () => (await stored()).model).toBe(OPUS);

  await pick("Thinking", /Gateway default/u);
  await expect.poll(async () => (await stored()).thinking).toBeUndefined();
  await pick("Model", /Gateway default/u);
  await expect.poll(async () => (await stored()).model).toBeUndefined();
  await expect.poll(async () => (await stored()).memoryModel).toBe(OPUS);

  await screen.getByRole("button", "Back to Chooser").tap();
  const modelSetup = screen.getByRole("button", /^Model /u);
  await expect(modelSetup).toHaveText(/Gateway default/u);
  await expect(modelSetup).toBeFocused();
});
