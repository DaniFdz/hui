import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProgressCard, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import { FINISHED_BATCH_VISIBLE_MS } from "../subagent-activity.ts";
import { runStatus, runStatusMorphPhase, runStatusMorphShape, runStatusMorphTiming, runStatusPanel, runStatusPanelChosen, runStatusPanelOpen } from "./run-status.ts";

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

test("the operator's close lasts one run, and their open lasts until they close it", () => {
  const running = runStatusPanel(undefined, { running: true });
  const closed = runStatusPanelChosen(running, false);
  assert.deepEqual(closed, { running: true, choice: false });
  assert.equal(runStatusPanelOpen(closed, { running: true, wide: true }), false, "the operator's close wins over the default");

  const ended = runStatusPanel(closed, { running: false });
  assert.deepEqual(ended, { running: false, choice: false });
  assert.equal(runStatusPanelOpen(ended, { running: false, wide: true }), false, "a finished run keeps the operator's close");

  const next = runStatusPanel(ended, { running: true });
  assert.deepEqual(next, { running: true, choice: undefined }, "a new run starts with the default after a close");
  assert.equal(runStatusPanelOpen(next, { running: true, wide: true }), true);

  // An open is the operator's own: a run the conversation starts on its own — a watcher settling, a helper finishing —
  // must not shut the panel they are reading, so the open outlives that run and the next one until they close it.
  const opened = runStatusPanelChosen(running, true);
  const settled = runStatusPanel(opened, { running: false });
  assert.deepEqual(settled, { running: false, choice: true }, "the open holds through its run's end");
  assert.equal(runStatusPanelOpen(settled, { running: false, wide: true }), true);
  const carried = runStatusPanel(settled, { running: true });
  assert.deepEqual(carried, { running: true, choice: true }, "a later run leaves the operator's open alone");
  assert.equal(runStatusPanelOpen(carried, { running: true, wide: false }), true, "on a phone too, until they close it");
  assert.equal(runStatusPanelOpen(runStatusPanelChosen(carried, false), { running: true, wide: false }), false, "and their close still ends it");
});

test("an operator's open outlives the run it was made in, on a phone too", () => {
  // A phone's operator opened the panel while the run streamed; a run the conversation starts on its own then ends.
  const opened = runStatusPanelChosen(runStatusPanel(undefined, { running: true }), true);
  assert.equal(runStatusPanelOpen(opened, { running: true, wide: false }), true, "an explicit open works on a phone");
  const phoneEnded = runStatusPanel(opened, { running: false });
  assert.equal(runStatusPanelOpen(phoneEnded, { running: false, wide: false }), true, "the open holds through its run's end");

  // A later run, which the operator did not start, leaves it open: closing under them was the defect.
  const phoneNext = runStatusPanel(phoneEnded, { running: true });
  assert.equal(runStatusPanelOpen(phoneNext, { running: true, wide: false }), true, "a phone keeps the panel the operator opened");

  // Only their own close ends it, and the run after that starts from the default again.
  const phoneClosed = runStatusPanelChosen(phoneNext, false);
  assert.equal(runStatusPanelOpen(phoneClosed, { running: true, wide: false }), false);
  const afterClose = runStatusPanel(runStatusPanel(phoneClosed, { running: false }), { running: true });
  assert.deepEqual(afterClose, { running: true, choice: undefined });
  assert.equal(runStatusPanelOpen(afterClose, { running: true, wide: false }), false, "the next run after a close is collapsed on a phone");
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

test("background watchers keep the trigger alive and count as working", () => {  const watcher = (id: string, state: "running" | "done" | "failed" | "dead") => ({
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

test("the panel's first frame is the pill's shape on the corner the two share", () => {
  // The chat header's pill sits above the panel's top-right corner, six pixels past the popover's distance.
  const pill = { x: 1100, y: 20, width: 104, height: 28 };
  const panel = { x: 784, y: 54, width: 420, height: 360 };
  const shape = runStatusMorphShape({ pill, panel, reducedMotion: false });
  assert.deepEqual(shape, {
    // The panel's top-right corner lands on the pill's bottom-right corner: the panel never covers the pill.
    transform: "translate(0px, -6px) scale(0.2476, 0.0778)",
    origin: "top right",
  });
  // The scaled panel and the pill's box agree to a fraction of a pixel: 420 * 0.2476 = 104, 360 * 0.0778 = 28.
  assert.equal(Math.round(panel.width * 0.2476), pill.width);
  assert.equal(Math.round(panel.height * 0.0778), pill.height);
});

test("the morph's corner follows the side the pill is on, so a flipped panel grows outward too", () => {
  const pill = { x: 100, y: 40, width: 90, height: 24 };
  const panel = { x: 380, y: 76, width: 300, height: 240 };
  // A panel below and to the right of its trigger shares its top-left corner, not its top-right one.
  assert.deepEqual(runStatusMorphShape({ pill, panel, reducedMotion: false }), {
    transform: "translate(-280px, -12px) scale(0.3, 0.1)",
    origin: "top left",
  });
});

test("reduced motion, or a box nobody laid out, draws no morph", () => {
  const pill = { x: 10, y: 10, width: 80, height: 24 };
  const panel = { x: 0, y: 40, width: 300, height: 300 };
  assert.equal(runStatusMorphShape({ pill, panel, reducedMotion: true }), undefined);
  assert.equal(runStatusMorphShape({ pill: undefined, panel, reducedMotion: false }), undefined);
  assert.equal(runStatusMorphShape({ pill, panel: undefined, reducedMotion: false }), undefined, "a panel measured before Web Awesome laid it out animates nothing");
  assert.equal(runStatusMorphShape({ pill, panel: { x: 0, y: 0, width: 0, height: 0 }, reducedMotion: false }), undefined);
});

test("only a real open or close morphs, and a render that keeps the panel's state draws nothing new", () => {
  assert.equal(runStatusMorphPhase(false, true, false), "opening");
  assert.equal(runStatusMorphPhase(true, false, false), "closing");
  // A streamed frame re-renders the panel while it stays open: the same state asks for no second animation.
  assert.equal(runStatusMorphPhase(true, true, false), undefined);
  assert.equal(runStatusMorphPhase(false, false, false), undefined);
  assert.equal(runStatusMorphPhase(undefined, false, false), undefined, "a panel that starts closed draws no fold");
  // A window that asked for no motion never animates, whichever way the panel changed.
  assert.equal(runStatusMorphPhase(false, true, true), undefined);
  assert.equal(runStatusMorphPhase(true, false, true), undefined);
});

test("the morph's timing reads the shell's own tokens and refuses a duration it cannot use", () => {
  assert.deepEqual(runStatusMorphTiming(" 180ms ", " cubic-bezier(0.16, 1, 0.3, 1) "), { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  assert.deepEqual(runStatusMorphTiming("0.2s", ""), { duration: 200, easing: "ease-out" });
  assert.equal(runStatusMorphTiming("0ms", "ease"), undefined, "no animation when the token says none");
  assert.equal(runStatusMorphTiming("", "ease"), undefined);
  assert.equal(runStatusMorphTiming("normal", "ease"), undefined);
  assert.equal(runStatusMorphTiming("180", "ease"), undefined, "a duration without a unit is not a duration");
});
