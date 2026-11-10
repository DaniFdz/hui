/** Settings → Tagging saves When to tag it on Enter and offers Anyone, Only when @mentioned and Nobody for who may tag
 * the bot, the overview's Tagging row shows the choice, and Back returns the focus to that row (BOT-056). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

test("Settings → Tagging saves When to tag it on Enter, offers Anyone, Only when @mentioned and Nobody, and the overview's Tagging row shows the choice with the focus back on Back", { tags: ["BOT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Tagged", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const stored = async () => (await hui.api<{ bot: { tagging?: string; description?: string } }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Tagged");
  await screen.getByRole("button", /^Tagging/u).tap();
  await expect(panel.getByRole("region", "Settings")).toBeVisible();
  await expect(panel.getByText("Tagging", { exact: true })).toBeVisible();

  await expect(panel.getByLabel("Who can tag it: Anyone")).toBeVisible();
  await panel.getByLabel(/^Who can tag it: /u).tap();
  const choices = screen.getByRole("listbox", "Who can tag it");
  for (const choice of ["Anyone", "Only when @mentioned", "Nobody"]) {
    await expect(choices.getByRole("option", { name: new RegExp(`^${choice}`, "u") })).toBeVisible();
  }
  await choices.getByRole("option", { name: /^Only when @mentioned/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("mention");
  await expect(panel.getByLabel("Who can tag it: Only when @mentioned")).toBeVisible();

  const when = panel.getByPlaceholder("What it does, and when to tag it");
  await when.fill("Tag it for fixture reviews.");
  await when.press("Enter");
  await expect.poll(async () => (await stored()).description).toBe("Tag it for fixture reviews.");

  await panel.getByLabel(/^Who can tag it: /u).tap();
  await screen.getByRole("listbox", "Who can tag it").getByRole("option", { name: /^Nobody/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("nobody");
  await expect.poll(async () => (await hui.api<{ bot: { description?: string } }>("GET", `/__hui/bots/${bot.id}`)).bot.description).toBe("Tag it for fixture reviews.");

  await screen.getByRole("button", "Back to Tagged").tap();
  const row = screen.getByRole("button", /^Tagging/u);
  await expect(row).toHaveText(/Nobody/u);
  await expect(row).toBeFocused();
});
