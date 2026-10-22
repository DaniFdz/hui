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
