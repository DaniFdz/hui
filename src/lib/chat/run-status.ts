/**
 * The chat header's Run status: the compact summary of a conversation's goal,
 * its Task progress plan and the latest batch of helpers, the numbers the
 * trigger and its popover print, and whether that popover is open. The view in
 * `views/chat/run-status.ts` owns the markup and the app owns the state behind it.
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
 * The Run status popover across renders. On a wide window it opens by itself while a run streams; the operator's own
 * open or close is a `choice` that belongs to them: an open holds until they close the panel, because a run the
 * conversation starts on its own (a watcher settling, a helper finishing) must not shut the panel they are reading,
 * while a close answers the run it was made in and is cleared by the next one. A reload starts from the default too, so
 * it never reopens a panel the operator closed.
 */
export type RunStatusPanelState = { running: boolean; choice: boolean | undefined };

/** The state after a render, with the operator's open kept and their close cleared when the next run starts. */
export function runStatusPanel(previous: RunStatusPanelState | undefined, input: { running: boolean }): RunStatusPanelState {
  if (!previous) return { running: input.running, choice: undefined };
  const started = input.running && !previous.running;
  return { running: input.running, choice: started && previous.choice === false ? undefined : previous.choice };
}

/** Whether the popover is open: the operator's choice wins, else a wide window opens it while a run streams. */
export function runStatusPanelOpen(state: RunStatusPanelState, input: { running: boolean; wide: boolean }): boolean {
  return state.choice ?? (input.wide && input.running);
}

/**
 * Whether the pill is painted, which is exactly while the panel is not out. An open panel's header holds the pill's slot
 * — its mark, word, count and the chevron that now closes — so the trigger keeps its box only as the popover's anchor and
 * as the aria-expanded state the close returns with, and the two boxes never show together.
 */
export function runStatusTriggerPainted(open: boolean): boolean {
  return !open;
}

/** Records the operator's own open or close. */
export function runStatusPanelChosen(state: RunStatusPanelState, open: boolean): RunStatusPanelState {
  return { running: state.running, choice: open };
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
 * settled box. Both are the panel's own box in viewport pixels, and the panel settles on the pill's top-right corner, so
 * the top and right edges do not travel: the box only grows left and down into the content it holds. Nothing here is a
 * transform or a scale, and nothing is clamped: a placement that moved the panel would make the two corners disagree,
 * which the tests that read the settled box must fail on.
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
    attention,
    summary: `Run status: ${parts.join(", ")}`,
  };
}
