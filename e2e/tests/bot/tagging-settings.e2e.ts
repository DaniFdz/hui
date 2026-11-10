/** Settings → Tagging saves when to tag a bot as it is typed and confirmed, offers who may tag it, and the overview's
 * Tagging row shows that choice and takes the focus back when its page closes (BOT-056). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; handle: string; name: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const bot = async (hui: Hui, id: string) => (await hui.api<{ bot: { description?: string; tagging: string } }>("GET", `/__hui/bots/${id}`)).bot;

test("Tagging saves when to tag a bot on Enter and who may tag it, and the overview's Tagging row shows the choice and takes the focus back", { tags: ["BOT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const tagger = await makeBot(hui, "Tagger");
  await hui.open(`/bots/${tagger.id}`);
  await panelOverview(screen, "Tagger");

  // The Setup row opens Settings on Tagging.
  const row = screen.getByRole("button", "Tagging Anyone");
  await row.tap();
  const description = screen.getByLabel("When to tag it");
  await expect(description).toBeVisible();

  // When to tag it saves on Enter.
  await description.fill("Reviews pull requests when a PR is ready.");
  await description.press("Enter");
  await expect.poll(async () => (await bot(hui, tagger.id)).description).toBe("Reviews pull requests when a PR is ready.");

  // Who can tag it offers the three answers and saves the one chosen.
  await screen.getByRole("button", "Who can tag it: Anyone").tap();
  const choices = screen.getByRole("listbox", "Who can tag it");
  for (const choice of [/^Anyone /u, /^Only when @mentioned /u, /^Nobody /u]) await expect(choices.getByRole("option", choice)).toBeVisible();
  await choices.getByRole("option", /^Nobody /u).tap();
  await expect(screen.getByRole("button", "Who can tag it: Nobody")).toBeVisible();
  await expect.poll(async () => (await bot(hui, tagger.id)).tagging).toBe("nobody");

  // Back to the overview: the row shows the choice, and the focus is back on it.
  await screen.getByRole("button", "Back to Tagger").tap();
  const chosen = screen.getByRole("button", "Tagging Nobody");
  await expect(chosen).toBeVisible();
  await expect(chosen).toBeFocused();
});
