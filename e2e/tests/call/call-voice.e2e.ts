/**
 * A bot's own call voice (CALL-026): its Settings tab's Calls section offers *Default (<Settings' voice>)* and each of
 * GPT-Live's voices, a choice saves at once without a Save button and outlives a reload, and the overview's Setup row
 * *Calls* reads the voice beside the language and opens Settings at Calls.
 *
 * What a call sounds like needs a call, and a headless engine has no microphone (CALL-004), so no call here ever
 * connects: the voice a bot's next call reads is the one the gateway stores for it (`voice.live`), which is what the
 * picks below check. The voice ChatGPT speaks with is CALL-002's to prove.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

type Stored = { voice?: { live?: string; language?: string } };

/** GPT-Live's voices, as the picker labels them (src/lib/voice/calls.ts): its default first. */
const VOICES = ["Cove", "Arbor", "Breeze", "Ember", "Juniper", "Maple", "Sol", "Spruce", "Vale"];

test("Calls → Call voice offers Default and every GPT-Live voice, saves a choice at once, keeps it over a reload and reads it in the Setup row", { tags: ["CALL-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Chorus", soul: "# Who I am\nA fixture bot with a voice of its own.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  const callsRow = () => screen.getByRole("button", /^Calls /u);

  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Chorus");
  // No voice of its own: the row reads the voice Settings chose (GPT-Live's default) and Auto for the language.
  await expect(callsRow()).toBeVisible();
  await expect(callsRow()).toHaveText(/Cove · Auto$/u);

  // The row opens Settings at Calls: the section it names takes the focus.
  await callsRow().tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  const heading = panel.getByRole("heading", "Calls");
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  // The picker offers Default, named after the voice Settings chose, and then each of GPT-Live's own voices.
  await expect(panel.getByLabel("Call voice: Default (Cove)")).toBeVisible();
  await panel.getByLabel("Call voice: Default (Cove)").tap();
  const list = screen.getByRole("listbox", "Call voice");
  await expect(list.getByRole("option", { name: "Default (Cove)" })).toBeVisible();
  for (const voice of VOICES) await expect(list.getByRole("option", { name: voice })).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(VOICES.length + 1);

  // A choice saves at once, with no Save button: the bot's own voice, which its next call reads, and the row says so.
  await expect(panel.getByRole("button", /^Save/u)).toHaveCount(0);
  await list.getByRole("option", { name: "Juniper" }).tap();
  await expect(panel.getByLabel("Call voice: Juniper")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.live).toBe("juniper");

  // The overview's Setup row reads the voice beside the language, and takes the focus back.
  await screen.getByRole("button", "Back to Chorus").tap();
  await expect(callsRow()).toHaveText(/Juniper · Auto$/u);
  await expect(callsRow()).toBeFocused();

  // It persists: after a reload the bot remembers it and the row still reads it.
  await hui.reload();
  const reloaded = await panelOverview(screen, "Chorus");
  await expect(callsRow()).toHaveText(/Juniper · Auto$/u);
  await expect.poll(async () => (await stored()).voice?.live).toBe("juniper");
  await callsRow().tap();
  await expect(reloaded.getByLabel("Call voice: Juniper")).toBeVisible();

  // Default follows Settings' voice again, and the row goes back to naming it.
  await reloaded.getByLabel("Call voice: Juniper").tap();
  await screen.getByRole("listbox", "Call voice").getByRole("option", { name: "Default (Cove)" }).tap();
  await expect(reloaded.getByLabel("Call voice: Default (Cove)")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.live).toBeFalsy();
  await screen.getByRole("button", "Back to Chorus").tap();
  await expect(callsRow()).toHaveText(/Cove · Auto$/u);
});
