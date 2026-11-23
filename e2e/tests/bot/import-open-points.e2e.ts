/** An imported bot's first chat: it greets under its own name, goes through its template's open points with the
 * importer's profile name where the previous owner's was, brings its routines and triggers turned off, and its first
 * turn cannot rewrite its persona or profile (BOT-063). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

const bots = async (hui: Hui) => (await hui.api<{ bots: { id: string; name: string; sessionId: string }[] }>("GET", "/__hui/bots")).bots;

/** The roster's + → Import bot…, which the roster's own empty state also offers. */
const openImport = async (screen: Screen, hui: Hui): Promise<Locator> => {
  await hui.open("/");
  await roster(screen, hui);
  await screen.getByRole("button", "New bot").tap();
  await screen.getByText("Import bot…", { exact: true, visible: true }).first().tap();
  return screen.getByRole("dialog", "Import bot");
};

/** Opens one of the preview's folded sections by its summary. */
const openSection = async (dialog: Locator, title: string): Promise<void> => {
  await dialog.getByText(title, { exact: true }).last().tap();
};

/** Imports one of the fixture's folders and creates its bot from the preview. */
const importFolder = async (screen: Screen, hui: Hui, folder: string, name: string): Promise<void> => {
  const dialog = await openImport(screen, hui);
  await hui.attach(screen.getByLabel("Choose folder…"), [folder]);
  await dialog.getByRole("button", "Preview").tap();
  await expect(screen.getByRole("dialog", `Import ${name}`)).toBeVisible();
  await screen.getByRole("dialog", `Import ${name}`).getByRole("button", "Create bot").tap();
};

test("an imported bot greets under its own name, takes the importer's profile name where the template had the previous owner's, brings its routines and triggers off, and cannot rewrite its persona or profile in its first turn", { tags: ["BOT-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Record<string, unknown>>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, profileName: "Morgan" });
  const transcript = screen.getByTestId("transcript");

  // The template's open points, as the preview shows them, with the importer's name where the previous owner's was.
  const dialog = await openImport(screen, hui);
  await hui.attach(screen.getByLabel("Choose folder…"), ["open-points-template"]);
  await dialog.getByRole("button", "Preview").tap();
  const preview = screen.getByRole("dialog", "Import Reviewer");
  await expect(preview.getByText(/^Imported text is untrusted: read it below before you create the bot\./u)).toBeVisible();
  await expect(preview.getByText(/I review what Morgan asks me to before anyone else reads it/u)).toBeVisible();
  await openSection(preview, "BOOTSTRAP.md");
  await expect(preview.getByText(/Written for Morgan: the GitHub CLI signed in/u)).toBeVisible();
  await expect(preview.getByText("1, disabled", { exact: true })).toHaveCount(2);
  await preview.getByRole("button", "Create bot").tap();

  // Its chat opens on its note and its first turn greets, under its own name.
  await expect(transcript.getByText("Reviewer was created")).toBeVisible();
  await expect(transcript.getByText(/^Hi! I came from a template someone shared\. First thing to agree: which repositories should I watch for pull requests\?$/u)).toBeVisible();
  await expect(screen.getByTestId("chat-header").getByText("Reviewer", { exact: true })).toBeVisible();
  const reviewer = (await bots(hui)).find((bot) => bot.name === "Reviewer")!;
  expect((await hui.api<{ soul: string | null }>("GET", `/__hui/bots/${reviewer.id}/soul`)).soul).toContain("I review what Morgan asks me to");
  expect((await hui.api<{ soul: string | null }>("GET", `/__hui/bots/${reviewer.id}/soul`)).soul).not.toContain("{{user}}");

  // What it does on its own arrives off: neither kind runs until the operator turns it on.
  await expect.poll(async () => (await hui.api<{ tasks: { sessionId: string; name: string; enabled: boolean }[] }>("GET", "/__hui/automation")).tasks
    .filter((task) => task.sessionId === reviewer.sessionId).map(({ name, enabled }) => ({ name, enabled }))).toEqual([{ name: "Morning sweep", enabled: false }]);
  expect((await hui.api<{ triggers: { name: string; enabled: boolean }[] }>("GET", `/__hui/bots/${reviewer.id}/triggers`)).triggers
    .map(({ name, enabled }) => ({ name, enabled }))).toEqual([{ name: "Inbox watch", enabled: false }]);

  // Its first turn is not the operator's: the setup it followed cannot rewrite who it is or how it is called.
  const before = (await bots(hui)).length;
  await importFolder(screen, hui, "hijack-template", "Hijacker");
  await expect(transcript.getByText("Hijacker was created")).toBeVisible();
  await expect(transcript.getByText(/^tool answered: Only the operator changes your soul, and this turn was started by a routine, a trigger, another bot, a subagent's report, a session or your import\. Ask the operator instead\. \| Only the operator changes your name, title or look, and this turn was started by a routine, a trigger, another bot, a subagent's report, a session or your import\. Ask the operator instead\.$/u)).toBeVisible();
  await expect(screen.getByTestId("chat-header").getByText("Hijacker", { exact: true })).toBeVisible();
  const hijacker = (await bots(hui)).find((bot) => bot.name === "Hijacker")!;
  expect((await bots(hui)).length).toBe(before + 1);
  expect((await hui.api<{ soul: string | null }>("GET", `/__hui/bots/${hijacker.id}/soul`)).soul).toContain("E2E_ORIGINAL_SOUL");
  expect((await hui.api<{ soul: string | null }>("GET", `/__hui/bots/${hijacker.id}/soul`)).soul).not.toContain("E2E_HIJACK_SOUL");
});
