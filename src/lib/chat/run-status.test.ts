import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProgressCard, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import { FINISHED_BATCH_VISIBLE_MS } from "../subagent-activity.ts";
import { goalSectionStatus, goalStatusLabel, runStatus, runStatusHeadCopyTiming, runStatusMorphBoxes, runStatusMorphPhase, runStatusMorphTiming, runStatusPanelChosen, runStatusPanelOpen, runStatusTriggerPainted, type RunStatusPanelState } from "./run-status.ts";

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

test("a new conversation draws the pill with its panel closed", () => {
  // A fresh conversation is drawn closed, a run in flight included: nothing opens the panel on its own.
  const fresh: RunStatusPanelState = { open: false };
  assert.equal(runStatusPanelOpen(fresh), false, "a new conversation starts with its panel closed");
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen(fresh)), true, "so the pill is the only box drawn");
});

test("a run leaves the Run status popover closed and the operator's open holds until they close it", () => {
  // The state is the one boolean the operator owns, and the getter reads nothing else: no run edge, no window width and no
  // render can decide the answer behind their back.
  assert.equal(runStatusPanelOpen.length, 1, "the open state is read from the operator's state alone");
  assert.equal(runStatusPanelOpen({ open: false }), false, "a run leaves the panel closed");

  const opened = runStatusPanelChosen({ open: false }, true);
  assert.deepEqual(opened, { open: true }, "the operator's open is the whole state");
  assert.equal(runStatusPanelOpen(opened), true);
  // Nothing else writes it, so an open outlives every frame that follows: a streamed render, the end of the run it was
  // opened in, and a run the conversation starts on its own (a watcher settling, a helper finishing) all leave it alone.
  assert.equal(runStatusPanelOpen(opened), true, "a later render still reads the operator's open");
  assert.equal(runStatusPanelOpen(opened), true, "and the run boundary after it writes nothing");

  const closed = runStatusPanelChosen(opened, false);
  assert.deepEqual(closed, { open: false }, "the operator's close is the whole state");
  assert.equal(runStatusPanelOpen(closed), false, "and it holds past that run's end and the next run too");

  // An open after a close works again: the panel is theirs to take back whenever they want it, mid-run or idle.
  const reopened = runStatusPanelChosen(closed, true);
  assert.deepEqual(reopened, { open: true });
  assert.equal(runStatusPanelOpen(reopened), true, "an open after a close puts the panel back");
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen(reopened)), false, "and the panel is the only box drawn");
});

test("the pill is drawn exactly while the panel is not out", () => {
  // One box: an open panel's title line carries the pill's copy, so the trigger keeps its box as the anchor and is not
  // painted beside or above the panel. The pill returns only once a close has landed.
  assert.equal(runStatusTriggerPainted(true), false, "an open panel does not draw the pill");
  assert.equal(runStatusTriggerPainted(false), true, "the closed panel draws it again");
  // The trigger's paint and the panel's open are one decision, whichever way the operator left it.
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen({ open: true })), false);
  assert.equal(runStatusTriggerPainted(runStatusPanelOpen({ open: false })), true);
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

test("the head's copy is held across the growth and written once the box has arrived, so it never travels", () => {
  // The head is the panel's title, left-aligned at the card's padding: inside a box that grows to the left, copy painted
  // during the growth would glide with the box's left edge. It waits out the whole growth, then fades in on the box that
  // has arrived — where its x stays still in every frame it is painted.
  assert.deepEqual(runStatusHeadCopyTiming({ duration: 180 }, "opening"), { delay: 180, duration: 126 });
  assert.deepEqual(runStatusHeadCopyTiming({ duration: 400 }, "opening"), { delay: 400, duration: 280 }, "the hold is the shape's own duration");
  assert.equal(runStatusHeadCopyTiming({ duration: 0 }, "opening").duration, 1, "a fade no shorter than a frame");
  // A close is the mirror: the copy goes with the fold's first frame, before the box starts moving back.
  assert.deepEqual(runStatusHeadCopyTiming({ duration: 180 }, "closing"), { delay: 0, duration: 1 });
});

test("the morph's timing reads the shell's own tokens and refuses a duration it cannot use", () => {
  assert.deepEqual(runStatusMorphTiming(" 180ms ", " cubic-bezier(0.16, 1, 0.3, 1) "), { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  assert.deepEqual(runStatusMorphTiming("0.2s", ""), { duration: 200, easing: "ease-out" });
  assert.equal(runStatusMorphTiming("0ms", "ease"), undefined, "no animation when the token says none");
  assert.equal(runStatusMorphTiming("", "ease"), undefined);
  assert.equal(runStatusMorphTiming("normal", "ease"), undefined);
  assert.equal(runStatusMorphTiming("180", "ease"), undefined, "a duration without a unit is not a duration");
});
