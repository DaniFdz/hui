/**
 * The chat header's Run status: the compact trigger and the popover that holds a
 * conversation's goal (with its controls and editor), its Task progress plan, the
 * latest batch of helpers and its background watchers. The popover is HUI's only
 * home for those four surfaces; the trigger stays out of the transcript so a
 * phone keeps the whole conversation. The pill morphs into the panel and back:
 * the panel grows out of the pill's box on open and a copy of it folds back into
 * that box on close, while the pill's own word carries the state until the head's
 * copy is legible.
 */
import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import type { SessionGoal, SessionView, SubagentTaskView } from "../../api/sessions.ts";
import { mountEditorAtEnd } from "../../lib/composer/textarea.ts";
import {
  goalStatusLabel,
  runStatus,
  runStatusMorphPhase,
  runStatusMorphShape,
  runStatusMorphTiming,
  runStatusPanel,
  runStatusPanelChosen,
  runStatusPanelOpen,
  type RunStatusModel,
  type RunStatusMorphRect,
  type RunStatusPanelState,
  type RunStatusTone,
} from "../../lib/chat/run-status.ts";
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
  /** A wide window, where the popover opens by itself while a run streams; a phone keeps it collapsed. */
  wide: boolean;
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

/** A `wa-popover` as this view drives it: `open` is the real state and updateComplete settles its first update. */
type RunStatusPopover = HTMLElement & {
  open: boolean;
  updateComplete: Promise<unknown>;
  hide: () => Promise<void> | void;
};

/** One popover's panel state, kept by element so a streamed frame never loses the operator's choice. */
type RunStatusPopoverState = {
  panel: RunStatusPanelState;
  wide: boolean;
  /** The open value HUI set itself, until its own wa-show or wa-hide arrives. */
  expect: boolean | undefined;
  /** Where focus was before HUI opened the popover by itself, until that open can give it back. */
  focus: HTMLElement | undefined;
  /** Web Awesome has completed its first update, so setting open now fires wa-show and wa-hide. */
  ready: boolean;
  /** The panel is drawn: the last open state its own wa-show or wa-hide reported. */
  shown: boolean | undefined;
  /** The morph drawing the panel out of the pill, or folding a copy of it back. */
  morph: RunStatusMorph | undefined;
  /** The open whose first frame waits for Web Awesome's own show to settle. */
  grow: RunStatusGrow | undefined;
};

/** What one morph owns while it runs: the animations drawing it, and the elements only it touches. */
type RunStatusMorph = {
  animations: readonly Animation[];
  /** The real panel, kept unpainted until its first frame is in place. */
  panel?: HTMLElement;
  /** The copy carrying the panel's picture through a close. */
  ghost?: HTMLElement;
};

/** An open waiting for Web Awesome's own show to finish, so the panel can be measured at its final size. */
type RunStatusGrow = {
  panel: HTMLElement;
  body: HTMLElement;
  timing: { duration: number; easing: string };
  /** The pill's box, read before the panel was drawn. */
  pill: RunStatusMorphRect;
};

const popoverStates = new WeakMap<Element, RunStatusPopoverState>();

/**
 * Gives focus back after HUI's own open: Web Awesome focuses its dialog, and an automatic open must leave the operator
 * where they were. The element can still be disabled by the send that started the run, so the render that re-enables it
 * calls this again instead of polling.
 */
function restoreRunStatusFocus(popover: RunStatusPopover, state: RunStatusPopoverState): void {
  const focus = state.focus;
  if (!focus) return;
  const active = document.activeElement;
  if (active !== popover && !(active instanceof Node && popover.contains(active))) {
    // Web Awesome has not taken the focus into its dialog yet, and the disabled composer leaves the page with none: only
    // an operator who moved to another control ends the wait.
    if (active !== focus && active !== null && active !== document.body) state.focus = undefined;
    return;
  }
  if (!focus.isConnected) {
    state.focus = undefined;
    return;
  }
  if (focus.matches(":disabled")) return;
  focus.focus({ preventScroll: true });
  if (document.activeElement === focus) state.focus = undefined;
}

/** Records an open or close Web Awesome performed, whichever way it was caused. */
function settleRunStatusPanel(popover: RunStatusPopover, open: boolean): void {
  const trigger = document.getElementById(popover.getAttribute("for") ?? "");
  if (trigger && trigger.getAttribute("aria-expanded") !== String(open)) trigger.setAttribute("aria-expanded", String(open));
  const state = popoverStates.get(popover);
  if (!state) return;
  const ours = state.expect === open;
  state.expect = undefined;
  if (ours) return;
  // The operator's own open or close is their choice for this run, and it ends any focus an automatic open would return.
  state.focus = undefined;
  state.panel = runStatusPanelChosen(state.panel, open);
}

/** Sets the popover's open state and the trigger's aria-expanded, writing nothing when both already agree. */
function applyRunStatusPanel(trigger: HTMLElement, popover: RunStatusPopover, panelId: string, state: RunStatusPopoverState): void {
  if (trigger.getAttribute("aria-controls") !== panelId) trigger.setAttribute("aria-controls", panelId);
  const open = runStatusPanelOpen(state.panel, { running: state.panel.running, wide: state.wide });
  if (state.ready && popover.open !== open) {
    state.expect = open;
    state.focus = open && document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    popover.open = open;
  } else {
    restoreRunStatusFocus(popover, state);
  }
  if (trigger.getAttribute("aria-expanded") !== String(popover.open)) trigger.setAttribute("aria-expanded", String(popover.open));
}

/** Whether this window asked for no motion; a morph then never starts and the panel opens and closes at once. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The shell's own timing for the morph, read from the panel it animates so the CSS and the animation cannot drift. */
function runStatusMorphTimingOf(element: Element): { duration: number; easing: string } | undefined {
  const style = getComputedStyle(element);
  return runStatusMorphTiming(style.getPropertyValue("--duration-normal"), style.getPropertyValue("--ease-out"));
}

/** One box the morph reads: measured once at each end of the morph, never per frame. */
function runStatusMorphRect(element: Element): RunStatusMorphRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

/** The panel's content becomes legible over the last stretch of the growth, after the pill's own word has carried it. */
const CONTENT_SHOWN_FROM = 0.45;
const CONTENT_SHOWN_TO = 0.75;
/** The copy of a closing panel fades out as it reaches the pill's corner, leaving the pill's own word to take over. */
const FOLD_FADE_FROM = 0.55;

/**
 * What a picture of the panel must not keep: every name, role, id, test id and tab stop a query or the accessibility
 * tree reads. `alt` and `for` ride along because a picture can carry them — the plan's Markdown note allows an image,
 * and a labelled field would otherwise re-label the panel's own control — and the panel has to stay the only node
 * answering for either.
 */
const NOT_IN_A_PICTURE = ["id", "data-testid", "role", "aria-label", "aria-labelledby", "aria-describedby", "tabindex", "alt", "for"] as const;

/** Stops whatever the last open or close started, leaving no inline transform and no leftover copy behind. */
function stopRunStatusMorph(state: RunStatusPopoverState): void {
  state.grow = undefined;
  const morph = state.morph;
  if (!morph) return;
  state.morph = undefined;
  for (const animation of morph.animations) animation.cancel();
  if (morph.panel) {
    morph.panel.style.visibility = "";
    morph.panel.style.transformOrigin = "";
  }
  morph.ghost?.remove();
}

/**
 * Prepares the panel to grow out of the pill: the pill's box is read once, and the panel is held unpainted until Web
 * Awesome has finished its own show and laid the popup out at its final size. Measuring before that would read the
 * popup's own scale-in, and the morph would start from a fraction of the pill's box. Nothing here is recorded: the open
 * belongs to `settleRunStatusPanel`.
 */
function prepareRunStatusGrow(popover: RunStatusPopover, state: RunStatusPopoverState, trigger: HTMLElement): void {
  // An open can follow a close before that fold has finished, and the picture it left would be orphaned by the morph
  // prepared here: its own finish no longer matches `state.morph`, so nothing would ever take it out of the page.
  stopRunStatusMorph(state);
  const panel = popover.querySelector<HTMLElement>(".chat-run-status__panel");
  const body = panel?.querySelector<HTMLElement>(".chat-run-status__body");
  const timing = panel ? runStatusMorphTimingOf(panel) : undefined;
  if (!panel || !body || !timing) return;
  panel.style.visibility = "hidden";
  state.grow = { panel, body, timing, pill: runStatusMorphRect(trigger) };
  state.morph = { animations: [], panel };
}

/** Starts the prepared growth: the panel's box is measured once, then only transform and opacity move. */
function startRunStatusGrow(state: RunStatusPopoverState): void {
  const grow = state.grow;
  if (!grow) return;
  state.grow = undefined;
  // A close that overtook this open cleared the morph, and with it the panel's unpainted first frame.
  if (state.morph?.panel !== grow.panel) return;
  const panel = grow.panel;
  const shape = runStatusMorphShape({ pill: grow.pill, panel: runStatusMorphRect(panel), reducedMotion: false });
  if (!shape) {
    panel.style.visibility = "";
    state.morph = undefined;
    return;
  }
  panel.style.transformOrigin = shape.origin;
  panel.style.visibility = "";
  const shapeAnimation = panel.animate([{ transform: shape.transform }, { transform: "none" }], { duration: grow.timing.duration, easing: grow.timing.easing, fill: "both" });
  // The crossfade runs on the clock, not on the growth's front-loaded curve: those offsets pick the moment the head's
  // copy becomes legible, and the pill's own word hands it over after that.
  const reveal = grow.body.animate([
    { opacity: 0 },
    { opacity: 0, offset: CONTENT_SHOWN_FROM },
    { opacity: 1, offset: CONTENT_SHOWN_TO },
  ], { duration: grow.timing.duration, easing: "linear", fill: "both" });
  state.morph = { animations: [shapeAnimation, reveal], panel };
  shapeAnimation.onfinish = () => {
    if (state.morph?.panel !== panel) return;
    state.morph = undefined;
    shapeAnimation.cancel();
    reveal.cancel();
    panel.style.transformOrigin = "";
  };
}

/**
 * Folds a copy of the closing panel back into the pill. Web Awesome hides its dialog at once, so the copy carries the
 * panel's picture for the fold; the close's own bookkeeping already happened in `settleRunStatusPanel`, and nothing here
 * waits on the animation or writes a choice. The copy is a picture: no node in it, its own root included, has an id,
 * role, label, test id or tab stop to answer a query with, and it takes no press. Stripping only the root would leave
 * the head's own button answering `Close run status` from the copy drawn over the panel it closed.
 */
function foldRunStatusPanel(popover: RunStatusPopover, state: RunStatusPopoverState, trigger: HTMLElement): void {
  stopRunStatusMorph(state);
  const panel = popover.querySelector<HTMLElement>(".chat-run-status__panel");
  const timing = panel ? runStatusMorphTimingOf(panel) : undefined;
  if (!panel || !timing) return;
  const box = runStatusMorphRect(panel);
  const shape = runStatusMorphShape({ pill: runStatusMorphRect(trigger), panel: box, reducedMotion: false });
  if (!shape) return;
  const ghost = panel.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
    for (const name of NOT_IN_A_PICTURE) node.removeAttribute(name);
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.classList.add("chat-run-status__ghost");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    maxHeight: "none",
    margin: "0",
    pointerEvents: "none",
    transformOrigin: shape.origin,
  });
  ghost.scrollTop = panel.scrollTop;
  document.body.append(ghost);
  const fold = ghost.animate([{ transform: "none" }, { transform: shape.transform }], { duration: timing.duration, easing: timing.easing, fill: "both" });
  // The copy dissolves on the clock once the fold has done its travelling, so the chip it becomes does not sit opaque
  // under the pill while the pill's own word fades back in.
  const dissolve = ghost.animate([
    { opacity: 1 },
    { opacity: 1, offset: FOLD_FADE_FROM },
    { opacity: 0 },
  ], { duration: timing.duration, easing: "linear", fill: "both" });
  state.morph = { animations: [fold, dissolve], ghost };
  fold.onfinish = () => {
    if (state.morph?.ghost !== ghost) return;
    state.morph = undefined;
    fold.cancel();
    dissolve.cancel();
    ghost.remove();
  };
}

/**
 * Keeps one popover's state in step with its run and window. The trigger's ref calls this after every render, including
 * each streamed frame, so it finds the popover it anchors and only touches it when something actually changed. The ref
 * runs while its part is still a detached fragment, which is why a missing popover retries once after the commit.
 */
function driveRunStatusPanel(trigger: Element | undefined, panelId: string, input: { running: boolean; wide: boolean }, retry = true): void {
  if (!(trigger instanceof HTMLElement)) return;
  const popover = document.getElementById(`${panelId}-surface`);
  if (!(popover instanceof HTMLElement) || !("open" in popover) || popover.getAttribute("for") !== trigger.id) {
    if (retry) queueMicrotask(() => driveRunStatusPanel(trigger, panelId, input, false));
    return;
  }
  const surface = popover as RunStatusPopover;
  let state = popoverStates.get(surface);
  if (!state) {
    state = { panel: runStatusPanel(undefined, { running: input.running }), wide: input.wide, expect: undefined, focus: undefined, ready: false, shown: undefined, morph: undefined, grow: undefined };
    popoverStates.set(surface, state);
    // The anchor is looked up per event: the trigger's element survives HUI's renders, but the attribute is the truth.
    const anchored = () => {
      const anchor = document.getElementById(surface.getAttribute("for") ?? "");
      return anchor instanceof HTMLElement ? anchor : undefined;
    };
    surface.addEventListener("wa-show", () => {
      settleRunStatusPanel(surface, true);
      const phase = runStatusMorphPhase(state!.shown, true, prefersReducedMotion());
      state!.shown = true;
      const anchor = anchored();
      if (phase === "opening" && anchor) prepareRunStatusGrow(surface, state!, anchor);
      else stopRunStatusMorph(state!);
    });
    surface.addEventListener("wa-hide", () => {
      // The close's bookkeeping runs first and unchanged: the morph only draws, and never records a choice.
      settleRunStatusPanel(surface, false);
      const phase = runStatusMorphPhase(state!.shown, false, prefersReducedMotion());
      state!.shown = false;
      const anchor = anchored();
      if (phase === "closing" && anchor) foldRunStatusPanel(surface, state!, anchor);
      else stopRunStatusMorph(state!);
    });
    // Web Awesome moves the focus into its dialog just after the show, then finishes its own scale-in; HUI's own open
    // gives the focus back once it has, and the prepared growth starts from the panel measured after it.
    surface.addEventListener("wa-after-show", () => {
      restoreRunStatusFocus(surface, state!);
      startRunStatusGrow(state!);
    });
    // Setting open before Web Awesome's first update skips its open-change handling; wait for it once.
    void surface.updateComplete.then(() => {
      state!.ready = true;
      applyRunStatusPanel(trigger, surface, panelId, state!);
    });
  } else {
    state.panel = runStatusPanel(state.panel, { running: input.running });
    state.wide = input.wide;
  }
  applyRunStatusPanel(trigger, surface, panelId, state);
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
  const closePanel = () => {
    const popover = document.getElementById(`${panelId}-surface`) as RunStatusPopover | null;
    const state = popover ? popoverStates.get(popover) : undefined;
    if (popover && state) {
      // The X is the operator's close, not HUI's: the wa-hide it causes records the same choice.
      state.panel = runStatusPanelChosen(state.panel, false);
      state.expect = undefined;
      void popover.hide();
    }
    document.getElementById(triggerId)?.focus();
  };
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
      ${ref((element) => driveRunStatusPanel(element, panelId, { running: props.streaming, wide: props.wide }))}
    >
      <span class="chat-run-status__mark" aria-hidden="true">${renderRunStatusMark(model.tone)}</span>
      <span class="chat-run-status__label">${model.label}</span>
      ${model.count ? html`<span class="chat-run-status__count">${model.count}</span>` : nothing}
      <span class="chat-run-status__trigger-chevron" aria-hidden="true">${icons.chevronDown}</span>
    </button>
    <wa-popover
      id=${`${panelId}-surface`}
      class="chat-run-status__popover"
      for=${triggerId}
      placement="bottom-end"
      distance="6"
      without-arrow
    >
      <div class="chat-run-status__panel" id=${panelId} data-testid="run-status" role="dialog" aria-label="Run status">
        <div class="chat-run-status__body">
          <header class="chat-run-status__head">
            <span class="chat-run-status__state" data-tone=${model.tone} aria-hidden="true">
              <span class="chat-run-status__state-mark">${renderRunStatusMark(model.tone)}</span>
              <span class="chat-run-status__label">${model.label}</span>
              ${model.count ? html`<span class="chat-run-status__count">${model.count}</span>` : nothing}
            </span>
            <button type="button" class="btn btn--ghost btn--icon chat-icon-btn chat-run-status__close" aria-label="Close run status" @click=${closePanel}>${icons.close}</button>
          </header>
          ${renderGoal(props, model, panelId)}
          ${renderPlan(props, model, panelId)}
          ${renderHelpers(props, model, panelId)}
          ${renderWatchers(props)}
        </div>
      </div>
    </wa-popover>`;
}
