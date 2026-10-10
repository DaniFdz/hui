/**
 * Wire shapes of the automation API: scheduled tasks, their runs and the scheduler snapshot as the browser
 * receives them. Types only; validation and scheduling belong to the gateway.
 */
export type AutomationSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number }
  | { kind: "cron"; expression: string; timezone: string };

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Who made a task: the operator (Automations, a bot's Routines tab, `hui schedule` and `hui bot routine`) or a bot,
 * with its `routines` tool, named by its id and the handle it had then.
 */
export type AutomationCreator = { kind: "operator" } | { kind: "bot"; botId: string; handle: string };

export type AutomationTask = {
  id: string;
  name: string;
  description: string;
  sessionId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  /** Absent on tasks made before HUI recorded it. */
  createdBy?: AutomationCreator;
  /** A temporary task's end: at this time HUI disables and deletes it, whether or not it ran. */
  until?: string;
  /**
   * A temporary task's runs left. Each run HUI starts counts, by hand or scheduled, except a skipped one (its target
   * could not take it); once the last one ends HUI disables and deletes the task.
   */
  runsLeft?: number;
};

export type AutomationRun = {
  id: string;
  taskId: string;
  taskName: string;
  sessionId: string;
  source: "manual" | "scheduled";
  status: AutomationRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
};

export type AutomationSnapshot = {
  scheduler: { enabled: true; activeRuns: number; nextWakeAt: string | null };
  tasks: AutomationTask[];
  runs: AutomationRun[];
};

export type AutomationTaskInput = {
  name: string;
  description?: string;
  sessionId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled?: boolean;
  timeoutSeconds?: number;
  /** An end time (ISO), after the task's next run. On update, absent keeps the task's and `null` clears it. */
  until?: string | null;
  /** How many runs it has, 1–1000. On update, absent keeps the runs it has left and `null` clears the limit. */
  runs?: number | null;
};
