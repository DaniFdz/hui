/**
 * Import bot… reads a fixture archive of HUI's own export (`e2e/fixtures/files/auditor-template`), and Preview shows
 * everything creating it would do — its face and handle, where it came from, the untrusted-text note, SOUL.md, its
 * setup, its skills, its routine and trigger disabled, the tool it turned off and what was left out — before anything
 * exists; Create bot opens its chat on "<name> was created" and its first message. A pasted template brings the opener
 * it carries as the bot's first message, and a source HUI can't read says why (BOT-060).
 *
 * The archive is a folder of text rather than a zip, so what the preview reads is reviewable in the diff. The opener
 * comes from a pasted character card: a HUI export carries no first message of its own.
 */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

type Bot = { id: string; name: string };

const bots = async (hui: Hui) => (await hui.api<{ bots: Bot[] }>("GET", "/__hui/bots")).bots;

/** The roster's + → Import bot…, which the roster's own empty state also offers. */
const openImport = async (screen: Screen, hui: Hui): Promise<Locator> => {
  await hui.open("/");
  await roster(screen, hui);
  await screen.getByRole("button", "New bot").tap();
  await screen.getByText("Import bot…", { exact: true, visible: true }).first().tap();
  return screen.getByRole("dialog", "Import bot");
};

/** Opens one of the preview's folded sections by its summary. The facts list above them repeats "Skills", "Routines" and
 * "Triggers" as terms, so the last match, in reading order, is the section's own line. */
const open = async (dialog: Locator, title: string): Promise<void> => {
  await dialog.getByText(title, { exact: true }).last().tap();
};

/** Pastes a template into the dialog's Paste tab and previews it. */
const paste = async (screen: Screen, dialog: Locator, text: string): Promise<void> => {
  await dialog.getByRole("radio", "Paste").tap();
  await screen.getByRole("textbox", "Template").fill(text);
  await dialog.getByRole("button", "Preview").tap();
};

test("Import bot… previews everything a fixture archive would bring before anything exists, Create bot opens its chat on its note and first message, a pasted card brings its opener and an unreadable source says why", { tags: ["BOT-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const before = (await bots(hui)).length;
  let dialog = await openImport(screen, hui);

  // Reading the archive: nothing exists yet, and the dialog says what it picked.
  await hui.attach(screen.getByLabel("Choose folder…"), ["auditor-template"]);
  await expect(dialog.getByText("auditor-template/ (5 files)")).toBeVisible();
  await dialog.getByRole("button", "Preview").tap();
  // The dialog renames itself after the bot it read.
  dialog = screen.getByRole("dialog", "Import Auditor");
  await expect(dialog).toBeVisible();
  expect((await bots(hui)).length).toBe(before);

  // Its identity, where it came from, and the note that its text is untrusted.
  await expect(dialog.getByText("@auditor", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Fixture reviewer · From HUI bot export", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Imported text is untrusted: read it below before you create the bot\./u)).toBeVisible();

  // What it would bring, and what it left out.
  await expect(dialog.getByText("1 of its own, on", { exact: true })).toBeVisible();
  await expect(dialog.getByText("None", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1, disabled", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("1 · disabled", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("1 with you", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/I review pull requests for the fixture team before anyone reads them/u)).toBeVisible();
  await open(dialog, "BOOTSTRAP.md");
  await expect(dialog.getByText(/^# Setting up Auditor/u)).toBeVisible();
  await open(dialog, "Skills");
  await expect(dialog.getByText(/verify — Check a pull request against the fixture's checklist/u)).toBeVisible();
  await open(dialog, "Routines");
  await expect(dialog.getByText(/^Morning check · Every day/u)).toBeVisible();
  await expect(dialog.getByText("Check the build and report what is red.", { exact: true })).toBeVisible();
  await open(dialog, "Triggers");
  await expect(dialog.getByText(/^Pull requests · Any event · PR links only · cooldown 5 min/u)).toBeVisible();
  await expect(dialog.getByText("Read the pull request and say whether it is ready.", { exact: true })).toBeVisible();
  await open(dialog, "Tools turned off");
  await expect(dialog.getByText("bash", { exact: true })).toBeVisible();
  await open(dialog, "Left out");
  await expect(dialog.getByText("A trigger HUI can't read: Merged·twice.", { exact: true })).toBeVisible();

  // Create bot makes it and opens its chat, where its first turn goes through the setup the archive brought.
  await dialog.getByRole("button", "Create bot").tap();
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Auditor was created")).toBeVisible();
  await expect.poll(() => hui.url()).toMatch(/\/bots\/[0-9a-f-]+$/u);
  await expect(transcript.getByText(/^Hi! I came from a template someone shared\./u)).toBeVisible();
  const created = (await bots(hui)).find((bot) => bot.name === "Auditor")!;
  expect((await bots(hui)).length).toBe(before + 1);
  expect((await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${created.id}`)).bot.disabledTools).toEqual(["bash"]);

  // Its route and trigger came with it, off, as an import's do.
  await expect.poll(async () => (await hui.api<{ tasks: { name: string; sessionId: string; enabled: boolean }[] }>("GET", "/__hui/automation")).tasks
    .filter((task) => task.name === "Morning check").map((task) => task.enabled)).toEqual([false]);
  expect((await hui.api<{ triggers: { name: string; enabled: boolean }[] }>("GET", `/__hui/bots/${created.id}/triggers`)).triggers
    .map(({ name, enabled }) => ({ name, enabled }))).toEqual([{ name: "Pull requests", enabled: false }]);

  // A pasted character card brings its opener, which the imported bot sends as its first message.
  dialog = await openImport(screen, hui);
  await paste(screen, dialog, JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: {
    name: "Robin", nickname: "Fixture keeper", description: "I keep the notes the fixture team writes.", personality: "warm",
    first_mes: "Hi! I'm Robin, and I keep the notes.",
  } }));
  dialog = screen.getByRole("dialog", "Import Robin");
  await expect(dialog.getByText("Fixture keeper · From Character card", { exact: true })).toBeVisible();
  await open(dialog, "First message");
  await expect(dialog.getByText(/^Hi! I'm Robin, and I keep the notes\./u)).toBeVisible();
  await dialog.getByRole("button", "Create bot").tap();
  await expect(screen.getByTestId("transcript").getByText("Robin was created")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText("Hi! I'm Robin, and I keep the notes.")).toBeVisible();

  // A source HUI can't read says why, and creates nothing.
  dialog = await openImport(screen, hui);
  const counted = (await bots(hui)).length;
  await paste(screen, dialog, "{\"hello\": \"world\"}");
  await expect(dialog.getByRole("alert")).toHaveText(/^HUI found no bot to import in this JSON\. It reads: /u);
  await expect(dialog.getByRole("button", "Create bot")).toHaveCount(0);
  expect((await bots(hui)).length).toBe(counted);
});
