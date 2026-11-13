/** Settings → Workspace suggests folders on the machine the bot runs on, saves the one chosen, refuses a folder that does
 * not exist under the Directory field, takes the bot's folder back on Escape, and locks the field while it works
 * (BOT-030). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview } from "./bot-panel.ts";

const cwdOf = async (hui: Hui, id: string): Promise<string> => (await hui.api<{ bot: { cwd: string } }>("GET", `/__hui/bots/${id}`)).bot.cwd;

test("Settings → Workspace suggests folders, saves the one chosen, refuses a missing one under the field, takes the folder back on Escape, and locks while the bot works", { tags: ["BOT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A folder on this machine for the bot to move to, beside its own.
  const reports = `${join(hui.workspace, "reports")}/`;
  await mkdir(reports, { recursive: true });
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Placer", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Placer");
  await expect.poll(async () => (await hui.api<{ bot: { status: string } }>("GET", `/__hui/bots/${bot.id}`)).bot.status).toBe("idle");
  const own = await cwdOf(hui, bot.id);
  await screen.getByRole("button", /^Workspace /u).tap();
  const workspace = panel.getByRole("region", "Workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Where it works. Can change only while it is idle.")).toBeVisible();
  const directory = workspace.getByRole("combobox", "Directory");
  await expect(directory).toHaveValue(own);

  // Its folders come from the gateway: typing a prefix lists the folders that match, and the chosen one saves once the
  // focus leaves the field.
  await directory.fill(join(hui.workspace, "rep"));
  const suggestions = screen.getByRole("listbox", "Directory");
  await expect(suggestions.getByRole("option", { name: /reports\/$/u })).toBeVisible();
  await suggestions.getByRole("option", { name: /reports\/$/u }).tap();
  await expect(directory).toHaveValue(reports);
  await directory.press("Tab");
  await expect.poll(async () => await cwdOf(hui, bot.id)).toBe(reports);

  // A folder that is not there is refused under the field, and the bot keeps its folder.
  const missing = join(hui.workspace, "nope");
  await directory.fill(missing);
  await directory.press("Tab");
  await expect(workspace.getByText(`No such directory: ${missing}`)).toBeVisible();
  await expect.poll(async () => await cwdOf(hui, bot.id)).toBe(reports);

  // Escape puts the bot's folder back before it saves anything.
  await directory.fill(join(hui.workspace, "elsewhere"));
  await directory.press("Escape");
  await expect(directory).toHaveValue(reports);
  await expect(workspace.getByText(/^No such directory/u)).toBeHidden();
  await expect.poll(async () => await cwdOf(hui, bot.id)).toBe(reports);

  // While it works, the field is locked with the reason, and unlocks once it is idle again.
  await hideBotPanel(screen);
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await panelOverview(screen, "Placer");
  await screen.getByRole("button", /^Workspace /u).tap();
  await expect(workspace.getByText("It is working. The directory can change once it is idle.")).toBeVisible();
  await expect(directory).toBeDisabled();
  await hui.provider.release();
  await expect(directory).toBeEnabled();
  await expect(workspace.getByText("Where it works. Can change only while it is idle.")).toBeVisible();
  await expect.poll(async () => await cwdOf(hui, bot.id)).toBe(reports);
});
