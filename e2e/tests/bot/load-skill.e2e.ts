/** With read and bash both off, the bot still loads a skill it needs: its chat shows the load_skill call and an answer
 * that follows the skill, and a skill that is off is not offered (BOT-034). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview } from "./bot-panel.ts";

type Catalog = { skills: { name: string; enabled: boolean; source: string }[]; disabledSkills: { name: string }[] };
const catalog = async (hui: Hui, id: string): Promise<Catalog> => hui.api<Catalog>("GET", `/__hui/bots/${id}/catalog`);
const calling = (name: string) => `E2E_CALL:${Buffer.from(JSON.stringify({ name: "load_skill", input: { name } })).toString("base64url")}`;

test("with read and bash off a bot loads a skill it needs from its chat, and a skill that is off is refused", { tags: ["BOT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Learner", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Learner");
  await screen.getByText("Tools & skills", { exact: true }).tap();

  // A bot with neither file tool can still load one of its skills.
  for (const label of ["Read files (read)", "Shell (bash)"]) {
    const tool = screen.getByRole("switch", label);
    await expect(tool).toBeChecked();
    await hui.flip(tool);
    await expect(tool).toBeChecked({ checked: false });
  }
  const offered = await catalog(hui, bot.id);
  const skill = offered.skills.find((candidate) => candidate.enabled)!;
  expect(skill).toBeDefined();
  await expect.poll(async () => (await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${bot.id}`)).bot.disabledTools).toEqual(["read", "bash"]);
  await hideBotPanel(screen);

  await message.fill(calling(skill.name));
  await send.tap();
  await expect(transcript.getByText("Used 1 tool")).toBeVisible();
  await expect(transcript.getByText("Used load skill")).toHaveCount(0);
  await transcript.getByText("Used 1 tool").tap();
  await expect(transcript.getByRole("button", /Used load skill/u)).toBeVisible();
  const answer = transcript.getByText(/^tool answered: /u);
  await expect(answer).toBeVisible();
  await expect(answer).toContainText(`<skill name="${skill.name}"`);
  await expect(idle).toBeVisible();

  // Turned off, the same skill is no longer the bot's to load.
  await panelOverview(screen, "Learner");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  const own = screen.getByRole("switch", `Skill ${skill.name}`);
  await expect(own).toBeChecked();
  await hui.flip(own);
  await expect(own).toBeChecked({ checked: false });
  await expect.poll(async () => (await catalog(hui, bot.id)).disabledSkills.map((each) => each.name)).toEqual([skill.name]);
  await hideBotPanel(screen);

  await message.fill(calling(skill.name));
  await send.tap();
  await expect(transcript.getByText(new RegExp(`^tool answered: The operator turned off the ${skill.name} skill\\. Ask for it with request_access if the job needs it\\.$`, "u"))).toBeVisible();
  await expect(idle).toBeVisible();
});
