import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProgressCard, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import { FINISHED_BATCH_VISIBLE_MS } from "../subagent-activity.ts";
import { runStatus } from "./run-status.ts";

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
