import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AutomationCreator,
  AutomationRun,
  AutomationSchedule,
  AutomationSnapshot,
  AutomationTask,
  AutomationTaskInput,
} from "../src/lib/automation-types.ts";

const STORE_VERSION = 1;
const MAX_RUNS = 500;
const MIN_INTERVAL_MS = 60_000;
const MAX_TIMEOUT_SECONDS = 86_400;
/** The most runs a temporary task may be given. */
export const MAX_TASK_RUNS = 1_000;

type AutomationFile = {
  version: number;
  tasks: AutomationTask[];
  runs: AutomationRun[];
};

export type AutomationExecution = {
  summary?: string;
};

export type AutomationExecutor = (
  task: AutomationTask,
  signal: AbortSignal,
) => Promise<AutomationExecution>;

export class AutomationInputError extends Error {}
export class AutomationNotFoundError extends Error {}
export class AutomationConflictError extends Error {}
export class AutomationStoreError extends Error {}

type Clock = {
  now: () => number;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};

const SYSTEM_CLOCK: Clock = {
  now: Date.now,
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isSchedule(value: unknown): value is AutomationSchedule {
  if (!isRecord(value)) return false;
  if (value["kind"] === "at") return typeof value["at"] === "string";
  if (value["kind"] === "every") return typeof value["everyMs"] === "number";
  return (
    value["kind"] === "cron" &&
    typeof value["expression"] === "string" &&
    typeof value["timezone"] === "string"
  );
}

function parseCreator(value: unknown): AutomationCreator | undefined {
  if (!isRecord(value)) return undefined;
  if (value["kind"] === "operator") return { kind: "operator" };
  const botId = string(value["botId"]);
  return value["kind"] === "bot" && botId ? { kind: "bot", botId, handle: string(value["handle"]) } : undefined;
}

/** A task's optional fields (who made it, its limits), as stored: a value that is not one of them is left out, so a
 * task written before them, or edited by hand, still loads. */
function parseTaskExtras(value: Record<string, unknown>): Pick<AutomationTask, "createdBy" | "until" | "runsLeft"> {
  const createdBy = parseCreator(value["createdBy"]);
  const until = typeof value["until"] === "string" && Number.isFinite(Date.parse(value["until"])) ? value["until"] : undefined;
  const runsLeft = Number.isSafeInteger(value["runsLeft"]) && (value["runsLeft"] as number) >= 0 ? value["runsLeft"] as number : undefined;
  return { ...(createdBy ? { createdBy } : {}), ...(until ? { until } : {}), ...(runsLeft !== undefined ? { runsLeft } : {}) };
}

function parseTask(value: unknown): AutomationTask | undefined {
  if (!isRecord(value) || !isSchedule(value["schedule"])) return undefined;
  const id = string(value["id"]);
  const name = string(value["name"]);
  const sessionId = string(value["sessionId"]);
  const prompt = string(value["prompt"]);
  const createdAt = string(value["createdAt"]);
  const updatedAt = string(value["updatedAt"]);
  const timeoutSeconds = value["timeoutSeconds"];
  if (
    !id ||
    !name ||
    !sessionId ||
    !prompt ||
    !createdAt ||
    !updatedAt ||
    typeof timeoutSeconds !== "number" ||
    (value["nextRunAt"] !== null && typeof value["nextRunAt"] !== "string")
  ) return undefined;
  return {
    id,
    name,
    description: string(value["description"]),
    sessionId,
    prompt,
    schedule: value["schedule"],
    enabled: value["enabled"] === true,
    timeoutSeconds,
    createdAt,
    updatedAt,
    nextRunAt: value["nextRunAt"],
    ...parseTaskExtras(value),
  };
}

const RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "skipped", "cancelled"]);

function parseRun(value: unknown): AutomationRun | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value["id"]);
  const taskId = string(value["taskId"]);
  const taskName = string(value["taskName"]);
  const sessionId = string(value["sessionId"]);
  const source = value["source"];
  const status = value["status"];
  const createdAt = string(value["createdAt"]);
  if (
    !id || !taskId || !taskName || !sessionId || !createdAt ||
    (source !== "manual" && source !== "scheduled") ||
    typeof status !== "string" || !RUN_STATUSES.has(status)
  ) return undefined;
  return {
    id,
    taskId,
    taskName,
    sessionId,
    source,
    status: status as AutomationRun["status"],
    createdAt,
    ...(typeof value["startedAt"] === "string" ? { startedAt: value["startedAt"] } : {}),
    ...(typeof value["finishedAt"] === "string" ? { finishedAt: value["finishedAt"] } : {}),
    ...(typeof value["summary"] === "string" ? { summary: value["summary"] } : {}),
    ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
  };
}

function int(value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new AutomationInputError(`Invalid cron value: ${value}`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new AutomationInputError(`Cron value ${value} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function cronField(source: string, minimum: number, maximum: number, weekday = false): Set<number> {
  const values = new Set<number>();
  const addRange = (start: number, end: number, step: number) => {
    if (start > end) throw new AutomationInputError(`Invalid cron range: ${start}-${end}`);
    for (let value = start; value <= end; value += step) values.add(weekday && value === 7 ? 0 : value);
  };
  for (const part of source.split(",")) {
    const [base = "", stepSource] = part.split("/");
    const step = stepSource === undefined ? 1 : int(stepSource, 1, maximum - minimum + 1);
    if (base === "*") {
      addRange(minimum, maximum, step);
      continue;
    }
    const range = base.split("-");
    if (range.length === 2) {
      addRange(int(range[0] ?? "", minimum, maximum), int(range[1] ?? "", minimum, maximum), step);
      continue;
    }
    if (range.length !== 1 || stepSource !== undefined) {
      throw new AutomationInputError(`Invalid cron field: ${part}`);
    }
    const value = int(base, minimum, maximum);
    values.add(weekday && value === 7 ? 0 : value);
  }
  return values;
}

type ParsedCron = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  anyDay: boolean;
  anyWeekday: boolean;
};

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new AutomationInputError("Cron expressions must have five fields: minute hour day month weekday.");
  }
  return {
    minute: cronField(fields[0] ?? "", 0, 59),
    hour: cronField(fields[1] ?? "", 0, 23),
    day: cronField(fields[2] ?? "", 1, 31),
    month: cronField(fields[3] ?? "", 1, 12),
    weekday: cronField(fields[4] ?? "", 0, 7, true),
    anyDay: fields[2] === "*",
    anyWeekday: fields[4] === "*",
  };
}

function timezoneParts(timestamp: number, timezone: string): {
  minute: number; hour: number; day: number; month: number; weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.find((part) => part.type === "weekday")?.value ?? "",
  );
  return { minute: value("minute"), hour: value("hour"), day: value("day"), month: value("month"), weekday };
}

export function validateTimezone(timezone: string): string {
  const trimmed = timezone.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
  } catch {
    throw new AutomationInputError(`Unknown timezone: ${trimmed}`);
  }
  return trimmed;
}

export function nextCronAt(expression: string, timezone: string, afterMs: number): number {
  const cron = parseCron(expression);
  const zone = validateTimezone(timezone);
  let candidate = Math.floor(afterMs / 60_000) * 60_000 + 60_000;
  const limit = candidate + 366 * 24 * 60 * 60_000;
  for (; candidate <= limit; candidate += 60_000) {
    const parts = timezoneParts(candidate, zone);
    const dayMatch = cron.day.has(parts.day);
    const weekdayMatch = cron.weekday.has(parts.weekday);
    const calendarMatch = cron.anyDay
      ? weekdayMatch
      : cron.anyWeekday
        ? dayMatch
        : dayMatch || weekdayMatch;
    if (
      cron.minute.has(parts.minute) && cron.hour.has(parts.hour) &&
      cron.month.has(parts.month) && calendarMatch
    ) return candidate;
  }
  throw new AutomationInputError("Cron expression has no occurrence in the next 366 days.");
}

export function normalizeSchedule(value: unknown): AutomationSchedule {
  if (!isRecord(value)) throw new AutomationInputError("A schedule is required.");
  if (value["kind"] === "at") {
    const timestamp = Date.parse(string(value["at"]));
    if (!Number.isFinite(timestamp)) throw new AutomationInputError("Run at must be a valid date and time.");
    return { kind: "at", at: new Date(timestamp).toISOString() };
  }
  if (value["kind"] === "every") {
    const everyMs = value["everyMs"];
    if (!Number.isSafeInteger(everyMs) || (everyMs as number) < MIN_INTERVAL_MS) {
      throw new AutomationInputError("Repeat interval must be at least one minute.");
    }
    return { kind: "every", everyMs: everyMs as number };
  }
  if (value["kind"] === "cron") {
    const expression = string(value["expression"]).trim();
    const timezone = validateTimezone(string(value["timezone"]));
    parseCron(expression);
    return { kind: "cron", expression, timezone };
  }
  throw new AutomationInputError("Schedule kind must be at, every, or cron.");
}

export function nextScheduleAt(schedule: AutomationSchedule, afterMs: number): number | null {
  if (schedule.kind === "at") {
    const at = Date.parse(schedule.at);
    return at > afterMs ? at : null;
  }
  if (schedule.kind === "every") return afterMs + schedule.everyMs;
  return nextCronAt(schedule.expression, schedule.timezone, afterMs);
}

/** A task's next time after `afterMs` before its end (`until`); null once it has none. */
export function nextRunWithin(schedule: AutomationSchedule, afterMs: number, until: string | undefined): number | null {
  const next = nextScheduleAt(schedule, afterMs);
  return next === null || until === undefined || next < Date.parse(until) ? next : null;
}

/**
 * A temporary task HUI deletes now: its end (`until`) has come, whether a run of it is still going (`active`) or not,
 * or its last run is over. Deleting it is the one write that also turns it off: it never runs again.
 */
export function taskExpired(task: Pick<AutomationTask, "until" | "runsLeft">, nowMs: number, active: boolean): boolean {
  if (task.until !== undefined && Date.parse(task.until) <= nowMs) return true;
  return task.runsLeft === 0 && !active;
}

/** A new end must be in the future and after the task's next run (`next`, null when it has none), or it never runs. */
function checkUntil(until: string | undefined, next: number | null, nowMs: number): void {
  if (until === undefined) return;
  const end = Date.parse(until);
  if (end <= nowMs) throw new AutomationInputError("Until must be in the future.");
  if (next !== null && next >= end) throw new AutomationInputError("Until must come after the task's next run, or it would never run.");
}

const iso = (timestamp: number) => new Date(timestamp).toISOString();
const isoOrNull = (timestamp: number | null) => (timestamp === null ? null : iso(timestamp));

function text(value: unknown, label: string, maximum: number, required = true): string {
  if (typeof value !== "string") throw new AutomationInputError(`${label} must be text.`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > maximum) {
    throw new AutomationInputError(`${label} must be ${required ? `1-${maximum}` : `at most ${maximum}`} characters.`);
  }
  return trimmed;
}

/** `until`: absent stays absent (on update, the task keeps its own), `null` clears it, else an ISO date and time. */
function untilInput(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new AutomationInputError("Until must be a valid date and time.");
  return iso(timestamp);
}

/** `runs`: absent stays absent (on update, the runs left stay), `null` clears the limit, else 1 to `MAX_TASK_RUNS`. */
function runsInput(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_TASK_RUNS) {
    throw new AutomationInputError(`Runs must be a whole number from 1 to ${MAX_TASK_RUNS}.`);
  }
  return value as number;
}

export function normalizeTaskInput(value: unknown): AutomationTaskInput {
  if (!isRecord(value)) throw new AutomationInputError("Expected a task object.");
  const timeoutSeconds = value["timeoutSeconds"] === undefined ? 900 : value["timeoutSeconds"];
  if (!Number.isInteger(timeoutSeconds) || (timeoutSeconds as number) < 10 || (timeoutSeconds as number) > MAX_TIMEOUT_SECONDS) {
    throw new AutomationInputError(`Timeout must be between 10 and ${MAX_TIMEOUT_SECONDS} seconds.`);
  }
  if (value["enabled"] !== undefined && typeof value["enabled"] !== "boolean") {
    throw new AutomationInputError("Enabled must be a boolean.");
  }
  return {
    name: text(value["name"], "Name", 200),
    description: text(value["description"] ?? "", "Description", 500, false),
    sessionId: text(value["sessionId"], "Session", 200),
    prompt: text(value["prompt"], "Prompt", 20_000),
    schedule: normalizeSchedule(value["schedule"]),
    enabled: value["enabled"] !== false,
    timeoutSeconds: timeoutSeconds as number,
    ...(value["until"] !== undefined ? { until: untilInput(value["until"]) } : {}),
    ...(value["runs"] !== undefined ? { runs: runsInput(value["runs"]) } : {}),
  };
}

export class AutomationService {
  readonly #file: string;
  readonly #execute: AutomationExecutor;
  readonly #clock: Clock;
  #mutation = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #active = new Map<string, { runId: string; abort: AbortController }>();
  #started = false;

  constructor(file: string, execute: AutomationExecutor, clock: Clock = SYSTEM_CLOCK) {
    this.#file = file;
    this.#execute = execute;
    this.#clock = clock;
  }

  async #read(): Promise<AutomationFile> {
    let raw: string;
    try {
      raw = await readFile(this.#file, "utf8");
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") return { version: STORE_VERSION, tasks: [], runs: [] };
      throw new AutomationStoreError("HUI's automation registry could not be read.", { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AutomationStoreError("HUI's automation registry is not valid JSON.", { cause: error });
    }
    if (!isRecord(parsed) || !Array.isArray(parsed["tasks"]) || !Array.isArray(parsed["runs"])) {
      throw new AutomationStoreError("HUI's automation registry has an invalid shape.");
    }
    const tasks = parsed["tasks"].map(parseTask);
    const runs = parsed["runs"].map(parseRun);
    if (tasks.some((task) => !task) || runs.some((run) => !run)) {
      throw new AutomationStoreError("HUI's automation registry contains an invalid record.");
    }
    return { version: STORE_VERSION, tasks: tasks as AutomationTask[], runs: runs as AutomationRun[] };
  }

  async #write(file: AutomationFile): Promise<void> {
    try {
      await mkdir(dirname(this.#file), { recursive: true });
      const temporary = `${this.#file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await rename(temporary, this.#file);
    } catch (error) {
      throw new AutomationStoreError("HUI's automation registry could not be written.", { cause: error });
    }
  }

  #update(mutate: (file: AutomationFile) => AutomationFile): Promise<AutomationFile> {
    const operation = this.#mutation.then(async () => {
      const current = await this.#read();
      const next = mutate(current);
      await this.#write({ ...next, version: STORE_VERSION, runs: next.runs.slice(0, MAX_RUNS) });
      return next;
    });
    this.#mutation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const nowMs = this.#clock.now();
    const now = iso(nowMs);
    await this.#update((file) => ({
      ...file,
      runs: file.runs.map((run) =>
        run.status === "queued" || run.status === "running"
          ? { ...run, status: "failed", finishedAt: now, error: "HUI restarted before this run finished." }
          : run,
      ),
      // A temporary task whose end came, or whose last run was cut short, while HUI was down goes now: nothing runs.
      tasks: file.tasks.filter((task) => !taskExpired(task, nowMs, false)),
    }));
    await this.#wake();
  }

  async snapshot(): Promise<AutomationSnapshot> {
    await this.start();
    const file = await this.#read();
    const nextWake = file.tasks
      .filter((task) => task.enabled && task.nextRunAt)
      .map((task) => task.nextRunAt as string)
      .toSorted()[0] ?? null;
    return {
      scheduler: { enabled: true, activeRuns: this.#active.size, nextWakeAt: nextWake },
      tasks: file.tasks.toSorted((a, b) => a.name.localeCompare(b.name)),
      runs: file.runs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  /**
   * `createdBy`: who makes it; the operator unless a bot's `routines` tool says otherwise. A body never names its
   * maker, so no client of the routes can pass a task off as a bot's.
   */
  async create(value: unknown, options: { createdBy?: AutomationCreator } = {}): Promise<AutomationTask> {
    const { until: untilInput, runs, ...input } = normalizeTaskInput(value);
    const nowMs = this.#clock.now();
    if (input.schedule.kind === "at" && Date.parse(input.schedule.at) <= nowMs) {
      throw new AutomationInputError("Run at must be in the future.");
    }
    const until = untilInput ?? undefined;
    const first = nextScheduleAt(input.schedule, nowMs);
    checkUntil(until, first, nowMs);
    const now = iso(nowMs);
    const task: AutomationTask = {
      id: randomUUID(), ...input, description: input.description ?? "", enabled: input.enabled !== false,
      timeoutSeconds: input.timeoutSeconds ?? 900, createdAt: now, updatedAt: now,
      nextRunAt: input.enabled === false ? null : isoOrNull(first),
      createdBy: options.createdBy ?? { kind: "operator" },
      ...(until ? { until } : {}),
      ...(typeof runs === "number" ? { runsLeft: runs } : {}),
    };
    await this.#update((file) => ({ ...file, tasks: [...file.tasks, task] }));
    this.#reschedule();
    return task;
  }

  /** Replaces what the task does and when. Who made it stays; `until` and `runs` change only when given (`null`
   * clears them), so a client from before them keeps a task's limits. */
  async update(id: string, value: unknown): Promise<AutomationTask> {
    const { until: untilInput, runs, ...input } = normalizeTaskInput(value);
    const nowMs = this.#clock.now();
    if (input.schedule.kind === "at" && input.enabled !== false && Date.parse(input.schedule.at) <= nowMs) {
      throw new AutomationInputError("Run at must be in the future.");
    }
    let updated: AutomationTask | undefined;
    await this.#update((file) => {
      const current = file.tasks.find((task) => task.id === id);
      if (!current) throw new AutomationNotFoundError(`Unknown automation task: ${id}`);
      const enabled = input.enabled !== false;
      const until = untilInput === undefined ? current.until : untilInput ?? undefined;
      const runsLeft = runs === undefined ? current.runsLeft : runs ?? undefined;
      if (untilInput) checkUntil(until, enabled ? nextScheduleAt(input.schedule, nowMs) : null, nowMs);
      const { until: _until, runsLeft: _runsLeft, ...kept } = current;
      updated = {
        ...kept, ...input, description: input.description ?? "", enabled,
        timeoutSeconds: input.timeoutSeconds ?? 900, updatedAt: iso(nowMs),
        // A task with no runs left (its last run going) is not planned again.
        nextRunAt: !enabled || runsLeft === 0 ? null : isoOrNull(nextRunWithin(input.schedule, nowMs, until)),
        ...(until ? { until } : {}),
        ...(runsLeft !== undefined ? { runsLeft } : {}),
      };
      return { ...file, tasks: file.tasks.map((task) => task.id === id ? updated! : task) };
    });
    this.#reschedule();
    return updated!;
  }

  /** The run of the task going now, if any. */
  activeRun(id: string): string | undefined {
    return this.#active.get(id)?.runId;
  }

  /**
   * Deletes a task. A task with a run going is refused unless `whileRunning`: then the task goes and its run finishes
   * on its own, as when a bot removes a routine from that routine's own turn.
   */
  async remove(id: string, options: { whileRunning?: boolean } = {}): Promise<void> {
    if (this.#active.has(id) && !options.whileRunning) throw new AutomationConflictError("Stop the active run before deleting this task.");
    await this.#update((file) => {
      if (!file.tasks.some((task) => task.id === id)) throw new AutomationNotFoundError(`Unknown automation task: ${id}`);
      return { ...file, tasks: file.tasks.filter((task) => task.id !== id) };
    });
    this.#reschedule();
  }

  async run(id: string, source: AutomationRun["source"] = "manual"): Promise<AutomationRun> {
    await this.start();
    if (this.#active.has(id)) throw new AutomationConflictError("This task is already running.");
    let run: AutomationRun | undefined;
    let task: AutomationTask | undefined;
    await this.#update((file) => {
      const found = file.tasks.find((item) => item.id === id);
      if (!found) throw new AutomationNotFoundError(`Unknown automation task: ${id}`);
      const nowMs = this.#clock.now();
      if (found.runsLeft === 0) throw new AutomationConflictError("This task has no runs left.");
      if (found.until !== undefined && Date.parse(found.until) <= nowMs) throw new AutomationConflictError("This task has ended.");
      // A temporary task's run counts as it starts (a skipped one gives it back); after its last, nothing is planned.
      task = found.runsLeft === undefined ? found
        : { ...found, runsLeft: found.runsLeft - 1, ...(found.runsLeft === 1 ? { nextRunAt: null } : {}) };
      run = {
        id: randomUUID(), taskId: found.id, taskName: found.name, sessionId: found.sessionId,
        source, status: "queued", createdAt: iso(nowMs),
      };
      return { ...file, tasks: file.tasks.map((item) => item.id === id ? task! : item), runs: [run, ...file.runs] };
    });
    void this.#executeRun(task!, run!);
    return run!;
  }

  async cancel(runId: string): Promise<void> {
    const active = [...this.#active.values()].find((entry) => entry.runId === runId);
    if (!active) throw new AutomationConflictError("That run is no longer active.");
    active.abort.abort();
  }

  async #executeRun(task: AutomationTask, run: AutomationRun): Promise<void> {
    const abort = new AbortController();
    this.#active.set(task.id, { runId: run.id, abort });
    const startedAt = new Date(this.#clock.now()).toISOString();
    await this.#update((file) => ({
      ...file,
      runs: file.runs.map((item) => item.id === run.id ? { ...item, status: "running", startedAt } : item),
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => abort.abort(), task.timeoutSeconds * 1000);
      timer.unref();
      const result = await this.#execute(task, abort.signal);
      await this.#finish(task.id, run.id, abort.signal.aborted ? "cancelled" : "completed", result.summary);
    } catch (error) {
      const cancelled = abort.signal.aborted;
      await this.#finish(
        task.id,
        run.id,
        cancelled ? "cancelled" : error instanceof AutomationConflictError ? "skipped" : "failed",
        undefined,
        cancelled ? "Run cancelled." : error instanceof Error ? error.message : "Automation failed.",
      );
    } finally {
      if (timer) clearTimeout(timer);
      this.#active.delete(task.id);
    }
  }

  /** Records how a run ended. A skipped run gives a temporary task its run back; a temporary task whose last run this
   * was, or whose end came meanwhile, goes. */
  async #finish(
    taskId: string,
    runId: string,
    status: AutomationRun["status"],
    summary?: string,
    error?: string,
  ): Promise<void> {
    const nowMs = this.#clock.now();
    const finishedAt = iso(nowMs);
    let changed = false;
    await this.#update((file) => {
      const runs = file.runs.map((run) => run.id === runId
        ? { ...run, status, finishedAt, ...(summary ? { summary } : {}), ...(error ? { error } : {}) }
        : run);
      const current = file.tasks.find((task) => task.id === taskId);
      if (!current) return { ...file, runs };
      const task = status === "skipped" && current.runsLeft !== undefined
        ? {
          ...current, runsLeft: current.runsLeft + 1,
          nextRunAt: current.nextRunAt ?? (current.enabled ? isoOrNull(nextRunWithin(current.schedule, nowMs, current.until)) : null),
        }
        : current;
      const expired = taskExpired(task, nowMs, false);
      changed = expired || task !== current;
      return {
        ...file, runs,
        tasks: expired ? file.tasks.filter((item) => item.id !== taskId) : file.tasks.map((item) => item.id === taskId ? task : item),
      };
    });
    if (changed) this.#reschedule();
  }

  async #wake(): Promise<void> {
    if (!this.#started) return;
    const nowMs = this.#clock.now();
    let due: AutomationTask[] = [];
    await this.#update((file) => {
      // Temporary tasks whose end came go first (a run still going finishes on its own), as do any whose last run is over.
      const tasks = file.tasks.filter((task) => !taskExpired(task, nowMs, this.#active.has(task.id)));
      due = tasks.filter((task) => task.enabled && task.nextRunAt !== null && Date.parse(task.nextRunAt) <= nowMs);
      if (!due.length && tasks.length === file.tasks.length) return file;
      return {
        ...file,
        tasks: tasks.map((task) => {
          if (!due.some((item) => item.id === task.id)) return task;
          return {
            ...task,
            enabled: task.schedule.kind === "at" ? false : task.enabled,
            nextRunAt: isoOrNull(nextRunWithin(task.schedule, nowMs, task.until)),
            updatedAt: iso(nowMs),
          };
        }),
      };
    });
    for (const task of due) {
      try {
        await this.run(task.id, "scheduled");
      } catch (error) {
        if (!(error instanceof AutomationConflictError)) throw error;
      }
    }
    this.#reschedule();
  }

  #reschedule(): void {
    if (this.#timer) this.#clock.clearTimer(this.#timer);
    this.#timer = undefined;
    if (!this.#started) return;
    void this.#read().then((file) => {
      // The next run, or the next end of a temporary task, paused ones included.
      const next = file.tasks
        .flatMap((task) => [
          ...(task.enabled && task.nextRunAt ? [Date.parse(task.nextRunAt)] : []),
          ...(task.until !== undefined ? [Date.parse(task.until)] : []),
        ])
        .filter(Number.isFinite)
        .toSorted((a, b) => a - b)[0];
      if (next === undefined) return;
      const delay = Math.max(0, Math.min(2_147_000_000, next - this.#clock.now()));
      this.#timer = this.#clock.setTimer(() => void this.#wake(), delay);
      this.#timer.unref?.();
    });
  }

  dispose(): void {
    if (this.#timer) this.#clock.clearTimer(this.#timer);
    this.#timer = undefined;
    for (const active of this.#active.values()) active.abort.abort();
    this.#active.clear();
    this.#started = false;
  }
}
