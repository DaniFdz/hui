/** A bot's overview shows its face, name, title and what it is doing with Edit, its Routines and Triggers with a switch
 * and a + that opens their page on its add form, the latest runs of both newest first, and Setup rows that open their page
 * and take the focus back on Back, split in two columns on a wide panel (BOT-019). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const PAGES = [
  ["Tagging", "Settings"],
  ["Model", "Settings"],
  ["Tools & skills", "Tools & skills"],
  ["Memory", "Memory"],
  ["Calls", "Settings"],
  ["Workspace", "Settings"],
] as const;

const routineRuns = async (hui: Hui, sessionId: string) =>
  (await hui.api<{ runs: { sessionId: string; taskName: string; status: string }[] }>("GET", "/__hui/automation")).runs
    .filter((run) => run.sessionId === sessionId && run.status === "completed");

test("a bot's overview shows its profile, its routines and triggers with their switches and +, its latest runs newest first, and Setup rows that open their page and take the focus back, split in two columns on a wide panel", { tags: ["BOT-019"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Atlas", title: "Fixture atlas", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const task = (await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Weekly sweep", sessionId: bot.sessionId, prompt: "Sweep the week.", enabled: true,
    schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" },
  })).task;
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it." });

  // One run of each kind, the routine first, so Activity has them newest first.
  await hui.api("POST", `/__hui/automation/tasks/${task.id}/run`);
  await expect.poll(async () => (await routineRuns(hui, bot.sessionId)).length).toBe(1);
  await hui.api("POST", hook.path, { events: [{ id: "one", summary: "a review", details: "raw", at: new Date().toISOString() }] });
  await expect.poll(async () => (await hui.api<{ runs: unknown[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs.length).toBe(1);

  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Atlas");
  await expect(panel.getByRole("heading", "Atlas")).toBeVisible();
  await expect(panel.getByText("Fixture atlas · Idle")).toBeVisible();
  await expect(panel.getByRole("button", "Edit Atlas")).toBeVisible();
  await expect.poll(async () => (await hui.faces()).filter((face) => face.size === "lg")).toHaveLength(1);

  await expect(screen.getByText("Routines", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^Mondays at 09:00 · next /u)).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Weekly sweep")).toBeChecked();
  await expect(screen.getByText("Triggers", { exact: true })).toBeVisible();
  await expect(screen.getByText("Last fired just now")).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Reviews")).toBeChecked();

  // A section's + opens its page on the add form, and Back returns the focus to it.
  await screen.getByRole("button", "Add routine").tap();
  await expect(panel.getByRole("region", "Routines")).toBeVisible();
  await expect(screen.getByPlaceholder("Inbox digest")).toBeVisible();
  await screen.getByRole("button", "Back to Atlas").tap();
  await expect(screen.getByLabel("About Atlas")).toBeVisible();
  await expect(screen.getByRole("button", "Add routine")).toBeFocused();
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();
  await expect(screen.getByPlaceholder("Reviews")).toBeVisible();
  await screen.getByRole("button", "Back to Atlas").tap();
  await expect(screen.getByRole("button", "Add trigger")).toBeFocused();

  // Activity lists both kinds of run, newest first.
  const activity = screen.getByLabel("Activity");
  const triggerRun = activity.getByText("Reviews", { exact: true });
  const routineRun = activity.getByText("Weekly sweep", { exact: true });
  await expect(triggerRun).toBeVisible();
  await expect(routineRun).toBeVisible();
  await expect(activity.getByText("Fired", { exact: true })).toBeVisible();
  await expect.poll(async () => (await triggerRun.boundingBox())!.y < (await routineRun.boundingBox())!.y).toBe(true);

  // Every Setup row opens its page, whose Back returns the focus to that row.
  for (const [name, page] of PAGES) {
    const row = screen.getByRole("button", new RegExp(`^${name}\\b`, "u"));
    await row.tap();
    await expect(panel.getByRole("region", page)).toBeVisible();
    await screen.getByRole("button", "Back to Atlas").tap();
    await expect(screen.getByLabel("About Atlas")).toBeVisible();
    await expect(row).toBeFocused();
  }

  // Narrow, the overview reads as one column; a wide panel splits it in two.
  const setup = screen.getByLabel("Setup");
  const routines = screen.getByLabel("Routines", { exact: true });
  await expect.poll(async () => Math.round((await routines.boundingBox())!.x)).toBe(Math.round((await setup.boundingBox())!.x));
  await screen.getByLabel("Resize the bot panel").focus();
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeGreaterThan((await setup.boundingBox())!.x);
  await expect.poll(async () => (await routines.boundingBox())!.y).toBeLessThan((await setup.boundingBox())!.y);
});
