/**
 * The language a bot speaks on calls (CALL-027): Calls → *Language* offers *Auto (detect)* and Whisper's languages,
 * searchable by name or code under *Search languages*, a choice saves at once and outlives a reload, and the overview's
 * Setup row reads it beside the voice.
 *
 * Speaking it, and writing the call's summary in it, needs a call, and a headless engine has no microphone (CALL-004):
 * the language a bot's next call reads is the one the gateway stores for it (`voice.language`), which is what the picks
 * below check. What the bot says on a call is CALL-002's and CALL-019's to prove.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

type Stored = { voice?: { live?: string; language?: string } };

/** Whisper's languages, plus the row that answers in the caller's (src/lib/voice/languages.ts). */
const LANGUAGES = 100;

test("Calls → Language offers Auto and Whisper's languages searchable by name or by code, saves a choice at once, keeps it over a reload and reads it in the Setup row", { tags: ["CALL-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Polyglot", soul: "# Who I am\nA fixture bot that speaks every language.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  const callsRow = () => screen.getByRole("button", /^Calls /u);

  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Polyglot");
  // Nothing chosen yet: the row reads Auto beside the voice, and Settings → Calls is where that changes.
  await expect(callsRow()).toHaveText(/Cove · Auto$/u);
  await callsRow().tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByLabel("Language: Auto (detect)")).toBeVisible();
  // Auto says what it does: the bot answers in the language it hears.
  await expect(panel.getByText("Auto answers in yours.")).toBeVisible();

  // The picker holds Auto and every one of Whisper's languages.
  await panel.getByLabel("Language: Auto (detect)").tap();
  const list = screen.getByRole("listbox", "Language");
  await expect(list.getByRole("option", { name: "Auto (detect)" })).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(LANGUAGES + 1);

  // Search languages finds one by its English name, each row carrying its code…
  const search = panel.getByLabel("Search languages");
  await search.fill("german");
  await expect(list.getByRole("option", { name: /^German\b/u })).toBeVisible();
  await expect(list.getByRole("option", { name: /^German\b/u })).toHaveText(/de/u);
  await expect(list.getByRole("option")).toHaveCount(1);
  // …and by its code, where the name is not the one Whisper writes it with.
  await search.fill("yue");
  await expect(list.getByRole("option", { name: /^Cantonese\b/u })).toBeVisible();
  await expect(list.getByRole("option", { name: /^Cantonese\b/u })).toHaveText(/yue/u);
  await expect(list.getByRole("option")).toHaveCount(1);

  // A choice saves at once, with no Save button: the bot's own language, which its next call reads, and the row says so.
  await search.fill("german");
  await expect(panel.getByRole("button", /^Save/u)).toHaveCount(0);
  await list.getByRole("option", { name: /^German\b/u }).tap();
  await expect(panel.getByLabel("Language: German")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.language).toBe("de");

  // The overview's Setup row reads the language beside the voice, and takes the focus back.
  await screen.getByRole("button", "Back to Polyglot").tap();
  await expect(callsRow()).toHaveText(/Cove · German$/u);
  await expect(callsRow()).toBeFocused();

  // It persists: after a reload the bot remembers it and the row still reads it.
  await hui.reload();
  const reloaded = await panelOverview(screen, "Polyglot");
  await expect(callsRow()).toHaveText(/Cove · German$/u);
  await expect.poll(async () => (await stored()).voice?.language).toBe("de");
  await callsRow().tap();
  await expect(reloaded.getByLabel("Language: German")).toBeVisible();

  // Auto comes back, and the row reads it as it was before any language was chosen.
  await reloaded.getByLabel("Language: German").tap();
  await screen.getByRole("listbox", "Language").getByRole("option", { name: "Auto (detect)" }).tap();
  await expect(reloaded.getByLabel("Language: Auto (detect)")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.language).toBeFalsy();
  await screen.getByRole("button", "Back to Polyglot").tap();
  await expect(callsRow()).toHaveText(/Cove · Auto$/u);
});
