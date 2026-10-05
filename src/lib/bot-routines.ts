/**
 * Routines are HUI Automation tasks that target a bot's chat. The panel's
 * friendly schedules map onto Automation's own kinds (at, every, cron) in the
 * browser's timezone; nothing here schedules anything, the gateway does.
 */
import type { AutomationRun, AutomationSchedule, AutomationSnapshot, AutomationTask } from "./automation-types.ts";

export type RoutineCadence = "every" | "daily" | "weekly" | "once";
export type RoutineEveryUnit = "minutes" | "hours" | "days";

/** The Add routine form, as typed. */
export type RoutineScheduleForm = {
  cadence: string;
  every?: string;
  unit?: string;
  /** "HH:MM", 24-hour, for daily and weekly. */
  time?: string;
  /** "0" (Sunday) to "6" (Saturday), for weekly. */
  weekday?: string;
  /** A `datetime-local` value, for once: local time without an offset. */
  at?: string;
};

export const ROUTINE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const UNIT_MS: Record<RoutineEveryUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export class RoutineFormError extends Error {}

function parseTime(value: string | undefined): { hour: number; minute: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(value?.trim() ?? "");
  if (!match) throw new RoutineFormError("Choose a time of day (HH:MM).");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Maps the form onto an Automation schedule. `timezone` is the browser's,
 * because the operator picked a wall-clock time where they are. */
export function routineSchedule(form: RoutineScheduleForm, timezone: string): AutomationSchedule {
  if (form.cadence === "every") {
    const every = Number(form.every?.trim() || Number.NaN);
    const unit = (["minutes", "hours", "days"] as const).find((candidate) => candidate === form.unit);
    if (!unit) throw new RoutineFormError("Choose minutes, hours or days.");
    if (!Number.isInteger(every) || every < 1) throw new RoutineFormError("Repeat every must be a whole number, at least 1.");
    const everyMs = every * UNIT_MS[unit];
    if (!Number.isSafeInteger(everyMs)) throw new RoutineFormError("That interval is too long.");
    return { kind: "every", everyMs };
  }
  if (form.cadence === "daily" || form.cadence === "weekly") {
    const { hour, minute } = parseTime(form.time);
    if (form.cadence === "daily") return { kind: "cron", expression: `${minute} ${hour} * * *`, timezone };
    const weekday = Number(form.weekday?.trim() || Number.NaN);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new RoutineFormError("Choose a day of the week.");
    return { kind: "cron", expression: `${minute} ${hour} * * ${weekday}`, timezone };
  }
  if (form.cadence === "once") {
    const at = form.at?.trim() ?? "";
    // datetime-local carries no offset, so Date.parse reads it as local time.
    const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(at) ? Date.parse(at) : Number.NaN;
    if (!Number.isFinite(parsed)) throw new RoutineFormError("Choose the date and time to run once.");
    return { kind: "at", at: new Date(parsed).toISOString() };
  }
  throw new RoutineFormError("Choose how often the routine runs.");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Reads back the daily and weekly crons this panel writes; undefined for
 * anything else, which the generic Automation summary describes. */
export function routineCadenceSummary(schedule: AutomationSchedule): string | undefined {
  if (schedule.kind !== "cron") return undefined;
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7])$/u.exec(schedule.expression.trim());
  if (!match) return undefined;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return undefined;
  const time = `${pad(hour)}:${pad(minute)}`;
  if (match[3] === "*") return `Daily at ${time}`;
  return `${ROUTINE_WEEKDAYS[Number(match[3]) % 7]}s at ${time}`;
}

/** The bot's routines: soonest next run first, paused ones (no next run) last. */
export function botRoutines(snapshot: AutomationSnapshot | undefined, sessionId: string): AutomationTask[] {
  if (!snapshot) return [];
  const next = (task: AutomationTask) => {
    const at = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN;
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  };
  return snapshot.tasks
    .filter((task) => task.sessionId === sessionId)
    .toSorted((a, b) => next(a) - next(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The latest runs into the bot's chat, newest first. */
export function botRoutineRuns(snapshot: AutomationSnapshot | undefined, sessionId: string, limit = 5): AutomationRun[] {
  if (!snapshot) return [];
  const at = (run: AutomationRun) => Date.parse(run.startedAt ?? run.createdAt) || 0;
  return snapshot.runs
    .filter((run) => run.sessionId === sessionId)
    .toSorted((a, b) => at(b) - at(a))
    .slice(0, limit);
}
