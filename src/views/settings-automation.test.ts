import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AutomationFormError,
  automationState,
  describeRoutineSchedule,
  describeSchedule,
  formatTimestamp,
  runIsActive,
  scheduleFromForm,
  taskInputFromForm,
} from "./settings-automation.ts";
import type { AutomationRun, AutomationSnapshot } from "../lib/automation-types.ts";

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

const READY: AutomationSnapshot = {
  scheduler: { enabled: true, activeRuns: 0, nextWakeAt: null },
  tasks: [],
  runs: [],
};

function run(status: AutomationRun["status"]): AutomationRun {
  return {
    id: "run-1",
    taskId: "task-1",
    taskName: "Nightly review",
    sessionId: "session-1",
    source: "manual",
    status,
    createdAt: "2026-09-23T08:00:00.000Z",
  };
}

test("automation distinguishes loading, failure and ready states", () => {
  assert.equal(automationState({ automation: undefined, automationError: "" }), "loading");
  assert.equal(automationState({ automation: undefined, automationError: "boom" }), "error");
  // A snapshot wins: a stale refresh error must not hide known scheduler state.
  assert.equal(automationState({ automation: READY, automationError: "boom" }), "ready");
});

test("schedules read as the cadence the scheduler will actually use", () => {
  assert.equal(describeSchedule({ kind: "every", everyMs: 60_000 }), "Every minute");
  assert.equal(describeSchedule({ kind: "every", everyMs: 15 * 60_000 }), "Every 15 minutes");
  assert.equal(describeSchedule({ kind: "every", everyMs: 60 * 60_000 }), "Every hour");
  assert.equal(describeSchedule({ kind: "every", everyMs: 3 * 60 * 60_000 }), "Every 3 hours");
  assert.equal(describeSchedule({ kind: "every", everyMs: 1440 * 60_000 }), "Every day");
  assert.equal(describeSchedule({ kind: "every", everyMs: 2 * 1440 * 60_000 }), "Every 2 days");
  assert.equal(
    describeSchedule({ kind: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Madrid" }),
    "Cron 0 9 * * 1-5 (Europe/Madrid)",
  );
});

test("bot routines read as their panel wrote them, with the generic summary for anything else", () => {
  assert.equal(describeRoutineSchedule({ kind: "cron", expression: "0 8 * * *", timezone: "Europe/Madrid" }), "Daily at 08:00");
  assert.equal(describeRoutineSchedule({ kind: "cron", expression: "30 9 * * 1", timezone: "Europe/Madrid" }), "Mondays at 09:30");
  assert.equal(describeRoutineSchedule({ kind: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Madrid" }), "Cron 0 9 * * 1-5 (Europe/Madrid)");
  assert.equal(describeRoutineSchedule({ kind: "every", everyMs: 2 * 60 * 60_000 }), "Every 2 hours");
});

test("missing and unparseable timestamps stay honest instead of rendering as a date", () => {
  assert.equal(formatTimestamp(null), "—");
  assert.equal(formatTimestamp(undefined), "—");
  assert.equal(formatTimestamp(""), "—");
  assert.equal(formatTimestamp("not-a-date"), "not-a-date");
});

test("only queued and running runs can be cancelled", () => {
  assert.equal(runIsActive(run("queued")), true);
  assert.equal(runIsActive(run("running")), true);
  for (const status of ["completed", "failed", "skipped", "cancelled"] as const) {
    assert.equal(runIsActive(run(status)), false);
  }
});

test("the form builds each schedule kind in the shape the server accepts", () => {
  assert.deepEqual(
    scheduleFromForm(form({ scheduleKind: "cron", cronExpression: " 0 9 * * 1-5 ", cronTimezone: "UTC" })),
    { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  );
  assert.deepEqual(scheduleFromForm(form({ scheduleKind: "every", everyMinutes: "90" })), {
    kind: "every",
    everyMs: 5_400_000,
  });
  const once = scheduleFromForm(form({ scheduleKind: "at", at: "2027-01-02T03:04" }));
  assert.equal(once.kind, "at");
  // `datetime-local` has no offset, so the local value becomes a real instant.
  assert.equal(
    once.kind === "at" ? once.at : "",
    new Date(Date.parse("2027-01-02T03:04")).toISOString(),
  );
});

test("the form rejects schedules the scheduler could never run", () => {
  for (const fields of [
    { scheduleKind: "cron", cronExpression: "" },
    { scheduleKind: "every", everyMinutes: "0" },
    { scheduleKind: "every", everyMinutes: "1.5" },
    { scheduleKind: "every", everyMinutes: "" },
    { scheduleKind: "at", at: "" },
    { scheduleKind: "" },
  ]) {
    assert.throws(() => scheduleFromForm(form(fields)), AutomationFormError);
  }
});

test("a task input carries the trimmed fields and the default timeout", () => {
  const input = taskInputFromForm(
    form({
      name: "  Nightly review  ",
      description: "  Summarize the day  ",
      sessionId: " session-1 ",
      prompt: "  Review open work  ",
      scheduleKind: "cron",
      cronExpression: "0 9 * * *",
      cronTimezone: "Europe/Madrid",
    }),
  );
  assert.deepEqual(input, {
    name: "Nightly review",
    description: "Summarize the day",
    sessionId: "session-1",
    prompt: "Review open work",
    schedule: { kind: "cron", expression: "0 9 * * *", timezone: "Europe/Madrid" },
    timeoutSeconds: 900,
  });
});

test("a task input rejects the fields the server would reject", () => {
  const valid = {
    name: "Nightly review",
    sessionId: "session-1",
    prompt: "Review open work",
    scheduleKind: "cron",
    cronExpression: "0 9 * * *",
    cronTimezone: "UTC",
  };
  for (const override of [
    { name: "  " },
    { sessionId: "" },
    { prompt: " " },
    { timeoutSeconds: "9" },
    { timeoutSeconds: "86401" },
    { timeoutSeconds: "30.5" },
  ]) {
    assert.throws(() => taskInputFromForm(form({ ...valid, ...override })), AutomationFormError);
  }
});

test("the automation region renders real controls instead of a pending placeholder", () => {
  const settings = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");

  assert.match(settings, /props\.page === "automation"\s*\?\s*renderAutomationPage\(props, renderSection\)/);
  // Dropping it from the pending summaries is what stops the placeholder copy.
  assert.doesNotMatch(settings, /automation: "Scheduled jobs/);
  assert.match(settings, /Exclude<SettingsPage, "appearance" \| "skills" \| "tools" \| "models" \| "automation" \| "sessions" \| "security" \| "worktrees" \| "workers">/);
});

test("automation keeps the original row-control and field-control containers separate", () => {
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /class="settings-row__control cron-control"/);
  assert.equal(source.match(/class="settings-row__control"><span class="cron-control"/g)?.length, 10);
});

test("the create form shows only the selected schedule kind", () => {
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/openclaw-workspaces.css", import.meta.url), "utf8");

  assert.match(source, /data-schedule=\$\{initialKind\}/);
  assert.match(source, /form\?\.setAttribute\("data-schedule", select\.value\)/);
  assert.match(source, /syncScheduleVisibility\(form, select\.value\)/);
  assert.match(source, /field\.hidden =/);
  for (const kind of ["cron", "every", "at"]) {
    assert.match(source, new RegExp(`automation-field--${kind}`));
    assert.match(source, new RegExp(`\\?hidden=\\$\\{initialKind !== "${kind}"\\}`));
    assert.match(
      css,
      new RegExp(`\\.hui-automation-form:not\\(\\[data-schedule="${kind}"\\]\\) \\.automation-field--${kind}`),
    );
  }
});

test("automation mutations always adopt a server snapshot", () => {
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");

  assert.match(app, /if \(snapshot\) this\.automation = snapshot;\s*\n\s*else this\.loadAutomationData\(\);/);
  assert.match(app, /onRetryAutomation: this\.loadAutomationData/);
  assert.match(app, /sessions: this\.groups\.flatMap\(\(group\) => group\.sessions\)/);
});

test("a refused task action is reported next to the list, not inside the create form", () => {
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");

  // Only creation belongs to the form; every task and run action reports above
  // the task list, where the button that was refused actually lives.
  assert.match(app, /createAutomationTask\(input\), "form"\)/);
  for (const mutation of [
    /deleteAutomationTask\(task\.id\), "action"\)/,
    /await runAutomationTask\(task\.id\);\s*\n\s*\}, "action"\)/,
    /await cancelAutomationRun\(run\.id\);\s*\n\s*\}, "action"\)/,
  ]) {
    assert.match(app, mutation);
  }
  assert.match(app, /updateAutomationTask\(task\.id, input\), "form"\)/);
  assert.match(app, /if \(surface === "form"\) this\.automationFormError = message;\s*\n\s*else this\.automationActionError = message;/);
  assert.match(source, /data-automation-action-error/);
  // A refusal has to look like one, not like the muted notes around it.
  const css = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");
  assert.match(css, /\.automation-action-error\s*\{[^}]*border: 1px solid var\(--danger\);/s);
  assert.match(css, /\.automation-action-error\s*\{[^}]*background: var\(--danger-subtle\);/s);
});

test("the open automation page re-reads scheduler state and stops when it closes", () => {
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");

  // Run status settles in the scheduler after the mutation response, so a single
  // snapshot goes stale; the page polls while it is open and never while busy.
  assert.match(app, /if \(target\.page === "automation"\) this\.startAutomationPolling\(\);\s*\n\s*else this\.stopAutomationPolling\(\);/);
  assert.match(app, /this\.settingsOpen = false;\s*\n\s*this\.stopAutomationPolling\(\);/);
  assert.match(app, /if \(!this\.automationPending\) this\.loadAutomationData\(\);/);
  assert.match(app, /if \(this\.automationPoll !== undefined\) return;/);
  // Leaving the element behind must not leave a timer behind.
  assert.match(app, /this\.streamStop = undefined;\s*\n\s*if \(this\.subagentExpiryTimer !== undefined\) window\.clearTimeout\(this\.subagentExpiryTimer\);\s*\n\s*this\.subagentExpiryTimer = undefined;\s*\n\s*this\.stopAutomationPolling\(\);/);
});

test("the create form only clears once the scheduler accepted the task", () => {
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");

  assert.match(source, /if \(!created\) return;[\s\S]*?form\.reset\(\);/);
  assert.match(source, /timezone\.value = localTimezone\(\)/);
  assert.match(source, /timeout\.value = "900"/);
  assert.match(source, /schedule\.value = "cron"/);
  assert.match(source, /form\.setAttribute\("data-schedule", "cron"\)/);
  // A rejected mutation must resolve false rather than clearing the form.
  assert.match(app, /if \(this\.automationPending\) return Promise\.resolve\(false\);/);
  assert.match(app, /else this\.automationActionError = message;\s*\n\s*return false;/);
});

test("tasks can be edited without losing their enabled state", () => {
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../hui-app.ts", import.meta.url), "utf8");

  assert.match(source, /<wa-dropdown-item value="edit"[^>]*>Edit<\/wa-dropdown-item>/);
  assert.match(source, /editing \? "Update task" : "Create task"/);
  assert.match(source, /\{ \.\.\.input, enabled: editing\.enabled \}/);
  assert.match(source, /editing\?\.name \?\? ""/);
  assert.match(source, /editing\?\.prompt \?\? ""/);
  assert.match(app, /updateAutomationTask\(task\.id, input\), "form"/);
});

test("automation validation is owned by HUI instead of native required bubbles", () => {
  const source = readFileSync(new URL("./settings-automation.ts", import.meta.url), "utf8");

  assert.match(source, /data-schedule=\$\{initialKind\} novalidate/);
  assert.doesNotMatch(source, /\srequired(?:\s|>)/);
  assert.match(source, /throw new AutomationFormError\("Name the task\."\)/);
});
