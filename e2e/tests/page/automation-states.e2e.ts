/** The scheduler's own states: a read that failed and can retry, the last data kept when a refresh fails, run
 * history outcomes, and a bot routine labelled as its panel labels it (PAGE-008, PAGE-014, PAGE-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type {
  AutomationRun,
  AutomationSnapshot,
  AutomationTask,
} from "../../../src/api/schema/automation.ts";

const at = "2026-01-02T03:00:00.000Z";
const later = "2026-01-02T04:00:00.000Z";

const task = (overrides: Partial<AutomationTask> = {}): AutomationTask => ({
  id: "task-1",
  name: "Nightly review",
  description: "",
  sessionId: "session-1",
  prompt: "Review the diff",
  schedule: { kind: "every", everyMs: 3_600_000 },
  enabled: true,
  timeoutSeconds: 900,
  createdAt: at,
  updatedAt: at,
  nextRunAt: later,
  ...overrides,
});

const snapshot = (
  tasks: AutomationTask[],
  runs: AutomationRun[] = [],
): AutomationSnapshot => ({
  scheduler: { enabled: true, activeRuns: 0, nextWakeAt: null },
  tasks,
  runs,
});

test(
  "a task needs a session first, and a bot chat is never offered as a target",
  { tags: ["PAGE-008"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const bot = (
      await hui.api<{ bot: { id: string; name: string; sessionId: string } }>(
        "POST",
        "/__hui/bots",
        {
          name: "Scheduler bot",
          soul: "# Who I am\nA scheduler fixture.\n",
        },
      )
    ).bot;
    await hui.open("/cron");
    await expect(
      screen.getByText(
        "Start a session first: automation runs inside a session HUI already owns.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      screen.getByLabel("Session", { visible: true }),
    ).toBeDisabled();
    await expect(screen.getByRole("button", "Create task")).toBeDisabled();
    await expect(screen.getByText(bot.name, { exact: true })).toHaveCount(0);
  },
);

test(
  "run history names a retry, an outcome that needs attention, and a completed run",
  { tags: ["PAGE-014"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const session = await hui.createSession({ title: "Run history" });
    const scheduled = task({ sessionId: session.id });
    const retry: AutomationRun = {
      id: "run-retry",
      taskId: scheduled.id,
      taskName: scheduled.name,
      sessionId: session.id,
      source: "scheduled",
      status: "queued",
      createdAt: at,
      startedAt: at,
      attempt: 2,
      retryAt: later,
    };
    const attention: AutomationRun = {
      id: "run-attention",
      taskId: scheduled.id,
      taskName: "Attention run",
      sessionId: session.id,
      source: "manual",
      status: "failed",
      createdAt: at,
      startedAt: at,
      finishedAt: later,
      error: "The run timed out.",
      failure: { kind: "timeout", needsAttention: true },
    };
    const completed: AutomationRun = {
      id: "run-completed",
      taskId: scheduled.id,
      taskName: "Completed run",
      sessionId: session.id,
      source: "manual",
      status: "completed",
      createdAt: at,
      startedAt: at,
      finishedAt: later,
      summary: "All good.",
    };
    const served = await hui.answerAll(
      "GET",
      /\/__hui\/automation$/u,
      JSON.stringify(snapshot([scheduled], [retry, attention, completed])),
    );
    await hui.open("/cron");

    await expect(screen.getByText("Next retry", { exact: true })).toHaveCount(
      1,
    );
    await expect(
      screen.getByText("Retry scheduled", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      screen.getByText(/^Attempt 2\/3 · Next retry /u),
    ).toBeVisible();
    await expect(
      screen.getByText("Needs attention", { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByText(
        "Check the chat for actions already taken, then adjust the task or timeout before running again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      screen.getByText("The run timed out.", { exact: true }),
    ).toBeVisible();
    await expect(screen.getByText("Completed", { exact: true })).toBeVisible();
    await expect(screen.getByText("All good.", { exact: true })).toBeVisible();
    await expect(screen.getByText(/Manual · started /u)).toHaveCount(2);
    await expect(screen.getByText(/Scheduled · started /u)).toHaveCount(1);
    await served.stop();
  },
);

test(
  "Automations labels a bot's routine, who made it, and its temporary limits",
  { tags: ["PAGE-015"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const bot = (
      await hui.api<{
        bot: { id: string; name: string; handle: string; sessionId: string };
      }>("POST", "/__hui/bots", {
        name: "Routine owner",
        soul: "# Who I am\nA routine fixture.\n",
      })
    ).bot;
    const routine = task({
      id: "bot-routine",
      name: "Morning review",
      sessionId: bot.sessionId,
      schedule: {
        kind: "cron",
        expression: "0 8 * * *",
        timezone: "Europe/Madrid",
      },
      createdBy: { kind: "bot", botId: bot.id, handle: bot.handle },
      until: new Date(Date.now() + 3_600_000).toISOString(),
      runsLeft: 3,
    });
    const shown = await hui.intercept("GET", /\/__hui\/automation$/u);
    await hui.open("/cron");
    await shown.arrived();
    await shown.answer(JSON.stringify(snapshot([routine])));

    await expect(
      screen.getByText(`Bot · ${bot.name}`, { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByText("Daily at 08:00", { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByText(`made by @${bot.handle}`, { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByText("3 runs left", { exact: true }),
    ).toBeVisible();
  },
);
