/**
 * The chat header's Run status: the compact trigger and the popover that holds a
 * conversation's goal (with its controls and editor), its Task progress plan, the
 * latest batch of helpers and its background watchers. The popover is HUI's only
 * home for those four surfaces; the trigger stays out of the transcript so a
 * phone keeps the whole conversation.
 */
import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import type { SessionGoal, SessionView, SubagentTaskView } from "../../api/sessions.ts";
import { mountEditorAtEnd } from "../../lib/composer/textarea.ts";
import { goalStatusLabel, runStatus, type RunStatusModel, type RunStatusTone } from "../../lib/chat/run-status.ts";
import { renderMarkdown } from "../../lib/markdown/markdown.ts";
import { relativeTime } from "../../lib/message-metadata.ts";
import { subagentElapsed, subagentVisualState, type SubagentVisualState } from "../../lib/subagent-activity.ts";
import { icons } from "../../lib/icons.ts";
import { renderWatcherRows, type WatcherActivityProps } from "./watcher-activity.ts";

/** The goal editor's transient state: whether the objective is being retyped and why a save was refused. */
export type GoalPanelState = { editing: boolean; error: string };

export type RunStatusProps = {
  /** Unique per pane; names the trigger and the popover it anchors. */
  id: string;
  session: SessionView;
  subagents: readonly SubagentTaskView[];
  /** Background watchers, when this conversation has any. */
  watchers?: WatcherActivityProps;
  /** The conversation is still opening/starting: nothing live to report yet. */
  loading: boolean;
  streaming: boolean;
  /** A question or secret request is waiting for the operator. */
  waiting: boolean;
  sending: boolean;
  connectionLive: boolean;
  goalPanel: GoalPanelState;
  /** "Collapse task progress": the plan starts folded inside the popover. */
  collapsePlan: boolean;
  onGoalChange: (kind: "pause" | "resume" | "clear") => void;
  onGoalEdit: () => void;
  onGoalSave: (objective: string) => void;
  onGoalCancelEdit: () => void;
  onSelectSubagent: (sessionId: string) => void;
};

const goalPauseIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5v14M14.5 5v14" /></svg>`;
const goalTargetIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /></svg>`;
const orbitIcon = html`<span class="hui-orbit" aria-hidden="true"><i></i><i></i><i></i></span>`;

/** The trigger's mark and the popover header's, one per Run status tone. */
function renderRunStatusMark(tone: RunStatusTone): TemplateResult {
  if (tone === "running") return html`<span class="session-run-spinner" aria-hidden="true"></span>`;
  if (tone === "paused") return goalPauseIcon;
  if (tone === "blocked" || tone === "attention") return icons.alertTriangle;
  if (tone === "waiting") return icons.messageSquare;
  if (tone === "done") return icons.check;
  return goalTargetIcon;
}

function subagentSnippet(task: SubagentTaskView): string {
  if (task.status === "queued") return "Waiting for a free slot…";
  if (task.status === "starting") return "Starting…";
  if (task.status === "running") return task.summary?.trim() || "Running…";
  if (task.status === "completed") return task.summary?.trim() || "Completed";
  if (task.status === "cancelled") return task.error?.trim() || "Cancelled";
  if (task.status === "timed_out") return task.error?.trim() || "Timed out";
  if (task.status === "interrupted") return task.error?.trim() || "Interrupted";
  return task.error?.trim() || "Failed";
}

function renderSubagentStatusIcon(status: string) {
  const state = subagentVisualState(status);
  if (state === "running") return orbitIcon;
  if (state === "completed") return html`<span class="hui-subagent-status hui-subagent-status--completed">${icons.check}</span>`;
  if (state === "queued") return html`<span class="hui-subagent-status hui-subagent-status--queued">${icons.circle}</span>`;
  if (state === "cancelled") return html`<span class="hui-subagent-status hui-subagent-status--cancelled">${icons.circleX}</span>`;
  return html`<span class="hui-subagent-status hui-subagent-status--failed">${icons.alertTriangle}</span>`;
}

/** What a helper's row says under its name: the parent's latest summary, or why it stopped. */
function helperRow(props: RunStatusProps, task: SubagentTaskView) {
  const snippet = subagentSnippet(task).replace(/\s+/g, " ");
  const elapsed = task.status === "queued" ? undefined : subagentElapsed(task);
  return html`<button
    type="button"
    class="chat-run-status__helper chat-run-status__helper--${subagentVisualState(task.status)}"
    data-subagent-task-id=${task.taskId}
    data-subagent-session-id=${task.sessionId}
    aria-label=${`Open subagent ${task.title}${elapsed ? `, ${elapsed}` : ""}`}
    @click=${(event: Event) => {
      ((event.currentTarget as Element).closest("wa-popover") as (Element & { hide?: () => void }) | null)?.hide?.();
      props.onSelectSubagent(task.sessionId);
    }}
  >
    <span class="chat-run-status__helper-icon">${renderSubagentStatusIcon(task.status)}</span>
    <span class="chat-run-status__helper-copy">
      <span class="chat-run-status__helper-title">${task.title}</span>
      <span class="chat-run-status__helper-snippet">${snippet}</span>
    </span>
    ${elapsed ? html`<span class="chat-run-status__helper-time">${elapsed}</span>` : nothing}
  </button>`;
}

function helperMark(task: SubagentTaskView): TemplateResult {
  const state: SubagentVisualState = subagentVisualState(task.status);
  return html`<span class="chat-run-status__marker" data-state=${state} aria-hidden="true"></span>`;
}

function renderHelpers(props: RunStatusProps, model: RunStatusModel, id: string) {
  const helpers = model.helpers;
  if (!helpers) return nothing;
  const counts = helpers.allFinished
    ? `${helpers.completed} completed · ${helpers.failed} failed or stopped`
    : `${helpers.running} running · ${helpers.queued} queued · ${helpers.failed} failed or stopped`;
  const outcome = helpers.allFinished
    ? props.streaming
      ? "Child runs finished. The parent is processing their results."
      : "Child runs finished. Check the conversation for the final response."
    : undefined;
  const rows = html`<div class="chat-run-status__helpers-list">${helpers.tasks.map((task) => helperRow(props, task))}</div>${outcome ? html`<p class="chat-run-status__outcome">${outcome}</p>` : nothing}`;
  // A big batch folds its per-child rows behind one disclosure; the counts and dots stay visible above it.
  const children = helpers.tasks.length > 6
    ? html`<details class="chat-run-status__children"><summary>Child details<span class="chat-run-status__meta">${helpers.tasks.length}</span><span class="chat-run-status__chevron" aria-hidden="true">${icons.chevronDown}</span></summary>${rows}</details>`
    : rows;
  // A wholly successful batch is history, so it starts folded.
  if (helpers.allSucceeded) {
    return html`<section class="chat-run-status__section" aria-labelledby=${`${id}-helpers-title`}>
      <details class="chat-run-status__success">
        <summary class="chat-run-status__section-head">
          <span class="chat-run-status__success-mark" aria-hidden="true">${icons.check}</span>
          <span class="chat-run-status__section-title" id=${`${id}-helpers-title`}>Helpers</span>
          <span class="chat-run-status__meta">${helpers.completed} completed</span>
          <span class="chat-run-status__chevron" aria-hidden="true">${icons.chevronDown}</span>
        </summary>
        ${rows}
      </details>
    </section>`;
  }
  return html`<section class="chat-run-status__section" aria-labelledby=${`${id}-helpers-title`}>
    <div class="chat-run-status__section-head">
      <span class="chat-run-status__section-title" id=${`${id}-helpers-title`}>Helpers</span>
      <span class="chat-run-status__meta">${helpers.finished} of ${helpers.total}</span>
    </div>
    <div class="chat-run-status__markers" aria-hidden="true">${helpers.tasks.map(helperMark)}</div>
    <p class="chat-run-status__counts">${counts}</p>
    ${children}
  </section>`;
}

function renderPlan(props: RunStatusProps, model: RunStatusModel, id: string) {
  const plan = model.plan;
  if (!plan) return nothing;
  const folded = props.collapsePlan || plan.allComplete;
  const body = html`
    ${plan.steps.length > 0 ? html`<div class="chat-run-status__steps-region" role="region" aria-label="Task progress steps" data-testid="task-progress-steps"><ol class="chat-run-status__steps">${plan.steps.map((step) => html`<li class="chat-run-status__step" data-status=${step.status} data-testid="task-progress-step">
      <span class="chat-run-status__step-mark" aria-hidden="true">${step.status === "completed" ? icons.check : step.status === "in_progress" ? html`<span class="session-run-spinner"></span>` : icons.circle}</span>
      <span>${step.step}</span>
    </li>`)}</ol></div>` : nothing}
    ${plan.markdown ? html`<div class="chat-run-status__plan-note">${renderMarkdown(plan.markdown)}</div>` : nothing}`;
  // A plan with no steps is a summary only: there is nothing for a fold to hide.
  if (plan.steps.length === 0) {
    return html`<section class="chat-run-status__section" aria-label="Task progress">
      <div class="chat-run-status__section-head"><span class="chat-run-status__section-title">Plan</span></div>
      ${body}
    </section>`;
  }
  return html`<section class="chat-run-status__section" aria-labelledby=${`${id}-plan-title`}>
    <details class="chat-run-status__plan" data-testid="task-progress" aria-label="Task progress" ?open=${!folded}>
      <summary class="chat-run-status__section-head chat-run-status__plan-summary">
        <span class="chat-run-status__section-title" id=${`${id}-plan-title`}>Plan</span>
        ${plan.current ? html`<span class="chat-run-status__plan-current">${plan.current.step}</span>` : nothing}
        <span class="chat-run-status__meta">${plan.done} of ${plan.total}</span>
        <span class="chat-run-status__chevron" aria-hidden="true">${icons.chevronDown}</span>
      </summary>
      ${body}
    </details>
  </section>`;
}

function renderGoalActions(props: RunStatusProps, goal: SessionGoal) {
  if (props.goalPanel.editing) {
    const editable = !props.sending && props.connectionLive && !props.streaming && props.session.status === "idle";
    return html`<form class="goal-edit" @submit=${(event: Event) => {
      event.preventDefault();
      const field = (event.currentTarget as HTMLFormElement).elements.namedItem("objective");
      if (field instanceof HTMLTextAreaElement) props.onGoalSave(field.value);
    }}>
      <textarea name="objective" rows="3" aria-label="Goal objective" spellcheck="true"
        ${ref((element) => mountEditorAtEnd(element, goal.objective))}></textarea>
      ${props.goalPanel.error ? html`<p class="goal-edit__error" role="alert">${props.goalPanel.error}</p>` : nothing}
      <p class="goal-edit__hint">${editable
        ? "Saving starts the goal again with this objective and sends it as the next turn."
        : "Finish or stop the active turn before changing the objective."}</p>
      <div class="goal-edit__actions">
        <button type="submit" class="btn btn--sm primary" ?disabled=${!editable}>Save goal</button>
        <button type="button" class="btn btn--sm" @click=${props.onGoalCancelEdit}>Cancel</button>
      </div>
    </form>`;
  }
  const editable = !props.sending && props.connectionLive && !props.streaming && props.session.status === "idle";
  return html`<div class="chat-run-status__actions">
    ${goal.status === "active"
      ? html`<button type="button" class="btn btn--sm primary" aria-label="Pause goal" ?disabled=${props.sending} @click=${() => props.onGoalChange("pause")}>Pause</button>`
      : goal.status === "complete"
        ? nothing
        : html`<button type="button" class="btn btn--sm primary" aria-label="Resume goal" ?disabled=${props.sending} @click=${() => props.onGoalChange("resume")}>Resume</button>`}
    <button type="button" class="btn btn--sm" aria-label="Edit goal objective" title="Edit goal objective"
      ?disabled=${!editable} @click=${props.onGoalEdit}>Edit</button>
    <button type="button" class="btn btn--sm" aria-label="Clear goal" title="Clear goal"
      ?disabled=${props.sending} @click=${() => props.onGoalChange("clear")}>Clear</button>
  </div>`;
}

function renderWatchers(props: RunStatusProps) {
  const watchers = props.watchers;
  if (!watchers || watchers.watchers.length === 0) return nothing;
  const running = watchers.watchers.filter((watcher) => watcher.state === "running").length;
  const meta = running ? `${running} running` : `${watchers.watchers.length} watcher${watchers.watchers.length === 1 ? "" : "s"}`;
  const rows = html`<div class="chat-run-status__watchers">${renderWatcherRows(watchers)}</div>`;
  // Keep a long watcher list from pushing everything below it; a few stay open as rows.
  const list = watchers.watchers.length > 4
    ? html`<details class="chat-run-status__watchers-details"><summary>Watcher details<span class="chat-run-status__meta">${watchers.watchers.length}</span><span class="chat-run-status__chevron" aria-hidden="true">${icons.chevronDown}</span></summary>${rows}</details>`
    : rows;
  return html`<section class="chat-run-status__section" aria-label="Background watchers">
    <div class="chat-run-status__section-head">
      <span class="chat-run-status__section-title">Watchers</span>
      <span class="chat-run-status__meta">${meta}</span>
    </div>
    ${list}
  </section>`;
}

function renderGoal(props: RunStatusProps, model: RunStatusModel, id: string) {
  const goal = model.goal;
  if (!goal) return nothing;
  const continuations = goal.continuations === 1 ? "1 automatic turn" : `${goal.continuations} automatic turns`;
  return html`<section class="chat-run-status__section" aria-labelledby=${`${id}-goal-title`}>
    <div class="chat-run-status__section-head">
      <span class="chat-run-status__section-title" id=${`${id}-goal-title`}>Goal</span>
      <span class="chat-run-status__meta" data-status=${goal.status}>${goalStatusLabel(goal.status)}</span>
    </div>
    <p class="chat-run-status__objective">${goal.objective}</p>
    ${goal.note ? html`<p class="chat-run-status__note">${goal.note}</p>` : nothing}
    <p class="chat-run-status__set">Set ${relativeTime(Date.parse(goal.createdAt))}${goal.continuations > 0 ? ` · ${continuations}` : ""}</p>
    ${renderGoalActions(props, goal)}
  </section>`;
}

/** The Run status trigger and its popover, or nothing when this conversation has no goal, plan or recent batch. */
export function renderRunStatus(props: RunStatusProps) {
  if (props.loading) return nothing;
  const model = runStatus({
    goal: props.session.goal,
    progress: props.session.progress,
    subagents: props.subagents,
    ...(props.watchers ? { watchers: props.watchers.watchers } : {}),
    streaming: props.streaming,
    waiting: props.waiting,
  });
  if (!model.visible) return nothing;
  const triggerId = `${props.id}-trigger`;
  const panelId = `${props.id}-panel`;
  const setExpanded = (event: Event, open: boolean) =>
    (event.currentTarget as Element).previousElementSibling?.setAttribute("aria-expanded", String(open));
  return html`
    <button
      id=${triggerId}
      type="button"
      class="chat-run-status__trigger"
      data-tone=${model.tone}
      data-testid="run-status-trigger"
      aria-label=${model.summary}
      aria-haspopup="dialog"
      aria-expanded="false"
    >
      <span class="chat-run-status__mark" aria-hidden="true">${renderRunStatusMark(model.tone)}</span>
      <span class="chat-run-status__label">${model.label}</span>
      ${model.count ? html`<span class="chat-run-status__count">${model.count}</span>` : nothing}
      <span class="chat-run-status__trigger-chevron" aria-hidden="true">${icons.chevronDown}</span>
    </button>
    <wa-popover
      class="chat-run-status__popover"
      for=${triggerId}
      placement="bottom-end"
      distance="6"
      without-arrow
      @wa-show=${(event: Event) => setExpanded(event, true)}
      @wa-hide=${(event: Event) => setExpanded(event, false)}
    >
      <div class="chat-run-status__panel" id=${panelId} data-testid="run-status" role="dialog" aria-label="Run status">
        <header class="chat-run-status__head">
          <strong>Run status</strong>
          <span class="chat-run-status__state" data-tone=${model.tone}>
            <span class="chat-run-status__state-mark" aria-hidden="true">${renderRunStatusMark(model.tone)}</span>${model.label}
          </span>
        </header>
        ${renderGoal(props, model, panelId)}
        ${renderPlan(props, model, panelId)}
        ${renderHelpers(props, model, panelId)}
        ${renderWatchers(props)}
      </div>
    </wa-popover>`;
}
