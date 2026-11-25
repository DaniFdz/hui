/** A bot's own skill opens in an editor and saves its whole SKILL.md; pack and PI skills have no Edit (BOT-071). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { showBotPanel } from "./bot-panel.ts";

test("one of a bot's own skills opens in an editor and saves its whole SKILL.md", { tags: ["BOT-071"] }, async ({ screen, hui }) => {
  const bots = (await hui.api<{ bots: Array<{ id: string; name: string }> }>("GET", "/__hui/bots")).bots;
  const chief = bots.find((bot) => bot.name === "Chief of Staff")!;
  const original = await hui.api<{ name: string; text: string }>("GET", `/__hui/bots/${chief.id}/skills/verify`);
  try {
    await hui.open(`/bots/${chief.id}`);
    await showBotPanel(screen, chief.name);
    await screen.getByRole("button", /^Tools & skills/u).tap();
    await screen.getByLabel("Search skills").fill("verify");
    await expect(screen.getByRole("button", "Edit skill verify")).toBeVisible();
    await screen.getByRole("button", "Edit skill verify").tap();
    const editor = screen.getByLabel("Skill text for verify");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(original.text);
    const next = original.text.replace("## Read the project first", "## Read the project first\n\nEdited by the operator.");
    await editor.fill(next);
    await screen.getByRole("button", "Save skill").tap();
    await expect(editor).toBeHidden();
    await expect.poll(async () => (await hui.api<{ text: string }>("GET", `/__hui/bots/${chief.id}/skills/verify`)).text).toBe(next);
    // A skill HUI ships has no Edit: only its own folder's skills do.
    await screen.getByLabel("Search skills").fill("visualize");
    await expect(screen.getByRole("button", "Edit skill visualize")).toHaveCount(0);
  } finally {
    await hui.api("PUT", `/__hui/bots/${chief.id}/skills/verify`, { text: original.text });
  }
});
