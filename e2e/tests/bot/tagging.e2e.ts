/** Settings → Tagging saves what it reads to decide when to tag it and who may: the overview's Tagging row shows the
 * choice, and its page's Back puts the focus back on that row (BOT-056). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Stored = { description?: string; tagging?: string };

test("Settings → Tagging saves When to tag it on Enter and Who can tag it offers Anyone, Only when @mentioned and Nobody, which the overview's row shows once Back puts the focus on it", { tags: ["BOT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Router", title: "Fixture helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const stored = async (): Promise<Stored> => (await hui.api<{ bot: Stored }>("GET", `/__hui/bots/${bot.id}`)).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Router");

  const taggingRow = screen.getByRole("button", /^Tagging /u);
  await expect(taggingRow).toHaveText(/Anyone/u);
  await taggingRow.tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Tagging", { exact: true })).toBeFocused();

  const description = panel.getByRole("textbox", "When to tag it");
  await expect(description).toHaveValue("");
  await description.fill("Pull requests that touch the billing service.");
  await description.press("Enter");
  await expect.poll(async () => (await stored()).description).toBe("Pull requests that touch the billing service.");

  const picker = panel.getByLabel(/^Who can tag it: /u);
  await expect(picker).toHaveText(/Anyone/u);
  await picker.tap();
  const listbox = screen.getByRole("listbox", "Who can tag it");
  await expect(listbox.getByRole("option", { name: /^Anyone/u })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /^Only when @mentioned/u })).toBeVisible();
  await expect(listbox.getByRole("option", { name: /^Nobody/u })).toBeVisible();
  await listbox.getByRole("option", { name: /^Only when @mentioned/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("mention");
  await expect(picker).toHaveText(/Only when @mentioned/u);

  await picker.tap();
  await screen.getByRole("listbox", "Who can tag it").getByRole("option", { name: /^Nobody/u }).tap();
  await expect.poll(async () => (await stored()).tagging).toBe("nobody");
  await expect(picker).toHaveText(/Nobody/u);
  await expect(panel.getByText("@router from any chat")).toBeHidden();
  await expect.poll(async () => (await stored()).description).toBe("Pull requests that touch the billing service.");

  await screen.getByRole("button", "Back to Router").tap();
  const back = screen.getByRole("button", /^Tagging /u);
  await expect(back).toHaveText(/Nobody/u);
  await expect(back).toBeFocused();
});
