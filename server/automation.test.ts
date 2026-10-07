import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutomationConflictError,
  AutomationInputError,
  AutomationService,
  AutomationStoreError,
  nextCronAt,
  normalizeSchedule,
  parseCron,
} from "./automation.ts";
import type { AutomationTask } from "../src/lib/automation-types.ts";
import { waitFor } from "./test-support/wait-for.ts";

const future = "2030-01-02T12:00:00.000Z";

async function temporaryFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "hui-automation-")), "automation.json");
}

/** Waits until the newest run has ended with `status` and the service holds it no longer: its record can be on disk
 * a moment before the run lets go. A timeout shows the scheduler and the runs. */
async function runEnds(service: AutomationService, status: string): Promise<void> {
  await waitFor(`the run to end ${status}`, async () => {
    const { scheduler, runs } = await service.snapshot();
    return runs[0]?.status === status && scheduler.activeRuns === 0;
  }, {
    state: async () => {
      const { scheduler, runs } = await service.snapshot();
      return { scheduler, runs };
    },
  });
}

test("validates cron fields and finds the next zoned occurrence", () => {
  assert.deepEqual([...parseCron("15 9 * * 1-5").minute], [15]);
  assert.equal(
    new Date(nextCronAt("0 9 * * 1-5", "Europe/Madrid", Date.parse("2026-09-18T12:00:00Z"))).toISOString(),
    "2026-09-21T07:00:00.000Z",
  );
  assert.throws(() => parseCron("0 25 * * *"), AutomationInputError);
  assert.throws(() => normalizeSchedule({ kind: "every", everyMs: 59_999 }), AutomationInputError);
  assert.throws(() => normalizeSchedule({ kind: "cron", expression: "0 9 * * *", timezone: "Mars/Olympus" }), AutomationInputError);
});

test("persists task definitions atomically and reloads them", async () => {
  const file = await temporaryFile();
  const first = new AutomationService(file, async () => ({}));
  const created = await first.create({
    name: "Daily review",
    description: "Review the current workspace",
    sessionId: "session-1",
    prompt: "Review open work.",
    schedule: { kind: "at", at: future },
    enabled: true,
    timeoutSeconds: 120,
  });
  assert.equal(created.nextRunAt, future);
  first.dispose();

  const second = new AutomationService(file, async () => ({}));
  const snapshot = await second.snapshot();
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.name, "Daily review");
  assert.equal(snapshot.runs.length, 0);
  second.dispose();

  const stored = JSON.parse(await readFile(file, "utf8")) as { version: number };
  assert.equal(stored.version, 1);
});

test("records manual run lifecycle and summary", async () => {
  const file = await temporaryFile();
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    release = resolveStarted;
  });
  let entered!: () => void;
  const executorEntered = new Promise<void>((resolve) => { entered = resolve; });
  const service = new AutomationService(file, async () => {
    entered();
    await started;
    return { summary: "Done" };
  });
  const task = await service.create({
    name: "Review",
    sessionId: "session-1",
    prompt: "Review this.",
    schedule: { kind: "at", at: future },
  });
  const queued = await service.run(task.id);
  assert.equal(queued.status, "queued");
  await executorEntered;
  assert.equal((await service.snapshot()).runs[0]?.status, "running");
  release();
  await runEnds(service, "completed");
  const completed = (await service.snapshot()).runs[0];
  assert.equal(completed?.summary, "Done");
  assert.ok(completed?.finishedAt);
  service.dispose();
});

test("cancels only an active run and records cancellation", async () => {
  const file = await temporaryFile();
  let entered!: () => void;
  const executorEntered = new Promise<void>((resolve) => { entered = resolve; });
  const service = new AutomationService(file, async (_task, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
    return {};
  });
  const task = await service.create({
    name: "Long task",
    sessionId: "session-1",
    prompt: "Wait.",
    schedule: { kind: "at", at: future },
  });
  const run = await service.run(task.id);
  await executorEntered;
  await service.cancel(run.id);
  await runEnds(service, "cancelled");
  await assert.rejects(() => service.cancel(run.id));
  service.dispose();
});

test("corrupt automation data is reported and never replaced", async () => {
  const file = await temporaryFile();
  await writeFile(file, "{broken", "utf8");
  const service = new AutomationService(file, async () => ({}));
  await assert.rejects(() => service.snapshot(), AutomationStoreError);
  assert.equal(await readFile(file, "utf8"), "{broken");
  service.dispose();
});

/**
 * A clock the test moves: timers fire only when `advance` passes them. The scheduler never waits on a real timer; only
 * the tests' waits for its writes to land do, through waitFor and its limit in time rather than attempts.
 */
function manualClock(start: number) {
  let now = start;
  const timers = new Set<{ at: number; callback: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimer: (callback: () => void, delay: number) => {
        const timer = { at: now + delay, callback };
        timers.add(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as { at: number; callback: () => void }); },
    },
    /** When the scheduler next wakes, as it planned it; undefined while it planned nothing. */
    nextWake: () => [...timers].map((timer) => timer.at).toSorted((a, b) => a - b)[0],
    /** Moves time to `at` and fires every timer due by then. */
    advanceTo(at: number) {
      now = at;
      for (const timer of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(timer);
        timer.callback();
      }
    },
  };
}

const T0 = Date.parse("2030-01-01T09:00:00.000Z");
const MINUTE = 60_000;
const taskNamed = async (service: AutomationService, name: string): Promise<AutomationTask | undefined> =>
  (await service.snapshot()).tasks.find((task) => task.name === name);

test("a task records who made it, and tasks from before keep loading without it or any limit", async () => {
  const file = await temporaryFile();
  const service = new AutomationService(file, async () => ({}));
  const byOperator = await service.create({ name: "Review", sessionId: "s-1", prompt: "Review.", schedule: { kind: "at", at: future } });
  assert.deepEqual(byOperator.createdBy, { kind: "operator" }, "the routes' tasks are the operator's");
  const byBot = await service.create(
    { name: "Watch", sessionId: "s-2", prompt: "Check.", schedule: { kind: "every", everyMs: 5 * MINUTE }, until: "2030-01-02T18:00:00.000Z", runs: 3 },
    { createdBy: { kind: "bot", botId: "bot-1", handle: "ada" } },
  );
  assert.deepEqual([byBot.createdBy, byBot.until, byBot.runsLeft], [{ kind: "bot", botId: "bot-1", handle: "ada" }, "2030-01-02T18:00:00.000Z", 3]);
  assert.equal("runs" in byBot, false, "runs is input; the task keeps the runs it has left");
  // A body that names a maker is ignored: only the bot tool's path says a bot made a task.
  const claimed = await service.create({ name: "Sneaky", sessionId: "s-1", prompt: "x", schedule: { kind: "at", at: future }, createdBy: { kind: "bot", botId: "b", handle: "b" } });
  assert.deepEqual(claimed.createdBy, { kind: "operator" });
  service.dispose();

  // A registry from before these fields, with one hand-edited value each that is not valid, loads as it is.
  const old = await temporaryFile();
  const base = { id: "t-old", name: "Old", description: "", sessionId: "s-1", prompt: "p", schedule: { kind: "every", everyMs: MINUTE }, enabled: false, timeoutSeconds: 900, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", nextRunAt: null };
  await writeFile(old, JSON.stringify({ version: 1, tasks: [base, { ...base, id: "t-odd", name: "Odd", createdBy: { kind: "robot" }, until: "soon", runsLeft: -2 }], runs: [] }), "utf8");
  const reloaded = new AutomationService(old, async () => ({}));
  const tasks = (await reloaded.snapshot()).tasks;
  assert.deepEqual(tasks.map((task) => [task.name, task.createdBy, task.until, task.runsLeft]), [["Odd", undefined, undefined, undefined], ["Old", undefined, undefined, undefined]]);
  reloaded.dispose();
});

test("until and runs are checked, and an update changes them only when it names them", async () => {
  const file = await temporaryFile();
  const { clock } = manualClock(T0);
  const service = new AutomationService(file, async () => ({}), clock);
  const body = { name: "Watch", sessionId: "s-1", prompt: "Check.", schedule: { kind: "every", everyMs: 30 * MINUTE } };
  for (const [limits, pattern] of [
    [{ runs: 0 }, /Runs must be a whole number from 1 to 1000/u], [{ runs: 1001 }, /from 1 to 1000/u], [{ runs: 1.5 }, /whole number/u],
    [{ until: "tomorrow-ish" }, /Until must be a valid date/u], [{ until: new Date(T0 - MINUTE).toISOString() }, /Until must be in the future/u],
    [{ until: new Date(T0 + 10 * MINUTE).toISOString() }, /after the task's next run, or it would never run/u],
  ] as const) await assert.rejects(service.create({ ...body, ...limits }), (error: unknown) => error instanceof AutomationInputError && pattern.test(error.message), JSON.stringify(limits));
  const until = new Date(T0 + 3 * 60 * MINUTE).toISOString();
  const task = await service.create({ ...body, until, runs: 4 });
  assert.equal(task.nextRunAt, new Date(T0 + 30 * MINUTE).toISOString());
  // The Automations page and the enable switch send the task without its limits: they stay.
  const renamed = await service.update(task.id, { ...body, name: "Watch #82", enabled: false });
  assert.deepEqual([renamed.name, renamed.until, renamed.runsLeft, renamed.nextRunAt], ["Watch #82", until, 4, null]);
  const changed = await service.update(task.id, { ...body, runs: 2, until: new Date(T0 + 60 * MINUTE).toISOString() });
  assert.deepEqual([changed.runsLeft, changed.until], [2, new Date(T0 + 60 * MINUTE).toISOString()]);
  const cleared = await service.update(task.id, { ...body, runs: null, until: null });
  assert.equal("runsLeft" in cleared || "until" in cleared, false, "null clears both limits");
  assert.deepEqual(cleared.createdBy, { kind: "operator" }, "who made it stays");
  service.dispose();
});

test("a temporary task ends at its until: HUI deletes it then, paused or not, and a run still going finishes on its own", async () => {
  const file = await temporaryFile();
  const time = manualClock(T0);
  let hold: Promise<void> | undefined;
  let release!: () => void;
  const service = new AutomationService(file, async () => { if (hold) await hold; return { summary: "checked" }; }, time.clock);
  await service.start();
  const until = new Date(T0 + 2.5 * MINUTE).toISOString();
  await service.create({ name: "Watch", sessionId: "s-1", prompt: "Check.", schedule: { kind: "every", everyMs: MINUTE }, until });
  await service.create({ name: "Paused", sessionId: "s-1", prompt: "Later.", schedule: { kind: "every", everyMs: MINUTE }, enabled: false, until });
  await waitFor("the first run is planned", async () => time.nextWake() === T0 + MINUTE);
  time.advanceTo(T0 + MINUTE);
  await waitFor("first run", async () => (await service.snapshot()).runs.filter((run) => run.status === "completed").length === 1);
  await waitFor("the second run is planned", async () => time.nextWake() === T0 + 2 * MINUTE);
  // The second run is still going when the end comes.
  hold = new Promise<void>((resolve) => { release = resolve; });
  time.advanceTo(T0 + 2 * MINUTE);
  await waitFor("second run going", async () => (await service.snapshot()).runs.some((run) => run.status === "running"));
  const watching = await taskNamed(service, "Watch");
  assert.equal(watching?.nextRunAt, null, "no run is planned at or after its end");
  await waitFor("the scheduler wakes at the end", async () => time.nextWake() === Date.parse(until));
  time.advanceTo(Date.parse(until));
  await waitFor("both tasks went at their end, the paused one too", async () => (await service.snapshot()).tasks.length === 0);
  release();
  await waitFor("the run going finished on its own", async () => (await service.snapshot()).runs.filter((run) => run.status === "completed").length === 2);
  service.dispose();
});

test("a task with runs runs that many times, then goes; a skipped run gives its run back", async () => {
  const file = await temporaryFile();
  const time = manualClock(T0);
  const outcomes: Array<() => Promise<{ summary?: string }>> = [
    async () => { throw new AutomationConflictError("The target session is already running."); },
    async () => ({ summary: "one" }),
    async () => ({ summary: "two" }),
  ];
  const service = new AutomationService(file, async () => outcomes.shift()!(), time.clock);
  await service.start();
  const task = await service.create({ name: "Twice", sessionId: "s-1", prompt: "Go.", schedule: { kind: "every", everyMs: MINUTE }, runs: 2 });
  await waitFor("first time planned", async () => time.nextWake() === T0 + MINUTE);
  time.advanceTo(T0 + MINUTE);
  await waitFor("skipped", async () => (await service.snapshot()).runs[0]?.status === "skipped");
  assert.equal((await taskNamed(service, "Twice"))?.runsLeft, 2, "a skipped run never reached its target and gives its run back");
  await waitFor("next time planned", async () => time.nextWake() === T0 + 2 * MINUTE);
  time.advanceTo(T0 + 2 * MINUTE);
  await waitFor("scheduled run", async () => (await service.snapshot()).runs[0]?.status === "completed");
  assert.equal((await taskNamed(service, "Twice"))?.runsLeft, 1);
  // A run by hand counts too; it is the last, so the task goes once it ends.
  await service.run(task.id);
  await waitFor("gone after its last run", async () => (await service.snapshot()).tasks.length === 0);
  const runs = (await service.snapshot()).runs;
  assert.deepEqual(runs.map((run) => [run.source, run.status]).toReversed(), [["scheduled", "skipped"], ["scheduled", "completed"], ["manual", "completed"]]);
  await assert.rejects(service.run(task.id), /Unknown automation task/u);
  service.dispose();
});

test("limits hold across a restart: an end that came, or a last run cut short, while HUI was down deletes the task at start", async () => {
  const file = await temporaryFile();
  const first = new AutomationService(file, async () => ({}), manualClock(T0).clock);
  await first.create({ name: "Ends", sessionId: "s-1", prompt: "p", schedule: { kind: "every", everyMs: 5 * MINUTE }, until: new Date(T0 + 10 * MINUTE).toISOString(), runs: 3 });
  await first.create({ name: "Kept", sessionId: "s-1", prompt: "p", schedule: { kind: "every", everyMs: 24 * 60 * MINUTE }, runs: 2 });
  const last = await first.create({ name: "Last", sessionId: "s-1", prompt: "p", schedule: { kind: "every", everyMs: 5 * MINUTE }, runs: 1 });
  first.dispose();

  // Before the end: everything is as it was, runs left included.
  const second = new AutomationService(file, () => new Promise(() => {}), manualClock(T0 + 4 * MINUTE).clock);
  assert.deepEqual((await second.snapshot()).tasks.map((task) => [task.name, task.runsLeft]), [["Ends", 3], ["Kept", 2], ["Last", 1]]);
  // The last run of Last starts and never finishes: HUI goes down meanwhile.
  await second.run(last.id);
  await waitFor("Last's run going", async () => (await second.snapshot()).runs[0]?.status === "running");
  assert.equal((await taskNamed(second, "Last"))?.runsLeft, 0);
  second.dispose();

  const third = new AutomationService(file, async () => ({}), manualClock(T0 + 11 * MINUTE).clock);
  const snapshot = await third.snapshot();
  assert.deepEqual(snapshot.tasks.map((task) => [task.name, task.runsLeft]), [["Kept", 2]], "Ends ended and Last's last run is over");
  assert.deepEqual([snapshot.runs[0]?.taskName, snapshot.runs[0]?.status, snapshot.runs[0]?.error], ["Last", "failed", "HUI restarted before this run finished."]);
  third.dispose();
});

test("a task whose run is going is deleted only when asked to leave the run be, which then finishes on its own", async () => {
  const file = await temporaryFile();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const service = new AutomationService(file, async () => { await held; return { summary: "done" }; });
  const task = await service.create({ name: "Long", sessionId: "s-1", prompt: "Wait.", schedule: { kind: "at", at: future } });
  const run = await service.run(task.id);
  await waitFor("run active", async () => service.activeRun(task.id) === run.id);
  await assert.rejects(service.remove(task.id), AutomationConflictError);
  await service.remove(task.id, { whileRunning: true });
  assert.equal((await service.snapshot()).tasks.length, 0);
  release();
  await waitFor("the run finished", async () => (await service.snapshot()).runs[0]?.status === "completed");
  assert.equal(service.activeRun(task.id), undefined);
  service.dispose();
});
