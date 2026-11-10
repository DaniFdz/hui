/**
 * A bot's own call voice (CALL-026): its Settings tab's Calls section offers Default, which follows Settings → Models →
 * Calls, and each of GPT-Live's voices; a choice saves at once, is still there after a reload, and the overview's Setup
 * row reads the voice beside the language and opens Settings at Calls.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

type Stored = { voice?: { live?: string; language?: string } };

const VOICES = ["Cove", "Arbor", "Breeze", "Ember", "Juniper", "Maple", "Sol", "Spruce", "Vale"];

test("Calls → Call voice offers Default and GPT-Live's voices, saves a choice at once, keeps it after a reload and reads it in the Setup row", { tags: ["CALL-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Chorus", soul: "# Who I am\nA bot the CALL area calls.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Chorus");
  const setup = screen.getByRole("button", /^Calls /u);

  // Settings → Models' voice is GPT-Live's default until someone chooses another, and the row reads it.
  await expect(setup).toHaveText(/Cove · Auto/u);
  await setup.tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByRole("heading", "Calls")).toBeVisible();

  // The picker offers Default, named after the Settings' voice, then every voice GPT-Live has.
  await panel.getByLabel("Call voice: Default (Cove)").tap();
  const list = screen.getByRole("listbox", "Call voice");
  await expect(list.getByRole("option", { name: /^Default \(Cove\)$/u })).toBeVisible();
  for (const voice of VOICES) await expect(list.getByRole("option", { name: new RegExp(`^${voice}$`, "u") })).toBeVisible();
  expect(await list.getByRole("option").count()).toBe(VOICES.length + 1);

  // A choice saves at once: no Save button, the bot's own voice, and the picker reads it.
  await list.getByRole("option", { name: /^Sol$/u }).tap();
  await expect(panel.getByLabel("Call voice: Sol")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.live).toBe("sol");

  // The overview's Setup row reads the voice beside the language, and stays that way over a reload.
  await screen.getByRole("button", "Back to Chorus").tap();
  await expect(setup).toHaveText(/Sol · Auto/u);
  await hui.reload();
  const reloaded = await panelOverview(screen, "Chorus");
  await expect(screen.getByRole("button", /^Calls /u)).toHaveText(/Sol · Auto/u);
  await expect.poll(async () => (await stored()).voice?.live).toBe("sol");
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(reloaded.getByLabel("Call voice: Sol")).toBeVisible();

  // Clearing it is not one of the choices; the row saves only what the picker offers.
  await reloaded.getByLabel("Call voice: Sol").tap();
  await screen.getByRole("listbox", "Call voice").getByRole("option", { name: /^Default \(Cove\)$/u }).tap();
  await expect.poll(async () => (await stored()).voice?.live).toBeUndefined();
  await expect(reloaded.getByLabel("Call voice: Default (Cove)")).toBeVisible();
});
