/** A bot's routines: the Routines page's Add routine form with its names and refusals, and a routine paused, resumed and deleted from its page and the overview (BOT-040, BOT-042). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function openRoutines(screen: Screen, hui: Hui, bot: { id: string }) {
  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", "Add routine").tap();
}

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("Add routine takes a name, a prompt and a cadence, refuses an empty name or prompt and keeps what was typed when the gateway refuses", { tags: ["BOT-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Scheduler");
  await openRoutines(screen, hui, bot);
  for (const cadence of ["Every", "Daily", "Weekly", "Once"]) await expect(screen.getByText(cadence, { exact: true }).first()).toBeVisible();
  await hui.flip(screen.getByText("Every", { exact: true }).first());
  await expect(screen.getByLabel("Repeat every")).toBeVisible();
  const units = await hui.textOf(screen.getByLabel("Interval unit"));
  for (const unit of ["minutes", "hours", "days"]) expect(units).toContain(unit);
  const zone = await hui.zone();
  await expect(screen.getByText(`Times are in ${zone}.`)).toBeVisible();

  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText("Name the routine.")).toBeVisible();
  await screen.getByPlaceholder("Inbox digest").fill("Inbox digest");
  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText("Write what the routine sends to the bot.")).toBeVisible();

  await screen.getByPlaceholder("What should the bot do each time?").fill("Summarize my inbox for the day.");
  await hui.flip(screen.getByText("Daily", { exact: true }).first());
  await screen.getByLabel("Daily time").fill("08:00");
  await screen.getByRole("button", "Add routine").tap();

  await expect(screen.getByText("Inbox digest", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^Daily at 08:00 · next /u)).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Inbox digest")).toBeChecked();
  const tasks = async () => (await hui.api<{ tasks: { sessionId: string; name: string; schedule: { kind: string; expression: string; timezone: string }; enabled: boolean; prompt: string }[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);
  const scheduled = (await tasks()).find((task) => task.name === "Inbox digest")!;
  expect(scheduled).toEqual(expect.objectContaining({ enabled: true, prompt: "Summarize my inbox for the day." }));
  expect(scheduled.schedule).toEqual(expect.objectContaining({ kind: "cron", expression: "0 8 * * *", timezone: zone }));

  await screen.getByPlaceholder("Inbox digest").fill("Weekly digest");
  await screen.getByPlaceholder("What should the bot do each time?").fill("Summarize the week.");
  await hui.flip(screen.getByText("Weekly", { exact: true }).first());
  await screen.getByLabel("Day of the week").selectOption({ label: "Monday" });
  await screen.getByLabel("Weekly time").fill("09:30");
  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText(/^Mondays at 09:30 · next /u)).toBeVisible();
  expect((await tasks()).find((task) => task.name === "Weekly digest")!.schedule).
    toEqual(expect.objectContaining({ kind: "cron", expression: "30 9 * * 1", timezone: zone }));

  await screen.getByPlaceholder("Inbox digest").fill("Interval digest");
  await screen.getByPlaceholder("What should the bot do each time?").fill("Summarize what changed.");
  await hui.flip(screen.getByText("Every", { exact: true }).first());
  await screen.getByLabel("Repeat every").fill("2");
  await screen.getByLabel("Interval unit").selectOption({ label: "hours" });
  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText("Interval digest", { exact: true })).toBeVisible();
  expect((await tasks()).find((task) => task.name === "Interval digest")!.schedule).toEqual(expect.objectContaining({ kind: "every", everyMs: 7_200_000 }));

  await screen.getByPlaceholder("Inbox digest").fill("One-off digest");
  await screen.getByPlaceholder("What should the bot do each time?").fill("Summarize once.");
  await hui.flip(screen.getByText("Once", { exact: true }).first());
  await screen.getByLabel("Run once at").fill("2030-01-02T08:15");
  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText("One-off digest", { exact: true })).toBeVisible();
  expect((await tasks()).find((task) => task.name === "One-off digest")!.schedule).toEqual(expect.objectContaining({ kind: "at", at: new Date(2030, 0, 2, 8, 15).toISOString() }));

  const refusal = await hui.intercept("POST", /\/__hui\/automation\/tasks$/u);
  await screen.getByPlaceholder("Inbox digest").fill("Second digests");
  await screen.getByPlaceholder("What should the bot do each time?").fill("Summarize again.");
  await screen.getByRole("button", "Add routine").tap();
  await refusal.reject(400, "The gateway refused this routine.");
  await expect(screen.getByText("The gateway refused this routine.")).toBeVisible();
  expect(await screen.getByPlaceholder("Inbox digest").inputValue()).toBe("Second digests");
  expect(await screen.getByPlaceholder("What should the bot do each time?").inputValue()).toBe("Summarize again.");
});

test("a routine's switch pauses and resumes it on its page and the overview, and Delete removes it from both and from Automations", { tags: ["BOT-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Routine owner");
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Weekly digest", sessionId: bot.sessionId, prompt: "Summarize the week.", enabled: true,
    schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" },
  });
  const tasks = async () => (await hui.api<{ tasks: { sessionId: string; enabled: boolean }[] }>("GET", "/__hui/automation")).tasks.filter((task) => task.sessionId === bot.sessionId);
  await hui.open("/cron");
  await expect(screen.getByTestId("page-title")).toHaveText("Automations");
  await expect(screen.getByRole("button", "Edit Weekly digest")).toBeVisible();
  await openRoutines(screen, hui, bot);
  await expect(screen.getByText(/^Mondays at 09:00 · next /u)).toBeVisible();

  await hui.flip(screen.getByRole("switch", "Enable Weekly digest"));
  await expect(screen.getByText(/^Mondays at 09:00 · paused$/u)).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Weekly digest")).toBeChecked({ checked: false });
  await hui.flip(screen.getByRole("switch", "Enable Weekly digest"));
  await expect(screen.getByText(/^Mondays at 09:00 · next /u)).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Weekly digest")).toBeChecked();

  await screen.getByRole("button", "Back to Routine owner").tap();
  const overviewSwitch = screen.getByRole("switch", "Enable Weekly digest");
  await expect(overviewSwitch).toBeChecked();
  await hui.flip(overviewSwitch);
  await expect(screen.getByText(/^Mondays at 09:00 · paused$/u)).toBeVisible();
  await expect.poll(async () => (await tasks()).map((task) => task.enabled)).toEqual([false]);
  await expect(overviewSwitch).toBeChecked({ checked: false });
  await hui.flip(overviewSwitch);
  await expect(screen.getByText(/^Mondays at 09:00 · next /u)).toBeVisible();
  await expect(overviewSwitch).toBeChecked();
  await hui.flip(overviewSwitch);
  await expect(screen.getByText(/^Mondays at 09:00 · paused$/u)).toBeVisible();

  await screen.getByText("Weekly digest", { exact: true }).tap();
  await expect(screen.getByText(/^Mondays at 09:00 · paused$/u)).toBeVisible();
  await hui.flip(screen.getByRole("switch", "Enable Weekly digest"));
  await expect(screen.getByText(/^Mondays at 09:00 · next /u)).toBeVisible();

  await screen.getByRole("button", "Delete Weekly digest").tap();
  await expect(screen.getByText("Weekly digest", { exact: true })).toBeHidden();
  await expect(screen.getByText(/^No routines yet\./u)).toBeVisible();
  await screen.getByRole("button", "Back to Routine owner").tap();
  await expect(screen.getByText(/^No routines yet\. Ask Routine owner to do something on a schedule, or add one\.$/u)).toBeVisible();
  await expect.poll(async () => await tasks()).toEqual([]);
  await hui.open("/cron");
  await expect(screen.getByTestId("page-title")).toHaveText("Automations");
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Weekly digest")).toBeHidden();
});