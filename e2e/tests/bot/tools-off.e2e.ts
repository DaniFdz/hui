/** Tools & skills groups every tool, labels the powerful ones, searches the skills once there are eight, and a switch
 * saves the whole list so the summary, the overview and the chat's next request follow it (BOT-032). */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview, showBotPanel } from "./bot-panel.ts";

type Catalog = {
  tools: { name: string; label: string; group: string; source: string; powerful?: boolean; enabled: boolean }[];
  skills: { name: string; enabled: boolean }[];
  alwaysOn: { name: string }[];
};

const GROUPS: Record<string, string> = { files: "Files", shell: "Shell", hui: "HUI", bots: "Bots" };

test("Tools & skills groups the tools with their Powerful labels, searches the skills, and a switch saves the whole list so the summary, the overview row and the chat's next request follow", { tags: ["BOT-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name: "Tinker", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const catalog = await hui.api<Catalog>("GET", `/__hui/bots/${bot.id}/catalog`);
  await showBotPanel(screen, "Tinker");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Available tools")).toBeVisible();

  // Every tool is listed under the group its catalog entry names, each powerful one labelled.
  for (const group of [...new Set(catalog.tools.map((tool) => tool.group))]) {
    const members = catalog.tools.filter((tool) => tool.group === group);
    const label = group === "extension" ? `Extension: ${members[0]!.source}` : GROUPS[group]!;
    await expect(screen.getByRole("group", new RegExp(`^${label}`, "u")).first()).toBeVisible();
  }
  await expect(screen.getByText("Powerful", { exact: true })).toHaveCount(catalog.tools.filter((tool) => tool.powerful).length);
  await expect(screen.getByText("Always on", { exact: true })).toBeVisible();
  for (const each of catalog.alwaysOn) await expect(screen.getByText(each.name, { exact: true }).first()).toBeVisible();
  for (const tool of catalog.tools) await expect(screen.getByRole("switch", `${tool.label} (${tool.name})`)).toBeChecked();
  const everything = `Everything is on: ${catalog.tools.length} tool${catalog.tools.length === 1 ? "" : "s"} and ${catalog.skills.length} skill${catalog.skills.length === 1 ? "" : "s"}.`;
  await expect(screen.getByText(new RegExp(`^${everything} Changes apply from its next request\\.$`, "u"))).toBeVisible();

  // The skills are searchable once there are eight: a match narrows them, nothing matching says so.
  const skill = catalog.skills[0]!;
  const search = screen.getByLabel("Search skills");
  await expect(search).toBeVisible();
  await search.fill(skill.name);
  await expect(screen.getByRole("group", "Skills").getByText(skill.name, { exact: true })).toBeVisible();
  await search.fill("no-skill-by-this-name");
  await expect(screen.getByText("No skill matches “no-skill-by-this-name”.")).toBeVisible();
  await search.fill("");

  // A switch sends the whole list: the tool is off on the page, in the summary, on the overview and in the record.
  const off = catalog.tools.find((tool) => tool.name === "bash");
  if (!off) throw new Error("the fixture bot offers no bash tool to switch off");
  await hui.flip(screen.getByRole("switch", `${off.label} (${off.name})`));
  await expect(screen.getByRole("switch", `${off.label} (${off.name})`)).toBeChecked({ checked: false });
  await expect(screen.getByText(new RegExp(`^1 of ${catalog.tools.length} tools is off\\. Changes apply from its next request\\.$`, "u"))).toBeVisible();
  const stored = await hui.api<{ bot: { disabledTools?: string[]; disabledSkills?: unknown[] } }>("GET", `/__hui/bots/${bot.id}`);
  expect(stored.bot.disabledTools).toEqual([off.name]);
  expect(await hui.api<{ disabledTools: string[] }>("GET", `/__hui/bots/${bot.id}/catalog`)).toEqual(expect.objectContaining({ disabledTools: [off.name] }));

  await screen.getByRole("button", "Back to Tinker").tap();
  await expect(screen.getByRole("button", "Tools & skills 1 tool off")).toBeVisible();
  await expect(screen.getByLabel("About Tinker")).toBeVisible();
  await hideBotPanel(screen);

  // The chat's next request no longer carries it, while the others stay.
  const log = join(dirname(hui.workspace), "artifacts", "provider.jsonl");
  const requests = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as { tools?: { name: string }[] });
  const before = (await requests()).length;
  await screen.getByLabel("Message").fill("Which tools do you have?");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const lines = await requests();
  expect(lines.length).toBeGreaterThan(before);
  const sent = lines.at(-1)!.tools?.map((tool) => tool.name) ?? [];
  expect(sent).not.toContain(off.name);
  expect(sent).toContain("read");

  await panelOverview(screen, "Tinker");
  await expect(screen.getByRole("button", "Tools & skills 1 tool off")).toBeVisible();
});
