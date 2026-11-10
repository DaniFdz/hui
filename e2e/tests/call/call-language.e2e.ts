/**
 * The language a bot speaks on calls (CALL-027): Calls → Language offers *Auto (detect)* and Whisper's languages,
 * searchable by name or by code, a choice saves at once, is still there after a reload, and the overview's Setup row
 * reads it beside the voice.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

type Stored = { voice?: { live?: string; language?: string } };

test("Calls → Language offers Auto and Whisper's languages searchable by name or code, saves a choice at once, keeps it after a reload and reads it in the Setup row", { tags: ["CALL-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Polyglot", soul: "# Who I am\nA bot the CALL area calls.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Polyglot");

  // Auto until someone chooses a language, and the overview's Setup row says so beside the voice.
  await expect(screen.getByRole("button", /^Calls /u)).toHaveText(/Cove · Auto/u);
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByLabel("Language: Auto (detect)")).toBeVisible();

  // The languages are searched by name or by code, each row carrying its code under the name.
  await panel.getByLabel("Language: Auto (detect)").tap();
  const search = screen.getByLabel("Search languages");
  await search.fill("german");
  const options = screen.getByRole("listbox", "Language");
  await expect(options.getByRole("option", { name: /^German\b/u })).toHaveCount(1);
  await expect(options.getByRole("option")).toHaveCount(1);
  await search.fill("yue");
  await expect(options.getByRole("option", { name: /^Cantonese\b/u })).toHaveCount(1);
  await expect(options.getByRole("option", { name: /^Cantonese\b/u })).toHaveText(/yue/u);

  // A choice saves at once: no Save button, the bot's own language, and the picker reads it.
  await search.fill("german");
  await options.getByRole("option", { name: /^German\b/u }).tap();
  await expect(panel.getByLabel("Language: German")).toBeVisible();
  await expect.poll(async () => (await stored()).voice?.language).toBe("de");

  // The Setup row reads the language beside the voice, and both survive a reload.
  await screen.getByRole("button", "Back to Polyglot").tap();
  await expect(screen.getByRole("button", /^Calls /u)).toHaveText(/Cove · German/u);
  await hui.reload();
  const reloaded = await panelOverview(screen, "Polyglot");
  await expect(screen.getByRole("button", /^Calls /u)).toHaveText(/Cove · German/u);
  await expect.poll(async () => (await stored()).voice?.language).toBe("de");
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(reloaded.getByLabel("Language: German")).toBeVisible();

  // Auto comes back, and says what it does: the bot answers in the language it hears.
  await reloaded.getByLabel("Language: German").tap();
  await expect(reloaded.getByText("Auto answers in yours.")).toBeVisible();
  await screen.getByRole("listbox", "Language").getByRole("option", { name: /^Auto \(detect\)$/u }).tap();
  await expect.poll(async () => (await stored()).voice?.language).toBeUndefined();
  await expect(reloaded.getByLabel("Language: Auto (detect)")).toBeVisible();
});
