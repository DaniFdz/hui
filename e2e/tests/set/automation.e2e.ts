/** Automation tasks are scheduled from a form, edited, paused, run now and deleted, with refusals shown where they belong (SET-067, SET-068, SET-069, SET-070, SET-071). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the task form creates a scheduled task, keeps it after a reload, and says why it refuses bad input", { tags: ["SET-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Automation target" });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = screen.getByPlaceholder("Nightly review");
  const prompt = screen.getByPlaceholder("What should the session do?");
  const cron = screen.getByPlaceholder("0 9 * * 1-5");
  const timeout = screen.getByLabel("Timeout (seconds)");
  const create = screen.getByRole("button", "Create task");

  await hui.open("/settings/automation");
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();
  await expect(screen.getByText("Next wake")).toBeVisible();
  await expect(screen.getByText("Idle.")).toBeVisible();
  await expect(screen.getByLabel("Cron timezone")).toHaveValue(zone);
  await expect(timeout).toHaveValue("900");

  await create.tap();
  await expect(screen.getByText("Name the task.")).toBeVisible();
  await name.fill("Morning digest");
  await create.tap();
  await expect(screen.getByText("Choose the session the task runs in.")).toBeVisible();
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Automation target").tap();
  await prompt.fill("Summarise the night");
  await cron.fill("0 9 * * 1-5");
  await timeout.fill("5");
  await create.tap();
  await expect(screen.getByText("Timeout must be a whole number between 10 and 86400 seconds.")).toBeVisible();
  await timeout.fill("900");
  await cron.fill("0 9 * *");
  await create.tap();
  await expect(screen.getByText("Cron expressions must have five fields: minute hour day month weekday.")).toBeVisible();
  await expect(name).toHaveValue("Morning digest");
  await expect(prompt).toHaveValue("Summarise the night");
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();

  await cron.fill("0 9 * * 1-5");
  const rejected = await hui.intercept("POST", /\/__hui\/automation\/tasks$/u);
  await create.tap();
  await rejected.reject(500, "scheduler unavailable");
  await expect(screen.getByText("scheduler unavailable")).toBeVisible();
  await expect(name).toHaveValue("Morning digest");
  expect((await hui.api<{ tasks: unknown[] }>("GET", "/__hui/automation")).tasks).toHaveLength(0);

  await create.tap();
  await expect(screen.getByText(`Cron 0 9 * * 1-5 (${zone})`)).toBeVisible();
  await expect(screen.getByText("1 task configured")).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(prompt).toHaveValue("");
  await expect(cron).toHaveValue("");
  await expect(timeout).toHaveValue("900");
  await expect(screen.getByLabel("Cron timezone")).toHaveValue(zone);
  await expect(screen.getByLabel("Session").first()).toHaveValue("");
  await expect(cron).toBeVisible();

  await name.fill("Quarter hour");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Automation target").last().tap();
  await prompt.fill("Check in");
  await screen.getByLabel("Schedule").first().tap();
  await screen.getByText("Repeat interval").tap();
  await screen.getByLabel("Repeat every (minutes)").fill("15");
  await create.tap();
  await expect(screen.getByText("Every 15 minutes")).toBeVisible();

  await name.fill("One shot");
  await screen.getByLabel("Session").first().tap();
  await screen.getByText("Automation target").last().tap();
  await prompt.fill("Once only");
  await screen.getByLabel("Schedule").first().tap();
  await screen.getByText("Once", { exact: true }).tap();
  await screen.getByLabel("Run once at").fill("2099-01-02T03:04");
  await create.tap();
  await expect(screen.getByText(`Once at ${new Date("2099-01-02T03:04").toLocaleString()}`)).toBeVisible();

  await hui.reload();
  await expect(screen.getByText("3 tasks configured")).toBeVisible();
  await expect(screen.getByText(`Cron 0 9 * * 1-5 (${zone})`)).toBeVisible();
  await expect(screen.getByText("Every 15 minutes")).toBeVisible();
  await expect(screen.getByText("Next wake")).toBeVisible();
});

test("a task is edited from its name or actions menu, and paused and resumed by its switch", { tags: ["SET-068", "SET-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Automation target" });
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Hourly sweep", sessionId: session.id, prompt: "E2E_REPLAY", schedule: { kind: "every", everyMs: 3_600_000 }, enabled: true,
  });
  const name = screen.getByPlaceholder("Nightly review");
  const enable = (task: string) => screen.getByRole("switch", `Enable ${task}`);
  const nextRun = async () => (await hui.api<{ tasks: { nextRunAt: string | null }[] }>("GET", "/__hui/automation")).tasks[0]!.nextRunAt;

  await hui.open("/settings/automation");
  await screen.getByRole("button", "Edit Hourly sweep").tap();
  await expect(screen.getByText("Edit task")).toBeVisible();
  await expect(name).toHaveValue("Hourly sweep");
  await expect(screen.getByPlaceholder("What should the session do?")).toHaveValue("E2E_REPLAY");
  await expect(screen.getByLabel("Repeat every (minutes)")).toHaveValue("60");
  await name.fill("Discarded name");
  await screen.getByRole("button", "Cancel edit").tap();
  await expect(screen.getByText("New task")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Hourly sweep")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Discarded name")).toBeHidden();

  await screen.getByRole("button", "Actions for Hourly sweep").tap();
  await screen.getByText("Edit", { exact: true }).tap();
  await expect(screen.getByText("Edit task")).toBeVisible();
  await name.fill("Daily sweep");
  await screen.getByLabel("Repeat every (minutes)").fill("1440");
  await screen.getByRole("button", "Update task").tap();
  await expect(screen.getByText("New task")).toBeVisible();
  await expect(screen.getByText("Every day")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Daily sweep")).toBeVisible();

  const scheduled = (await hui.look(screen.getByText("Every day"))).color;
  await hui.flip(enable("Daily sweep"));
  await expect(enable("Daily sweep")).not.toBeChecked();
  await expect.poll(nextRun).toBe(null);
  await expect(screen.getByText("—").first()).toBeVisible();
  expect((await hui.look(screen.getByText("Every day"))).color).not.toEqual(scheduled);
  await hui.reload();
  await expect(enable("Daily sweep")).not.toBeChecked();

  await hui.flip(enable("Daily sweep"));
  await expect(enable("Daily sweep")).toBeChecked();
  await expect.poll(nextRun).not.toBe(null);
  await expect.poll(async () => (await hui.look(screen.getByText("Every day"))).color).toEqual(scheduled);
  await hui.reload();
  await expect(enable("Daily sweep")).toBeChecked();

  await screen.getByRole("button", "Run now: Daily sweep").tap();
  await hui.provider.held();
  await screen.getByRole("button", "Edit Daily sweep").tap();
  await name.fill("Renamed in flight");
  await screen.getByRole("button", "Update task").tap();
  await expect(screen.getByText("Stop the active run before changing its target, name or prompt.")).toBeVisible();
  await expect(screen.getByText("Edit task")).toBeVisible();
  await expect(name).toHaveValue("Renamed in flight");
});

test("run now shows the run settle in Run history, refuses a second run and a delete in flight, cancels, and a delete keeps past runs", { tags: ["SET-071"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Automation target" });
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Held", sessionId: session.id, prompt: "E2E_REPLAY", schedule: { kind: "every", everyMs: 3_600_000 }, enabled: true,
  });
  const runNow = screen.getByRole("button", "Run now: Held");

  const manual = screen.getByText("Manual · started", { exact: false });
  const completed = screen.getByText("Completed");
  const cancelled = screen.getByText("Cancelled");

  await hui.open("/settings/automation");
  await expect(runNow).toBeVisible();
  const runs = await manual.count();
  const completedBefore = await completed.count();
  const cancelledBefore = await cancelled.count();
  await runNow.tap();
  await hui.provider.held();
  await expect(screen.getByText("1 run in flight")).toBeVisible();
  await expect(screen.getByText("Running")).toHaveCount(2);
  await expect(manual).toHaveCount(runs + 1);
  await expect(manual.first()).not.toContainText("finished");
  await expect(screen.getByRole("button", "Cancel")).toBeVisible();

  await runNow.tap();
  await expect(screen.getByText("This task is already running.")).toBeVisible();
  await screen.getByRole("button", "Actions for Held").tap();
  await screen.getByText("Delete", { exact: true }).tap();
  await expect(screen.getByText("Stop the active run before deleting this task.")).toBeVisible();
  await expect(screen.getByRole("button", "Edit Held")).toBeVisible();

  await hui.provider.release();
  await expect(completed).toHaveCount(completedBefore + 2);
  await expect(manual.first()).toContainText("finished");
  await expect(screen.getByText("Replay prefix — replay suffix").first()).toBeVisible();
  await expect(screen.getByRole("button", "Cancel")).toBeHidden();
  await expect(screen.getByText("Idle.")).toBeVisible();

  await runNow.tap();
  await hui.provider.held();
  await expect(screen.getByRole("button", "Cancel")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(cancelled).toHaveCount(cancelledBefore + 2);
  await expect(screen.getByRole("button", "Cancel")).toBeHidden();

  await screen.getByRole("button", "Actions for Held").tap();
  await screen.getByText("Delete", { exact: true }).tap();
  await expect(screen.getByText("Nothing scheduled")).toBeVisible();
  await expect(manual).toHaveCount(runs + 2);
});
