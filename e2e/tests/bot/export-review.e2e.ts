/** Export… reviews a bot before anything leaves: every change by group with its reason and picker, what the cleanup
 * took out, what it needs, what stays behind and the files as they will be saved, all following the picks; Download
 * saves the zip, and a bot with no soul yet or one that changed since its review is refused with the reason (BOT-061).
 * Missed something? adds a passage the review did not flag, and refuses one the bot doesn't hold as the review read it
 * (BOT-062). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";
import { roster } from "./bot-panel.ts";

const SOUL = [
  "# Who I am",
  "",
  "I review pull requests for Pat Doe. Write to pat.doe@example.com when CI is red.",
  "",
  "I watch acme/widgets.",
  "",
  "Approve only when CI is green.",
  "",
  "Run `gh pr review` when you approve one.",
  "",
].join("\n");

/** Opens a roster row's ⋯ → Export…: focus reveals the desktop's trigger; a phone already draws it in the drawer. */
async function openExport(screen: Screen, hui: Hui, name: string) {
  await hui.open("/");
  await roster(screen, hui);
  const actions = screen.getByRole("button", `Actions for ${name}`);
  await actions.focus();
  await actions.tap();
  await screen.getByText("Export…", { exact: true, visible: true }).first().tap();
  return screen.getByRole("dialog", `Export ${name} as a template`);
}

test("Export… lists every change by group with its reason and picker, the cleanup, what it needs, what stays behind and the files the picks make, Download saves the zip, and a bot with no soul or one changed since its review is refused with the reason", { tags: ["BOT-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", {
    name: "Auditor",
    title: "Fixture reviewer",
    soul: SOUL,
    user: "- The operator prefers short answers.\n",
    memory: "# What I kept\n\nThe fixture project.\n",
  })).bot;
  // The reviewer is Settings' utility model; this instance points it at the fixture.
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const dialog = await openExport(screen, hui, "Auditor");
  await expect(dialog.getByText("Files as they will be saved")).toBeVisible();
  await expect(dialog.getByText("A template someone else can import · auditor.hui-bot.zip")).toBeVisible();

  // Every change in its group, with the reviewer's reason and what its pick comes to.
  await expect(dialog.getByText("Removed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Pat Doe", { exact: true })).toBeHidden();
  await dialog.getByText("Removed", { exact: true }).tap();
  await expect(dialog.getByText("Pat Doe", { exact: true })).toBeVisible();
  await expect(dialog.getByText("A teammate's name.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Becomes .*a teammate/u)).toBeVisible();
  await expect(dialog.getByText("Asked", { exact: true })).toBeVisible();
  await dialog.getByText("Asked", { exact: true }).tap();
  await expect(dialog.getByText("acme/widgets", { exact: true })).toBeVisible();
  await expect(dialog.getByText("The owner's own repository.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Becomes \[ask: the repositories to watch\] · asks: Which repositories should I watch for pull requests\?/u)).toBeVisible();
  await expect(dialog.getByText("Confirmed", { exact: true })).toBeVisible();
  await dialog.getByText("Confirmed", { exact: true }).tap();
  await expect(dialog.getByText("Approve only when CI is green", { exact: true })).toBeVisible();
  await expect(dialog.getByText("An approval rule.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Asks: Should I approve only when CI is green, or do you want other rules\?/u)).toBeVisible();

  // What the cleanup took out before any model read it, what the bot needs, and what never travels.
  await dialog.getByText("Cleaned automatically").tap();
  await expect(dialog.getByText("SOUL.md: an e-mail address (pat.doe@example.com)", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Done before any model read it, and always applied.", { exact: true })).toBeVisible();
  await dialog.getByText("What it needs", { exact: true }).tap();
  await expect(dialog.getByText("The GitHub CLI signed in, with access to the repositories it reviews", { exact: true })).toBeVisible();
  await dialog.getByText("Stays behind").tap();
  await expect(dialog.getByText("USER.md and MEMORY.md, what it knows about you and what it keeps: they describe the operator, and never leave with an export.", { exact: true })).toBeVisible();

  // The files as the picks leave them: the asked passage is a mark until its picker keeps it as written.
  await dialog.getByText("Files as they will be saved").tap();
  await dialog.getByText("SOUL.md", { exact: true }).last().tap();
  await expect(dialog.getByText(/I watch \[ask: the repositories to watch\]\./u)).toBeVisible();
  await dialog.getByLabel(/^What happens to .*acme\/widgets/u).selectOption({ label: "Keep as written" });
  await expect(dialog.getByText("Kept", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/I watch acme\/widgets\./u)).toBeVisible();
  await expect(dialog.getByText(/\[ask: the repositories to watch\]/u)).toHaveCount(0);

  const zip = await hui.download(dialog.getByRole("button", "Download"));
  expect(zip.name).toBe("auditor.hui-bot.zip");
  await expect(dialog).toBeHidden();

  // A bot that changed since its review is refused, and another review is what fixes it.
  const stale = await openExport(screen, hui, "Auditor");
  await expect(stale.getByRole("button", "Download")).toBeVisible();
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { title: "Fixture reviewer, renamed" });
  await stale.getByRole("button", "Download").tap();
  await expect(stale.getByRole("alert")).toHaveText(/Auditor changed since its review/u);
  await expect(stale.getByRole("button", "Review again")).toBeVisible();
  await expect(stale.getByRole("button", "Download")).toBeHidden();
  await stale.getByRole("button", "Cancel").tap();
  await expect(stale).toBeHidden();

  // A bot with no SOUL.md yet has nothing to review, and the dialog says why.
  await hui.api("POST", "/__hui/bots", { name: "Unwritten", title: "Fixture newcomer" });
  const empty = await openExport(screen, hui, "Unwritten");
  await expect(empty.getByRole("alert")).toHaveText(/Unwritten has no soul yet: finish its first conversation, then export it\./u);
  await expect(empty.getByRole("button", "Download")).toBeHidden();
});

test("Missed something? adds a passage no change touches to the changes and to the files as they will be saved, and refuses a passage the bot doesn't hold or one the cleanup changed with the reason", { tags: ["BOT-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  await hui.api("POST", "/__hui/bots", { name: "Misser", title: "Fixture reviewer", soul: `${SOUL}\nThe fixture project is called Quasar.\n` });

  const dialog = await openExport(screen, hui, "Misser");
  await expect(dialog.getByText(/^Added by you\./u)).toHaveCount(0);
  await dialog.getByText("Missed something?").tap();
  const passage = dialog.getByRole("textbox", "Passage");
  const add = dialog.getByRole("button", "Add");

  // A passage the bot doesn't hold, and a sentence whose wording the cleanup changed (the e-mail is gone from it).
  await passage.fill("Mentions a beach house in Lisbon.");
  await add.tap();
  await expect(dialog.getByRole("alert")).toHaveText(/It isn't in the bot's text as the review read it: copy it from text no change touches\./u);
  await passage.fill("Write to pat.doe@example.com when CI is red.");
  await add.tap();
  await expect(dialog.getByRole("alert")).toHaveText(/It isn't in the bot's text as the review read it: copy it from text no change touches\./u);

  // A passage no change touches, taken out and replaced, reaches the changes and the files the picks make.
  await dialog.getByText("Files as they will be saved").tap();
  await dialog.getByText("SOUL.md", { exact: true }).last().tap();
  const soulFile = async () => (await dialog.getByText(/^# Who I am/u).textContent()) ?? "";
  await expect.poll(soulFile).toContain("The fixture project is called Quasar.");
  await passage.fill("The fixture project is called Quasar.");
  await dialog.getByRole("textbox", "Becomes").fill("the fixture project");
  await add.tap();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByText("Removed", { exact: true }).tap();
  await expect(dialog.getByText("The fixture project is called Quasar.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Added by you\./u)).toBeVisible();
  await expect.poll(soulFile).toContain("the fixture project");
  expect(await soulFile()).not.toContain("Quasar");

  await dialog.getByRole("button", "Undo").tap();
  await expect(dialog.getByText("The fixture project is called Quasar.", { exact: true })).toHaveCount(0);
  await expect.poll(soulFile).toContain("The fixture project is called Quasar.");
});
