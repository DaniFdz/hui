import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProgressCard, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import { FINISHED_BATCH_VISIBLE_MS } from "../subagent-activity.ts";
import { runStatus, runStatusPanel, runStatusPanelChosen, runStatusPanelOpen } from "./run-status.ts";

const now = Date.parse("2026-11-14T12:00:00.000Z");
const startedAt = new Date(now - 60_000).toISOString();
const endedAt = new Date(now - 10_000).toISOString();
const goal = (status: SessionGoal["status"] = "active"): SessionGoal => ({
  objective: "ship the release",
  status,
  createdAt: "2026-11-14T11:00:00.000Z",
  updatedAt: "2026-11-14T11:30:00.000Z",
  continuations: 3,
});
const progress: ProgressCard = {
  markdown: "HUI's utility model writes this",
  steps: [
    { step: "Read the brief", status: "completed" },
    { step: "Verify the presentation", status: "in_progress" },
    { step: "Publish it", status: "pending" },
  ],
};
const task = (taskId: string, status: SubagentTaskView["status"], extra: Partial<SubagentTaskView> = {}): SubagentTaskView => ({
  taskId,
  sessionId: `s-${taskId}`,
  parentSessionId: "s",
  title: `Check ${taskId}`,
  status,
  startedAt,
  updatedAt: endedAt,
  ...extra,
});

test("a conversation with nothing to report draws no trigger", () => {
  const model = runStatus({ goal: undefined, progress: undefined, subagents: [], streaming: false, waiting: false, now });
  assert.equal(model.visible, false);
  assert.equal(model.tone, "idle");
  assert.equal(model.count, undefined);
});

test("a goal, plan and running helpers summarize as Working with the plan's count", () => {
  const model = runStatus({
    goal: goal(),
    progress,
    subagents: [task("a", "running"), task("b", "running"), task("c", "queued")],
    streaming: true,
    waiting: false,
    now,
  });
  assert.equal(model.visible, true);
  assert.equal(model.tone, "running");
  assert.equal(model.label, "Working");
  assert.equal(model.count, "1/3");
  assert.equal(model.attention, false);
  assert.equal(model.plan?.done, 1);
  assert.equal(model.plan?.total, 3);
  assert.equal(model.plan?.current?.step, "Verify the presentation");
  assert.equal(model.plan?.allComplete, false);
  assert.deepEqual(
    { total: model.helpers?.total, running: model.helpers?.running, queued: model.helpers?.queued, finished: model.helpers?.finished },
    { total: 3, running: 2, queued: 1, finished: 0 },
  );
  assert.match(model.summary, /^Run status: Working, goal pursuing, 1 of 3 steps done, 3 of 3 helpers active$/u);
});

test("an open question outranks a running turn and marks the trigger for attention", () => {
  const model = runStatus({ goal: goal(), progress, subagents: [], streaming: true, waiting: true, now });
  assert.equal(model.tone, "waiting");
  assert.equal(model.label, "Waiting for your answer");
  assert.equal(model.attention, true);
});

test("a blocked goal stays blocked while its turn finishes, and a paused one reads as paused", () => {
  const blocked = runStatus({ goal: goal("blocked"), progress, subagents: [], streaming: true, waiting: false, now });
  assert.equal(blocked.tone, "blocked");
  assert.equal(blocked.label, "Goal blocked");
  assert.equal(blocked.attention, true);

  const paused = runStatus({ goal: goal("paused"), progress, subagents: [], streaming: false, waiting: false, now });
  assert.equal(paused.tone, "paused");
  assert.equal(paused.label, "Goal paused");
  assert.equal(paused.attention, false);
});

test("a completed job reads as done, and some time between turns still says the goal is pursued", () => {
  const complete = runStatus({
    goal: goal("complete"),
    progress: { markdown: "", steps: progress.steps.map((step) => ({ ...step, status: "completed" as const })) },
    subagents: [task("a", "completed"), task("b", "completed")],
    streaming: false,
    waiting: false,
    now,
  });
  assert.equal(complete.tone, "done");
  assert.equal(complete.label, "Goal achieved");
  assert.equal(complete.count, "3/3");
  assert.equal(complete.plan?.allComplete, true);

  const between = runStatus({ goal: goal(), progress, subagents: [], streaming: false, waiting: false, now });
  assert.equal(between.tone, "idle");
  assert.equal(between.label, "Pursuing goal");
});

test("a failed helper raises attention once the turn is over", () => {
  const model = runStatus({
    goal: undefined,
    progress,
    subagents: [task("a", "completed"), task("b", "failed", { error: "Provider refused" })],
    streaming: false,
    waiting: false,
    now,
  });
  assert.equal(model.tone, "attention");
  assert.equal(model.label, "Helper failed");
  assert.equal(model.attention, true);
  assert.equal(model.helpers?.failed, 1);
  assert.equal(model.helpers?.finished, 2);
  assert.equal(model.count, "1/3", "the plan count is the trigger's compact number");
});

test("helpers alone count finished of total, and a whole successful batch reads as done", () => {
  const active = runStatus({ goal: undefined, progress: undefined, subagents: [task("a", "running"), task("b", "completed"), task("c", "queued")], streaming: false, waiting: false, now });
  assert.equal(active.count, "1/3");
  assert.equal(active.label, "Working");

  const done = runStatus({ goal: undefined, progress: undefined, subagents: [task("a", "completed"), task("b", "completed")], streaming: false, waiting: false, now });
  assert.equal(done.tone, "done");
  assert.equal(done.label, "Done");
  assert.equal(done.count, "2/2");
  assert.equal(done.helpers?.allSucceeded, true);
});

test("a finished batch leaves the trigger once it has been gone for an hour", () => {
  const old = {
    ...task("a", "completed"),
    startedAt: new Date(now - FINISHED_BATCH_VISIBLE_MS - 120_000).toISOString(),
    endedAt: new Date(now - FINISHED_BATCH_VISIBLE_MS - 60_000).toISOString(),
    updatedAt: new Date(now - FINISHED_BATCH_VISIBLE_MS - 60_000).toISOString(),
  };
  const expired = runStatus({ goal: undefined, progress: undefined, subagents: [old], streaming: false, waiting: false, now });
  assert.equal(expired.visible, false);
  assert.equal(expired.helpers, undefined);
});

test("the Run status popover opens by itself on a wide window while a run streams", () => {
  const idle = runStatusPanel(undefined, { running: false });
  assert.deepEqual(idle, { running: false, choice: undefined });
  assert.equal(runStatusPanelOpen(idle, { running: false, wide: true }), false, "idle stays closed");

  const started = runStatusPanel(idle, { running: true });
  assert.deepEqual(started, { running: true, choice: undefined });
  assert.equal(runStatusPanelOpen(started, { running: true, wide: true }), true);
  assert.equal(runStatusPanelOpen(started, { running: true, wide: false }), false, "a phone stays closed mid-run");
});

test("the operator's close holds until the next run, and their open does too", () => {
  const running = runStatusPanel(undefined, { running: true });
  const closed = runStatusPanelChosen(running, false);
  assert.deepEqual(closed, { running: true, choice: false });
  assert.equal(runStatusPanelOpen(closed, { running: true, wide: true }), false, "the operator's close wins over the default");

  const ended = runStatusPanel(closed, { running: false });
  assert.deepEqual(ended, { running: false, choice: false });
  assert.equal(runStatusPanelOpen(ended, { running: false, wide: true }), false, "a finished run keeps the operator's close");

  const next = runStatusPanel(ended, { running: true });
  assert.deepEqual(next, { running: true, choice: undefined }, "a new run starts with the default");
  assert.equal(runStatusPanelOpen(next, { running: true, wide: true }), true);

  // An open belongs to its run as well: it holds for the rest of that run and its end, and the next run starts from the
  // default instead of carrying forward a choice that answered the earlier run.
  const opened = runStatusPanelChosen(running, true);
  const settled = runStatusPanel(opened, { running: false });
  assert.deepEqual(settled, { running: false, choice: true }, "the open holds through its run's end");
  assert.equal(runStatusPanelOpen(settled, { running: false, wide: true }), true);
  assert.deepEqual(runStatusPanel(settled, { running: true }), { running: true, choice: undefined }, "the next run clears the open");
});

test("an operator's open during a run is cleared when the next run starts", () => {
  // A phone's operator opened the panel while the run streamed, and it held through that run's end.
  const opened = runStatusPanelChosen(runStatusPanel(undefined, { running: true }), true);
  assert.equal(runStatusPanelOpen(opened, { running: true, wide: false }), true, "an explicit open works on a phone");
  const phoneEnded = runStatusPanel(opened, { running: false });
  assert.equal(runStatusPanelOpen(phoneEnded, { running: false, wide: false }), true, "the open holds through its run's end");

  // The next run starts from the default: collapsed on a phone...
  const phoneNext = runStatusPanel(phoneEnded, { running: true });
  assert.deepEqual(phoneNext, { running: true, choice: undefined }, "a new run starts with the default");
  assert.equal(runStatusPanelOpen(phoneNext, { running: true, wide: false }), false, "a phone's next run is collapsed");

  // ...and open on a wide window, whatever the operator did with the earlier run's panel.
  const wide = runStatusPanelChosen(runStatusPanel(undefined, { running: true }), true);
  const wideNext = runStatusPanel(runStatusPanel(wide, { running: false }), { running: true });
  assert.deepEqual(wideNext, { running: true, choice: undefined });
  assert.equal(runStatusPanelOpen(wideNext, { running: true, wide: true }), true, "a wide window's next run opens");
});

test("an operator's open while idle survives and works on a phone", () => {
  const opened = runStatusPanelChosen(runStatusPanel(undefined, { running: false }), true);
  assert.equal(runStatusPanelOpen(opened, { running: false, wide: true }), true);
  assert.equal(runStatusPanelOpen(opened, { running: false, wide: false }), true, "an explicit open works on a phone");
  assert.deepEqual(runStatusPanel(opened, { running: false }), { running: false, choice: true }, "idle time keeps the choice");

  const phone = runStatusPanelChosen(runStatusPanel(undefined, { running: true }), true);
  assert.deepEqual(phone, { running: true, choice: true });
  assert.equal(runStatusPanelOpen(phone, { running: true, wide: false }), true);
});

test("a first render mid-run opens on a wide window", () => {
  const first = runStatusPanel(undefined, { running: true });
  assert.deepEqual(first, { running: true, choice: undefined });
  assert.equal(runStatusPanelOpen(first, { running: true, wide: true }), true);
});

test("background watchers keep the trigger alive and count as working", () => {
  const watcher = (id: string, state: "running" | "done" | "failed" | "dead") => ({
    id,
    purpose: `Watch ${id}`,
    target: "",
    outcome: "",
    command: "bash watch.sh",
    pid: null,
    logPath: `/tmp/${id}.log`,
    state,
    startedAt: new Date(now - 60_000).toISOString(),
    lastLine: "still waiting",
  });
  const model = runStatus({
    goal: undefined,
    progress: undefined,
    subagents: [],
    watchers: [watcher("a", "running"), watcher("b", "running"), watcher("c", "done")],
    streaming: false,
    waiting: false,
    now,
  });
  assert.equal(model.visible, true);
  assert.equal(model.tone, "running");
  assert.equal(model.label, "Working");
  assert.equal(model.count, "2/3");
  assert.match(model.summary, /2 of 3 watchers running/u);

  const failed = runStatus({
    goal: undefined,
    progress: undefined,
    subagents: [],
    watchers: [watcher("a", "failed")],
    streaming: false,
    waiting: false,
    now,
  });
  assert.equal(failed.tone, "attention");
  assert.equal(failed.label, "Watcher failed");
  assert.equal(failed.attention, true);
  assert.match(failed.summary, /1 watcher$/u);
});
