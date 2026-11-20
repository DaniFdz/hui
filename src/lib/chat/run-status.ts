/**
 * The chat header's Run status: the compact summary of a conversation's goal,
 * its Task progress plan and the latest batch of helpers, the numbers the
 * trigger and its popover print, and whether that popover is open. The view in
 * `views/chat/run-status.ts` owns the markup and the app owns the state behind it.
 * The popover opens only when the operator opens it: a run never opens or closes
 * it, and neither does the width of the window.
 */
import type { ProgressCard, ProgressStep, SessionGoal, SubagentTaskView } from "../../api/sessions.ts";
import type { Watcher } from "../../api/watchers.ts";
import { latestSubagentBatch, subagentVisualState } from "../subagent-activity.ts";

export type RunStatusTone = "running" | "waiting" | "paused" | "blocked" | "attention" | "done" | "idle";

export type RunStatusPlan = {
  steps: readonly ProgressStep[];
  markdown: string;
  done: number;
  total: number;
  current: ProgressStep | undefined;
  allComplete: boolean;
};

export type RunStatusWatchers = {
  total: number;
  running: number;
  failed: number;
  finished: number;
};

export type RunStatusHelpers = {
  tasks: readonly SubagentTaskView[];
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  finished: number;
  allFinished: boolean;
  allSucceeded: boolean;
};

/** Live side work, keyed by its stable active set rather than by streamed output. */
export type RunStatusActivity = { count: number; signature: string };

export type RunStatusModel = {
  /** Nothing to report: draw no trigger at all. */
  visible: boolean;
  tone: RunStatusTone;
  /** The trigger's word and the popover's state. */
  label: string;
  /** The compact trailing count on the trigger, `1/2`; absent when there is no plan or batch. */
  count: string | undefined;
  goal: SessionGoal | undefined;
  plan: RunStatusPlan | undefined;
  helpers: RunStatusHelpers | undefined;
  watchers: RunStatusWatchers | undefined;
  activity: RunStatusActivity;
  /** Blocks, failures and an unanswered question: the trigger carries a warn/danger mark. */
  attention: boolean;
  /** What the trigger is announced as, including the parts its visible word leaves out. */
  summary: string;
};

export function goalStatusLabel(status: SessionGoal["status"]): string {
  return { active: "Pursuing goal", paused: "Goal paused", blocked: "Goal blocked", complete: "Goal achieved" }[status];
}

/**
 * The state word the Goal section prints beside its title, or nothing when the panel's head already says it: one state
 * word per box. The head keeps the pill's word in every tone, because a collapsed pill is the only surface for it, so a
 * goal alone in the panel names its state there and the section reads just "Goal"; the section carries the word only
 * while the head says something else — Working, Waiting for your answer, Helper failed or Watcher failed.
 */
export function goalSectionStatus(model: Pick<RunStatusModel, "label">, goal: SessionGoal): string | undefined {
  const status = goalStatusLabel(goal.status);
  return status === model.label ? undefined : status;
}

/**
 * Whether the Run status popover is out, which is exactly what the operator last chose: the panel opens only on their
 * own press and closes only on their own close (the chevron, Escape, an outside click, or the phone header's
 * session-list control). A run never opens or closes it — not the first one, not one the conversation starts on its own
 * when a watcher settles or a helper finishes, and not a render or a window width either — so an open holds across runs
 * until they close it, and a close holds until they open it again. A reload starts closed.
 */
export type RunStatusPanelState = { open: boolean };

/** Whether the popover is open: the operator's own last choice, and nothing else. */
export function runStatusPanelOpen(state: RunStatusPanelState): boolean {
  return state.open;
}

/**
 * Whether the pill is painted, which is exactly while the panel is not out. An open panel's title line carries the pill's
 * mark, word and count — with the chevron that now closes at the box's right edge — so the trigger keeps its box only as
 * the popover's anchor and as the aria-expanded state the close returns with, and the two boxes never show together.
 */
export function runStatusTriggerPainted(open: boolean): boolean {
  return !open;
}

/** Records the operator's own open or close: the state's only writer. */
export function runStatusPanelChosen(open: boolean): RunStatusPanelState {
  return { open };
}

/** A box the morph reads once: the trigger's or the panel's, in viewport pixels. */
export type RunStatusMorphRect = { x: number; y: number; width: number; height: number };

/**
 * One end of the morph: the panel's own box, in viewport pixels, with the corner it draws. The morph animates these
 * three properties on the panel itself, so it never scales the card or the copy inside it, and the corner the box ends on
 * is the one it started from.
 */
export type RunStatusMorphBox = { x: number; y: number; width: number; height: number; radius: number };

/** Which way the panel is morphing: growing out of the pill, or folding back into it. */
export type RunStatusMorphPhase = "opening" | "closing";

/** The morph a panel change asks for, or nothing. Only a real open or close animates: a render that keeps the panel's
 * state draws no second animation, and neither does a window that asked for reduced motion. */
export function runStatusMorphPhase(previous: boolean | undefined, next: boolean, reducedMotion: boolean): RunStatusMorphPhase | undefined {
  if (reducedMotion) return undefined;
  if (next) return previous === true ? undefined : "opening";
  return previous === true ? "closing" : undefined;
}

/** Rounded, so a subpixel box cannot print a width of thirty digits. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A radius no taller than the box it rounds: the trigger's `999px` is the pill's 14px at 28px tall. */
function corner(value: number, height: number): number {
  const radius = Number.isFinite(value) && value > 0 ? value : 0;
  return round(Math.min(radius, height / 2), 2);
}

/**
 * The morph's two ends: the trigger's own box — so the first frame is the pill, not a picture of it — and the panel's
 * settled box at the actions group's top-right. The top stays pinned while the right edge travels from the leftmost
 * trigger to the group's fixed right edge. Both are measured viewport boxes: no transform, scale or clamping can hide
 * a placement error from the tests that read the settled box.
 */
export function runStatusMorphBoxes(input: {
  pill: RunStatusMorphRect | undefined;
  panel: RunStatusMorphRect | undefined;
  pillRadius: number;
  panelRadius: number;
  reducedMotion: boolean;
}): { from: RunStatusMorphBox; to: RunStatusMorphBox } | undefined {
  const { pill, panel } = input;
  if (input.reducedMotion || !pill || !panel) return undefined;
  if (!(pill.width > 0 && pill.height > 0 && panel.width > 0 && panel.height > 0)) return undefined;
  return {
    from: {
      x: round(pill.x, 2),
      y: round(pill.y, 2),
      width: round(pill.width, 2),
      height: round(pill.height, 2),
      radius: corner(input.pillRadius, pill.height),
    },
    to: {
      x: round(panel.x, 2),
      y: round(panel.y, 2),
      width: round(panel.width, 2),
      height: round(panel.height, 2),
      radius: corner(input.panelRadius, panel.height),
    },
  };
}

/** The morph's timing from the shell's own tokens, so CSS and the animation cannot drift; an unreadable duration means
 * no morph rather than an animation with a guessed length. */
export function runStatusMorphTiming(duration: string, easing: string): { duration: number; easing: string } | undefined {
  const raw = duration.trim().toLowerCase();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const ms = raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : Number.NaN;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return { duration: ms, easing: easing.trim() || "ease-out" };
}

/** How much of the morph's own duration the head's copy takes to fade in once the box has arrived. */
const HEAD_COPY_ARRIVAL_SHARE = 0.7;

/**
 * When the panel head's copy is painted during a morph: a delay before its fade, and how long that fade lasts. The head is
 * the panel's own title, left-aligned at the card's padding, and left-aligned copy inside a box that grows to the left
 * travels with the box's left edge — a glide a title must not have. So an open holds the copy for the whole growth, the
 * close chevron (already at the box's right edge) carrying the first frame, and fades it in when the box has arrived,
 * where its x no longer moves; a close hides it with the fold's first frame, before the box starts moving back.
 */
export function runStatusHeadCopyTiming(timing: { duration: number }, phase: RunStatusMorphPhase): { delay: number; duration: number } {
  if (phase === "closing") return { delay: 0, duration: 1 };
  return { delay: timing.duration, duration: Math.max(1, Math.round(timing.duration * HEAD_COPY_ARRIVAL_SHARE)) };
}

/** The current step: the one in progress, else the first still to do, else the last one. */
function currentStep(steps: readonly ProgressStep[]): ProgressStep | undefined {
  return steps.find((step) => step.status === "in_progress")
    ?? steps.find((step) => step.status === "pending")
    ?? steps.at(-1);
}

/** The latest batch of helpers, counted the way the old Parallel tasks card counted it: a cancelled or timed-out
 * helper is in the failed-or-stopped bucket, and only a completed one counts as done. */
function helperSummary(tasks: readonly SubagentTaskView[]): RunStatusHelpers | undefined {
  if (tasks.length === 0) return undefined;
  const states = tasks.map((task) => subagentVisualState(task.status));
  const running = states.filter((state) => state === "running").length;
  const queued = states.filter((state) => state === "queued").length;
  const completed = states.filter((state) => state === "completed").length;
  const finished = completed + states.filter((state) => state === "failed" || state === "cancelled").length;
  return {
    tasks,
    total: tasks.length,
    running,
    queued,
    completed,
    failed: finished - completed,
    finished,
    allFinished: running + queued === 0,
    allSucceeded: completed === tasks.length,
  };
}

function planSummary(progress: ProgressCard | undefined): RunStatusPlan | undefined {
  if (!progress) return undefined;
  const steps = progress.steps;
  const done = steps.filter((step) => step.status === "completed").length;
  return {
    steps,
    markdown: progress.markdown,
    done,
    total: steps.length,
    current: currentStep(steps),
    allComplete: steps.length > 0 && done === steps.length,
  };
}

/**
 * What the Run status trigger says and which sections its popover has. The most urgent state wins: an open question,
 * a blocked goal, a running turn, a failed helper, a paused goal, a finished job. `now` is injectable for the batch
 * retention window.
 */
export function runStatus(options: {
  goal: SessionGoal | undefined;
  progress: ProgressCard | undefined;
  subagents: readonly SubagentTaskView[];
  /** HUI-run background watchers; a settled one writes its own transcript event and stays here until dismissed. */
  watchers?: readonly Watcher[];
  streaming: boolean;
  /** HUI is waiting for the operator's answer to a question or a secret. */
  waiting: boolean;
  now?: number;
}): RunStatusModel {
  const goal = options.goal;
  const plan = planSummary(options.progress);
  const helpers = helperSummary(latestSubagentBatch(options.subagents, options.now ?? Date.now()));
  const watchers = options.watchers?.length
    ? {
      total: options.watchers.length,
      running: options.watchers.filter((watcher) => watcher.state === "running").length,
      failed: options.watchers.filter((watcher) => watcher.state === "failed" || watcher.state === "dead").length,
      finished: options.watchers.filter((watcher) => watcher.state !== "running").length,
    } satisfies RunStatusWatchers
    : undefined;
  const activeIds = [
    ...options.subagents.filter((task) => ["running", "queued"].includes(subagentVisualState(task.status))).map((task) => `helper:${task.taskId}`),
    ...(options.watchers ?? []).filter((watcher) => watcher.state === "running").map((watcher) => `watcher:${watcher.id}`),
  ].sort();
  const activity: RunStatusActivity = { count: activeIds.length, signature: activeIds.join("|") };
  const visible = Boolean(goal || plan || helpers || watchers);
  const attention = Boolean(goal?.status === "blocked" || helpers?.failed || watchers?.failed || options.waiting);

  let tone: RunStatusTone = "idle";
  let label = "Status";
  if (options.waiting) {
    tone = "waiting";
    label = "Waiting for your answer";
  } else if (goal?.status === "blocked") {
    tone = "blocked";
    label = "Goal blocked";
  } else if (options.streaming || (helpers && !helpers.allFinished) || watchers?.running) {
    tone = "running";
    label = "Working";
  } else if (watchers?.failed) {
    tone = "attention";
    label = "Watcher failed";
  } else if (helpers?.failed) {
    tone = "attention";
    label = "Helper failed";
  } else if (goal?.status === "paused") {
    tone = "paused";
    label = goalStatusLabel("paused");
  } else if (goal?.status === "complete") {
    tone = "done";
    label = goalStatusLabel("complete");
  } else if (goal?.status === "active") {
    label = goalStatusLabel("active");
  } else if (plan?.allComplete || helpers?.allSucceeded) {
    tone = "done";
    label = "Done";
  }

  const count = plan?.total
    ? `${plan.done}/${plan.total}`
    : helpers
      ? `${helpers.allFinished ? helpers.completed : helpers.finished}/${helpers.total}`
      : watchers
        ? `${watchers.running ? watchers.running : watchers.finished}/${watchers.total}`
        : undefined;

  const parts = [label];
  // The name says the goal's state once too: a head that already is the goal's state does not repeat it.
  if (goal && goalSectionStatus({ label }, goal)) parts.push(`goal ${goal.status === "active" ? "pursuing" : goal.status}`);
  if (plan?.total) parts.push(`${plan.done} of ${plan.total} steps done`);
  if (plan && activity.count > 0) parts.push(`${activity.count} side ${activity.count === 1 ? "task" : "tasks"} active`);
  if (helpers) {
    parts.push(helpers.allFinished
      ? `${helpers.completed} of ${helpers.total} helpers completed`
      : `${helpers.running + helpers.queued} of ${helpers.total} helpers active`);
  }
  if (watchers) {
    parts.push(watchers.running
      ? `${watchers.running} of ${watchers.total} watchers running`
      : `${watchers.total} ${watchers.total === 1 ? "watcher" : "watchers"}`);
  }
  return {
    visible,
    tone,
    label,
    count,
    goal,
    plan,
    helpers,
    watchers,
    activity,
    attention,
    summary: `Run status: ${parts.join(", ")}`,
  };
}
