/** Asked to check something on a schedule, a bot adds its own temporary routine, the Routines page and Automations show who made it and its limits, its own turn removes it, and its "Manage its own routines" switch gates it (BOT-043). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Task = { id: string; name: string; sessionId: string; until?: string; runsLeft?: number; createdBy?: { kind: string; handle?: string } };

const makeBot = async (hui: Hui) =>
  (await hui.api<{ bot: { id: string; name: string; handle: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Clerk", soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("Asked to check something on a schedule, a bot adds a temporary routine that both pages show with who made it and its limits, its own turn removes it, and turning its routines switch off stops it adding another", { tags: ["BOT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui);
  const tasks = async () => (await hui.api<{ tasks: Task[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);

  await screen.getByText("Tools & skills", { exact: true }).tap();
  await expect(screen.getByRole("switch", "Manage its own routines (routines)")).toBeChecked();
  const catalog = (await hui.api<{ tools: { name: string; powerful?: boolean }[] }>("GET", `/__hui/bots/${bot.id}/catalog`)).tools;
  expect(catalog.find((tool) => tool.name === "routines")).toEqual(expect.objectContaining({ powerful: false }));
  await expect(screen.getByText("Powerful", { exact: true })).toHaveCount(catalog.filter((tool) => tool.powerful).length);

  await screen.getByRole("button", `Back to ${bot.name}`).tap();
  await screen.getByLabel("Message").fill("E2E_ROUTINE_ADD check whether PR #82 is green every 5 minutes until it is");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(/^routines answered: /u)).toBeVisible();
  const addCall = transcript.getByRole("button", /^Used routines/u);
  if (!(await addCall.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await expect(addCall).toBeVisible();
  await expect.poll(async () => (await tasks()).map((task) => task.name)).toEqual(["Watch #82"]);
  const routine = (await tasks())[0]!;
  expect(routine.createdBy).toEqual(expect.objectContaining({ kind: "bot", handle: bot.handle }));
  expect(routine.runsLeft).toBe(3);
  expect(Date.parse(routine.until!)).toBeGreaterThan(Date.now());

  await screen.getByRole("button", "Add routine").tap();
  const facts = screen.getByLabel("About Watch #82");
  await expect(facts.getByText(`made by @${bot.handle}`)).toBeVisible();
  await expect(facts.getByText(/^until /u)).toBeVisible();
  await expect(facts.getByText("3 runs left")).toBeVisible();

  await hui.open("/cron");
  await expect(screen.getByTestId("page-title")).toHaveText("Automations");
  const automationRow = screen.getByRole("button", "Edit Watch #82");
  await expect(automationRow.getByText(`made by @${bot.handle}`)).toBeVisible();
  await expect(automationRow.getByText(/^until /u)).toBeVisible();
  await expect(automationRow.getByText("3 runs left")).toBeVisible();

  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", "Add routine").tap();
  await expect(facts).toBeVisible();
  await screen.getByRole("button", "Run now: Watch #82").tap();
  await expect(screen.getByText(/^No routines yet\./u)).toBeVisible();
  await expect.poll(async () => await tasks()).toEqual([]);
  await expect(screen.getByRole("button", "Delete Watch #82")).toBeHidden();

  await hui.open("/cron");
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Watch #82")).toBeHidden();

  await hui.open(`/bots/${bot.id}`);
  await screen.getByText("Tools & skills", { exact: true }).tap();
  await hui.flip(screen.getByRole("switch", "Manage its own routines (routines)"));
  await expect(screen.getByRole("switch", "Manage its own routines (routines)")).toBeChecked({ checked: false });
  await expect.poll(async () => (await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${bot.id}`)).bot.disabledTools).toEqual(["routines"]);

  await screen.getByLabel("Message").fill("E2E_ROUTINE_ADD check whether PR #82 is green every 5 minutes again");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(/^routines answered: /u)).toHaveCount(3);
  expect((await transcript.getByText(/^routines answered: /u).allTextContents()).at(-1)).not.toContain("Added the routine");
  expect(await tasks()).toEqual([]);
});