import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProgressCard, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import { FINISHED_BATCH_VISIBLE_MS } from "../subagent-activity.ts";
import { goalSectionStatus, goalStatusLabel, runStatus, runStatusMorphBoxes, runStatusMorphPhase, runStatusMorphTiming, runStatusPanel, runStatusPanelChosen, runStatusPanelOpen, runStatusTriggerPainted } from "./run-status.ts";

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

test("a goal names its state once: the head keeps the word, and the section repeats it only when the head says something else", () => {
  // With the goal as the only thing to report, the head is the pill's own word: the Goal section prints its title alone,
  // and the accessible name does not say the state a second time either.
  for (const status of ["active", "paused", "blocked", "complete"] as const) {
    const model = runStatus({ goal: goal(status), progress: undefined, subagents: [], streaming: false, waiting: false, now });
    assert.equal(model.label, goalStatusLabel(status), `the head carries the ${status} goal's own word`);
    assert.equal(goalSectionStatus(model, goal(status)), undefined, "the Goal section prints no second copy of that word");
    assert.equal(model.summary, `Run status: ${goalStatusLabel(status)}`, "and the name says it once");
  }

  // A head that says something else leaves the goal's state to the section, and the name carries it once.
  const paused = goal("paused");
  const running = runStatus({ goal: paused, progress, subagents: [], streaming: true, waiting: false, now });
  assert.equal(running.label, "Working");
  assert.equal(goalSectionStatus(running, paused), "Goal paused");
  assert.match(running.summary, /^Run status: Working, goal paused, 1 of 3 steps done$/u);

  const waiting = runStatus({ goal: paused, progress: undefined, subagents: [], streaming: true, waiting: true, now });
  assert.equal(waiting.label, "Waiting for your answer");
  assert.equal(goalSectionStatus(waiting, paused), "Goal paused", "an open question keeps its own word in the head");
  assert.equal(waiting.summary.match(/paused/gu)?.length, 1, "and the name names the goal's state once");

  const failed = runStatus({ goal: paused, progress: undefined, subagents: [task("a", "failed", { error: "Provider refused" })], streaming: false, waiting: false, now });
  assert.equal(failed.label, "Helper failed");
  assert.equal(goalSectionStatus(failed, paused), "Goal paused");
  assert.equal(failed.summary.match(/paused/gu)?.length, 1);

  // The section's word follows the same decision when the head names another state of the same goal: a complete goal
  // under a running turn still reads Goal achieved in its section, while an idle panel says it in the head instead.
  const complete = goal("complete");
  const completeWhileWorking = runStatus({ goal: complete, progress: undefined, subagents: [], streaming: true, waiting: false, now });
  assert.equal(completeWhileWorking.label, "Working");
  assert.equal(goalSectionStatus(completeWhileWorking, complete), goalStatusLabel("complete"));
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

test("the pill is drawn exactly while the panel is not out", () => {
  // One box: an open panel's header is the converted pill, so the trigger keeps its box as the anchor and is not painted
  // beside or above the panel. The pill returns only once a close has landed.
  assert.equal(runStatusTriggerPainted(true), false, "an open panel does not draw the pill");
  assert.equal(runStatusTriggerPainted(false), true, "the closed panel draws it again");
  // A wide window's own open hides it too, while a collapsed phone keeps the pill.
  const running = runStatusPanel(undefined, { running: true });
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen(running, { running: true, wide: true })), false);
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen(running, { running: true, wide: false })), true);
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

test("the pill and the panel share one top-right corner, so the box only grows left and down", () => {
  // The popover overlays the anchor by the pill's height, so the panel's settled top-right is the pill's: the corner
  // never travels, and neither does the right edge while the box widens.
  const pill = { x: 1100, y: 20, width: 104, height: 28 };
  const panel = { x: 784, y: 20, width: 420, height: 360 };
  const boxes = runStatusMorphBoxes({ pill, panel, pillRadius: 999, panelRadius: 14, reducedMotion: false });
  assert.deepEqual(boxes, {
    // Exactly the pill's rect and the panel's corner: the pill's own round at 28px tall.
    from: { x: 1100, y: 20, width: 104, height: 28, radius: 14 },
    // And the panel's settled rect, unchanged by the morph.
    to: { x: 784, y: 20, width: 420, height: 360, radius: 14 },
  });
  // The box's top-right corner is the trigger's, and its width is the trigger's: no scale is involved.
  assert.equal(boxes!.from.x + boxes!.from.width, pill.x + pill.width);
  assert.equal(boxes!.from.y, pill.y);
  assert.equal(boxes!.from.width, pill.width);
  assert.equal(boxes!.from.height, pill.height);
  // Both ends share the pill's top-right corner, and the end box carries the panel's own size: the corner stays put
  // while the box grows left and down into the rows it holds.
  assert.equal(boxes!.to.y, pill.y, "the settled top edge is the pill's");
  assert.equal(boxes!.to.x + boxes!.to.width, pill.x + pill.width, "and the settled right edge is the pill's");
  assert.equal(boxes!.to.width, panel.width, "while the box keeps the panel's own width");
  assert.equal(boxes!.to.height, panel.height);
});

test("the settled box is wherever the panel rests: a panel off the pill's corner is not clamped onto it", () => {
  const pill = { x: 100, y: 40, width: 90, height: 24 };
  // A panel whose right edge is four pixels left of the pill's and whose top is 36 below it: the start box is still the
  // pill's own rect, and the end box is the panel's as measured. Clamping it onto the pill would hide a placement that
  // moved the panel, which the tests that read the settled corner must catch.
  const panel = { x: 286, y: 76, width: 300, height: 240 };
  const boxes = runStatusMorphBoxes({ pill, panel, pillRadius: 20, panelRadius: 6, reducedMotion: false });
  assert.deepEqual(boxes, {
    from: { x: 100, y: 40, width: 90, height: 24, radius: 12 },
    to: { x: 286, y: 76, width: 300, height: 240, radius: 6 },
  });
  assert.notEqual(boxes!.to.x + boxes!.to.width, pill.x + pill.width, "the measured right edge is kept, not the pill's");
  assert.notEqual(boxes!.to.y, pill.y, "and so is the measured top edge");
});

test("reduced motion, or a box nobody laid out, draws no morph", () => {
  const pill = { x: 10, y: 10, width: 80, height: 24 };
  const panel = { x: 0, y: 40, width: 300, height: 300 };
  const radii = { pillRadius: 999, panelRadius: 14 };
  assert.equal(runStatusMorphBoxes({ pill, panel, ...radii, reducedMotion: true }), undefined);
  assert.equal(runStatusMorphBoxes({ pill: undefined, panel, ...radii, reducedMotion: false }), undefined);
  assert.equal(runStatusMorphBoxes({ pill, panel: undefined, ...radii, reducedMotion: false }), undefined, "a panel measured before Web Awesome laid it out animates nothing");
  assert.equal(runStatusMorphBoxes({ pill, panel: { x: 0, y: 0, width: 0, height: 0 }, ...radii, reducedMotion: false }), undefined);
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
