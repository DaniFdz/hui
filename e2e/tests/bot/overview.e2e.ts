/** A bot's overview in its panel: its face, name, title and what it is doing with Edit; Routines and Triggers with a switch each and a + that opens their page on its add form; Activity with both kinds of run newest first; and Setup rows that each open their page, whose Back returns to the overview with the focus on that row, the whole in two columns when the panel is wide (BOT-019). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Runs = { runs: { taskName: string; status: string }[] };

test("the overview reads the bot's profile, routines, triggers, activity and setup, its rows open their page and take the focus back from Back, and a wide panel splits it in two columns", { tags: ["BOT-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Scout", title: "Fixture helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const routine = (await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Morning check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  })).task;
  const trigger = (await hui.api<{ trigger: { id: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews" })).trigger;
  const idle = () => expect.poll(async () => (await hui.api<{ bots: { id: string; status: string }[] }>("GET", "/__hui/bots")).bots.find((entry) => entry.id === bot.id)?.status).toBe("idle");

  await hui.api("POST", `/__hui/automation/tasks/${routine.id}/run`);
  await expect.poll(async () => (await hui.api<Runs>("GET", "/__hui/automation")).runs.find((run) => run.taskName === "Morning check")?.status).toBe("completed");
  await idle();
  await hui.api("POST", `/__hui/bots/${bot.id}/triggers/${trigger.id}/test`);
  await expect.poll(async () => (await hui.api<{ runs: { triggerName: string; status: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs.find((run) => run.triggerName === "Reviews")?.status).toBe("fired");
  await idle();

  await hui.open(`/bots/${bot.id}`);
  const panel = screen.getByLabel("Scout: bot panel");
  const back = screen.getByRole("button", "Back to Scout");
  const row = (name: RegExp) => panel.getByRole("button", name);

  await expect(panel.getByText("Scout", { exact: true })).toBeVisible();
  await expect(panel.getByText("Fixture helper · Idle")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Scout")).toBeVisible();
  const faces = await hui.faces();
  expect(faces.filter((face) => face.size === "lg")).toEqual([expect.objectContaining({ emoji: "", color: expect.any(String) })]);
  expect(faces.find((face) => face.size === "lg")?.shape).toBeTruthy();

  await expect(panel.getByRole("switch", "Enable Morning check")).toBeChecked();
  await expect(panel.getByRole("switch", "Enable Reviews")).toBeChecked();
  await expect(row(/^Morning check Daily at /u)).toBeVisible();
  await expect(row(/^Reviews (?!Fired)/u)).toBeVisible();

  const at = async (name: RegExp) => (await row(name).boundingBox())!;
  const completed = await at(/^Morning check Completed · /u);
  const fired = await at(/^Reviews Fired · /u);
  expect(fired.y).toBeLessThan(completed.y);
  await expect(row(/^Morning check Completed · .*Fixture response\.$/u)).toBeVisible();

  await row(/^Add routine$/u).tap();
  await expect(panel.getByPlaceholder("Inbox digest")).toBeFocused();
  await back.tap();
  await expect(panel.getByText("Fixture helper · Idle")).toBeVisible();
  await row(/^Add trigger$/u).tap();
  await expect(panel.getByPlaceholder("Reviews")).toBeFocused();
  await back.tap();
  await expect(panel.getByText("Fixture helper · Idle")).toBeVisible();

  for (const setup of ["Tagging", "Model", "Calls", "Workspace"]) {
    const setupRow = row(new RegExp(`^${setup} `, "u"));
    await setupRow.tap();
    await expect(panel.getByLabel("Settings")).toBeVisible();
    await back.tap();
    await expect(setupRow).toBeFocused();
  }
  await row(/^Tools & skills /u).tap();
  await expect(panel.getByText("Available tools", { exact: true })).toBeVisible();
  await back.tap();
  await expect(row(/^Tools & skills /u)).toBeFocused();
  await row(/^Memory /u).tap();
  await expect(panel.getByText("Add memory", { exact: true })).toBeVisible();
  await back.tap();
  await expect(row(/^Memory /u)).toBeFocused();
  await expect(row(/^Tagging Anyone$/u)).toBeVisible();
  await expect(row(/^Model Gateway default$/u)).toBeVisible();
  await expect(row(/^Tools & skills Everything on$/u)).toBeVisible();
  await expect(row(/^Workspace Its own folder$/u)).toBeVisible();

  const setup = panel.getByText("Setup", { exact: true });
  const routines = panel.getByText("Routines", { exact: true });
  const activity = panel.getByText("Activity", { exact: true });
  const stacked = async () => {
    const [s, r, a] = [await setup.boundingBox(), await routines.boundingBox(), await activity.boundingBox()];
    return { reading: [r!.y, a!.y, s!.y].map(Math.round), columns: Math.round(r!.x - s!.x) };
  };
  await expect.poll(async () => (await stacked()).columns).toBe(0);
  const narrow = (await stacked()).reading;
  expect(narrow).toEqual([...narrow].sort((left, right) => left - right));

  await screen.getByLabel("Resize the bot panel").focus();
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await expect.poll(async () => (await stacked()).columns > 200).toBe(true);
  await expect.poll(async () => (await routines.boundingBox())!.y < (await setup.boundingBox())!.y).toBe(true);
});
