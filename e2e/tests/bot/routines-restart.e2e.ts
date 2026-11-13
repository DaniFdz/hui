/**
 * A bot's temporary routine outlives a gateway restart: its limits (the time it ends and the runs it has left) are
 * still on the Routines page and in Automations, it still runs at the time it was given, and the run it leaves behind
 * is followed to its recorded outcome, with its prompt in the chat once — which a second restart does not double
 * (BOT-044).
 *
 * The routine is the bot's own, added through its `routines` tool exactly as a bot adds one, because a temporary
 * routine's limits are what only that tool makes. A run cut off while it was under way is not reached here: it needs a
 * seam that holds a routine's dispatch across the restart, and the fixture has none — the run this test restarts
 * around is due after the gateway is back, so what the second restart proves is that recovery never delivers it
 * twice.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview } from "./bot-panel.ts";

type Task = { id: string; name: string; sessionId: string; until?: string; runsLeft?: number; nextRunAt?: string | null };
type Run = { sessionId: string; taskName: string; status: string; createdAt: string };

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

test("a temporary routine keeps its limits and runs at its time across a gateway restart, and its prompt reaches the chat once", { tags: ["BOT-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const clock = await hui.automationClock();
  const bot = (await hui.api<{ bot: { id: string; name: string; handle: string; sessionId: string } }>("POST", "/__hui/bots",
    { name: "Clerk", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const tasks = async () => (await hui.api<{ tasks: Task[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);
  const runs = async () => (await hui.api<{ runs: Run[] }>("GET", "/__hui/automation")).runs.filter((run) => run.sessionId === bot.sessionId);
  const transcript = screen.getByTestId("transcript");
  const due = new Date(clock.now + 20_000).toISOString();

  // The bot schedules its own temporary routine: two runs at a set time, ending a while after.
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill(`E2E_CALL:${base64({ name: "routines", input: {
    action: "add", name: "Due soon", prompt: "Check the build.", at: due,
    until: new Date(clock.now + 600_000).toISOString(), runs: 2,
  } })} check the build once, at a set time`);
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText(/^tool answered: Added the routine "Due soon"/u)).toBeVisible();
  await expect.poll(async () => (await tasks()).map((task) => ({ name: task.name, runsLeft: task.runsLeft })), { timeout: 30_000 })
    .toEqual([{ name: "Due soon", runsLeft: 2 }]);
  const scheduled = (await tasks())[0]!;
  expect(Date.parse(scheduled.until!)).toBeGreaterThan(Date.parse(due));
  expect(scheduled.nextRunAt).toBe(due);

  // The gateway restarts before the routine is due.
  await hui.restartGateway();
  await hui.reload();

  // Its limits survived: the bot's own page and Automations both still show them.
  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, bot.name);
  await screen.getByRole("button", "Add routine").tap();
  const facts = screen.getByLabel("About Due soon");
  await expect(facts.getByText(`made by @${bot.handle}`)).toBeVisible();
  await expect(facts.getByText(/^until /u)).toBeVisible();
  await expect(facts.getByText("2 runs left")).toBeVisible();
  await hui.open("/cron");
  const row = screen.getByRole("button", "Edit Due soon");
  await expect(row.getByText(`made by @${bot.handle}`)).toBeVisible();
  await expect(row.getByText(/^until /u)).toBeVisible();
  await expect(row.getByText("2 runs left")).toBeVisible();

  // Inspection and restart take no scheduler time. Its actual timer, not Run now, crosses the deadline.
  expect((await tasks())[0]).toMatchObject({ runsLeft: 2, until: scheduled.until, nextRunAt: due });
  await clock.advance(19_999);
  expect(await runs()).toEqual([]);
  await clock.advance(1);

  // It runs at the time it was given, and its prompt arrives in the chat once.
  await expect.poll(async () => (await runs()).map((run) => `${run.taskName} ${run.status}`), { timeout: 120_000 })
    .toEqual(["Due soon completed"]);
  expect((await runs())[0]?.createdAt).toBe(due);
  await hui.open(`/bots/${bot.id}`);
  await expect(transcript.getByText("Check the build.")).toHaveCount(1);
  await expect(transcript.getByText("Routine")).toBeVisible();
  await expect.poll(async () => (await tasks())[0]?.runsLeft).toBe(1);
  await hideBotPanel(screen);

  // A second restart follows the recorded outcome, and delivers nothing a second time.
  await hui.restartGateway();
  await hui.reload();
  await expect(transcript.getByText("Check the build.")).toHaveCount(1);
  await expect.poll(async () => (await runs()).map((run) => `${run.taskName} ${run.status}`)).toEqual(["Due soon completed"]);
  await panelOverview(screen, bot.name);
  await screen.getByRole("button", "Add routine").tap();
  const latest = screen.getByLabel("Latest runs");
  await expect(latest.getByText("Due soon")).toHaveCount(1);
  await expect(latest.getByText("Completed")).toHaveCount(1);
  await expect(latest.getByText("Fixture response.")).toBeVisible();
});
