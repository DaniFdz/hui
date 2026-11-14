/**
 * The chat header's Run status: the compact summary of a conversation's goal,
 * its Task progress plan and the latest batch of helpers, plus the numbers the
 * trigger and its popover print. The view in `views/chat/run-status.ts` owns
 * the markup and the app owns the state behind it.
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
  if (goal) parts.push(`goal ${goal.status === "active" ? "pursuing" : goal.status}`);
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
