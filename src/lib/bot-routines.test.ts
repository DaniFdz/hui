import assert from "node:assert/strict";
import test from "node:test";
import { botRoutineRuns, botRoutines, routineCadenceSummary, routineSchedule, RoutineFormError } from "./bot-routines.ts";
import type { AutomationRun, AutomationSnapshot, AutomationTask } from "./automation-types.ts";

const TZ = "Europe/Madrid";

test("every N minutes, hours or days becomes an Automation interval", () => {
  assert.deepEqual(routineSchedule({ cadence: "every", every: "15", unit: "minutes" }, TZ), { kind: "every", everyMs: 15 * 60_000 });
  assert.deepEqual(routineSchedule({ cadence: "every", every: " 2 ", unit: "hours" }, TZ), { kind: "every", everyMs: 2 * 3_600_000 });
  assert.deepEqual(routineSchedule({ cadence: "every", every: "1", unit: "days" }, TZ), { kind: "every", everyMs: 86_400_000 });
  for (const every of ["", "0", "-1", "1.5", "two"]) {
    assert.throws(() => routineSchedule({ cadence: "every", every, unit: "hours" }, TZ), RoutineFormError, every);
  }
  assert.throws(() => routineSchedule({ cadence: "every", every: "2", unit: "weeks" }, TZ), RoutineFormError);
});

test("daily and weekly times become cron in the browser's timezone", () => {
  assert.deepEqual(routineSchedule({ cadence: "daily", time: "08:00" }, TZ), { kind: "cron", expression: "0 8 * * *", timezone: TZ });
  assert.deepEqual(routineSchedule({ cadence: "daily", time: "7:05" }, TZ), { kind: "cron", expression: "5 7 * * *", timezone: TZ });
  assert.deepEqual(routineSchedule({ cadence: "weekly", time: "09:30", weekday: "1" }, TZ), { kind: "cron", expression: "30 9 * * 1", timezone: TZ });
  assert.deepEqual(routineSchedule({ cadence: "weekly", time: "23:59", weekday: "0" }, "UTC"), { kind: "cron", expression: "59 23 * * 0", timezone: "UTC" });
  for (const time of ["", "24:00", "12:60", "noon", "8"]) {
    assert.throws(() => routineSchedule({ cadence: "daily", time }, TZ), RoutineFormError, time);
  }
  for (const weekday of ["", "7", "-1", "mon"]) {
    assert.throws(() => routineSchedule({ cadence: "weekly", time: "08:00", weekday }, TZ), RoutineFormError, weekday);
  }
});

test("once at a local date and time becomes an absolute instant", () => {
  const schedule = routineSchedule({ cadence: "once", at: "2026-10-06T08:15" }, TZ);
  assert.equal(schedule.kind, "at");
  assert.equal(schedule.kind === "at" && Date.parse(schedule.at), new Date(2026, 9, 6, 8, 15).valueOf(), "datetime-local is read in the browser's local time");
  for (const at of ["", "tomorrow", "2026-10-06"]) {
    assert.throws(() => routineSchedule({ cadence: "once", at }, TZ), RoutineFormError, at);
  }
  assert.throws(() => routineSchedule({ cadence: "hourly" }, TZ), RoutineFormError);
});

test("the panel reads its own daily and weekly crons back and leaves others to Automation", () => {
  assert.equal(routineCadenceSummary({ kind: "cron", expression: "0 8 * * *", timezone: TZ }), "Daily at 08:00");
  assert.equal(routineCadenceSummary({ kind: "cron", expression: "30 9 * * 1", timezone: TZ }), "Mondays at 09:30");
  assert.equal(routineCadenceSummary({ kind: "cron", expression: "0 18 * * 7", timezone: TZ }), "Sundays at 18:00");
  for (const expression of ["0 9 * * 1-5", "*/5 * * * *", "0 8 1 * *", "61 8 * * *"]) {
    assert.equal(routineCadenceSummary({ kind: "cron", expression, timezone: TZ }), undefined, expression);
  }
  assert.equal(routineCadenceSummary({ kind: "every", everyMs: 60_000 }), undefined);
});

function task(id: string, sessionId: string, nextRunAt: string | null, name = id): AutomationTask {
  return { id, name, description: "", sessionId, prompt: "p", schedule: { kind: "every", everyMs: 60_000 }, enabled: nextRunAt !== null, timeoutSeconds: 900, createdAt: "", updatedAt: "", nextRunAt };
}

function run(id: string, sessionId: string, createdAt: string): AutomationRun {
  return { id, taskId: "t", taskName: "T", sessionId, source: "manual", status: "completed", createdAt };
}

test("a bot's routines and runs are the Automation tasks that target its chat", () => {
  const snapshot: AutomationSnapshot = {
    scheduler: { enabled: true, activeRuns: 0, nextWakeAt: null },
    tasks: [task("paused", "bot", null), task("later", "bot", "2026-10-06T08:00:00.000Z"), task("other", "elsewhere", "2026-10-05T08:00:00.000Z"), task("soon", "bot", "2026-10-05T09:00:00.000Z")],
    runs: [run("r1", "bot", "2026-10-05T08:00:00.000Z"), run("r2", "elsewhere", "2026-10-05T09:00:00.000Z"), run("r3", "bot", "2026-10-05T10:00:00.000Z")],
  };
  assert.deepEqual(botRoutines(snapshot, "bot").map(({ id }) => id), ["soon", "later", "paused"]);
  assert.deepEqual(botRoutineRuns(snapshot, "bot").map(({ id }) => id), ["r3", "r1"]);
  assert.deepEqual(botRoutineRuns(snapshot, "bot", 1).map(({ id }) => id), ["r3"]);
  assert.deepEqual(botRoutines(undefined, "bot"), []);
  assert.deepEqual(botRoutineRuns(undefined, "bot"), []);
});
