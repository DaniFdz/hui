/**
 * The chat header's Run status: the compact trigger and the popover that holds a
 * conversation's goal (with its controls and editor), its Task progress plan, the
 * latest batch of helpers and its background watchers. The popover is HUI's only
 * home for those four surfaces, and it opens only when the operator opens it: a
 * run never opens or closes it, and neither does the width of the window. The
 * trigger stays out of the transcript so a phone keeps the whole conversation.
 * The pill morphs into the panel and back as one painted box: the panel's width
 * and height grow out of the trigger's box from the same top-right corner, so the
 * box only grows left and down, and the pill is not drawn at all while the panel is
 * out — the panel's first line is its own title, the pill's mark, one state word and
 * count at the card's left padding, and its chevron, now the close, at the box's
 * right edge. Left-aligned copy inside a box growing to the left would glide with
 * that edge, so the title's copy is held while the box grows and written once it has
 * arrived; the rows inside it fade in behind the box, and a close draws the same box
 * back into the pill before Web Awesome hides the dialog, dropping the title with its
 * first frame and painting the pill once that close has landed. Escape and an outside
 * click close it too, and so does the phone header's session-list control, whose tap
 * the panel would otherwise take.
 */
import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import type { SessionGoal, SessionView, SubagentTaskView } from "../../api/sessions.ts";
import { mountEditorAtEnd } from "../../lib/composer/textarea.ts";
import {
  goalSectionStatus,
  runStatus,
  runStatusHeadCopyTiming,
  runStatusMorphBoxes,
  runStatusMorphPhase,
  runStatusMorphTiming,
  runStatusPanelChosen,
  runStatusPanelOpen,
  runStatusTriggerPainted,
  type RunStatusModel,
  type RunStatusMorphBox,
  type RunStatusMorphPhase,
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
  // One state word per box: the head already names the goal's state whenever its word is that state, so the section head
  // prints the title alone then and carries the state only when the head says something else.
  const status = goalSectionStatus(model, goal);
  return html`<section class="chat-run-status__section" aria-labelledby=${`${id}-goal-title`}>
    <div class="chat-run-status__section-head">
      <span class="chat-run-status__section-title" id=${`${id}-goal-title`}>Goal</span>
      ${status ? html`<span class="chat-run-status__meta" data-status=${goal.status}>${status}</span>` : nothing}
    </div>
    <p class="chat-run-status__objective">${goal.objective}</p>
    ${goal.note ? html`<p class="chat-run-status__note">${goal.note}</p>` : nothing}
    <p class="chat-run-status__set">Set ${relativeTime(Date.parse(goal.createdAt))}${goal.continuations > 0 ? ` · ${continuations}` : ""}</p>
    ${renderGoalActions(props, goal)}
  </section>`;
}

/** A `wa-popover` as this view drives it: `open` is the real state, `distance` is the main-axis offset it hands
 * floating-ui, and `popup` re-anchors the panel after a morph has taken it out of the popover's own flow. */
type RunStatusPopover = HTMLElement & {
  open: boolean;
  distance: number;
  hide: () => Promise<void> | void;
  popup?: { reposition: () => void };
};

/** One popover's panel state, kept by element so a streamed frame never loses the operator's choice. */
type RunStatusPopoverState = {
  panel: RunStatusPanelState;
  /** The panel is drawn: the last open state its own wa-show or wa-hide reported. */
  shown: boolean | undefined;
  /** The box travelling out of the pill or back into it. */
  morph: RunStatusMorph | undefined;
  /** The open whose first frame waits for Web Awesome's own show to settle. */
  grow: RunStatusGrow | undefined;
  /** The panel still drawn at the pill's box after a close, until Web Awesome has taken the dialog off screen. */
  painted: RunStatusMorph | undefined;
  /** The trigger a close took the focus from, until the panel is gone and can give it back. */
  returnFocus: HTMLElement | undefined;
  /** A close the phone header's session-list control made: that control keeps the focus, not the pill. */
  keepFocus: boolean;
};

/** One morph in flight: the panel's own box, the trigger it grew from, and the animations drawing it. */
type RunStatusMorph = {
  popover: RunStatusPopover;
  panel: HTMLElement;
  trigger: HTMLElement;
  animations: readonly Animation[];
  /** An open's head copy fading in once the box has landed: it is not cut with the shape, it is that arrival. */
  arrival: Animation | undefined;
  phase: RunStatusMorphPhase;
};

/** An open held unpainted until Web Awesome has shown it, so the panel's first frame can be the pill's box. */
type RunStatusGrow = {
  panel: HTMLElement;
  trigger: HTMLElement;
  timing: { duration: number; easing: string };
  /** The pill's box and corner, read before the panel painted its settled size over it. */
  pill: RunStatusMorphRect;
  pillRadius: number;
};

const popoverStates = new WeakMap<Element, RunStatusPopoverState>();

/** Records the open or close Web Awesome performed, which is always the operator's own: nothing else opens or closes the
 * panel. */
function settleRunStatusPanel(popover: RunStatusPopover, open: boolean): void {
  const trigger = document.getElementById(popover.getAttribute("for") ?? "");
  if (trigger && trigger.getAttribute("aria-expanded") !== String(open)) trigger.setAttribute("aria-expanded", String(open));
  const state = popoverStates.get(popover);
  if (!state) return;
  state.panel = runStatusPanelChosen(state.panel, open);
}

/** Syncs the trigger's own accessibility state with the operator's: the panel this trigger anchors, and whether that
 * panel is out. It never opens or closes the popover; their press and Web Awesome's own dismissal do. */
function applyRunStatusPanel(trigger: HTMLElement, panelId: string, state: RunStatusPopoverState): void {
  if (trigger.getAttribute("aria-controls") !== panelId) trigger.setAttribute("aria-controls", panelId);
  // A close draws before it hides: while the box travels back into the pill, Web Awesome stays open, and the control
  // already reports the panel closed rather than disagreeing with the box the operator is watching leave.
  if (state.morph?.phase === "closing") return;
  const open = runStatusPanelOpen(state.panel);
  if (trigger.getAttribute("aria-expanded") !== String(open)) trigger.setAttribute("aria-expanded", String(open));
}

/**
 * Puts the panel's settled top-right corner on the pill's. Web Awesome hands `distance` to floating-ui's
 * `offset({ mainAxis })`, so overlapping the anchor by the trigger's own height lands the panel's top edge on the
 * trigger's and leaves its right edge there; the box then only grows left and down. The height is read while the trigger
 * is laid out, so the popover carries no second copy of the stylesheet's 28px.
 */
function pinRunStatusPanel(popover: RunStatusPopover, trigger: HTMLElement): void {
  const height = trigger.offsetHeight;
  if (height > 0) popover.distance = -height;
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

/** The corner a box rounds with: the trigger's `999px` is the pill's own 14px at 28px tall. */
function runStatusRadiusOf(element: Element): number {
  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
}

/** One end of the box as the three properties the morph travels on: its width, its height and its corner. */
function runStatusBoxFrame(box: RunStatusMorphBox): Keyframe {
  return { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: `${box.radius}px` };
}

/** How much of the panel's rows are legible by the morph's progress: the box takes its room first. The head's copy is
 * not on this curve: left-aligned, it would travel with the box's left edge, so it waits for the box to arrive. */
const CONTENT_SHOWN_FROM = 0.45;
const CONTENT_SHOWN_TO = 0.75;
/** The head's rule and the close chevron belong to the panel, not to the pill's box: they arrive after the rows have. */
const CHROME_SHOWN_FROM = 0.7;
/** A closing box has to read as the pill before it arrives, so the rows and the chrome leave in its first quarter. */
const CONTENT_HIDDEN_BY = 0.25;

/** The inline styles a morph borrows, in the names CSS knows them by. */
const MORPH_STYLES = ["position", "left", "top", "width", "height", "border-radius", "overflow", "contain", "will-change", "visibility"] as const;

/** Hands the panel the popover's own flow and scrolling back. The trigger is not part of this: the show and hide own
 * its paint, so an open panel never repaints the pill beside itself. */
function returnRunStatusPanel(panel: HTMLElement): void {
  for (const name of MORPH_STYLES) panel.style.removeProperty(name);
}

/** Takes the panel's box out of the popover's flow for the morph: the box is the only thing that travels, and the
 * trigger keeps its own box where the pill was. */
function borrowRunStatusPanel(panel: HTMLElement): void {
  panel.style.position = "fixed";
  panel.style.overflow = "hidden";
  panel.style.contain = "layout paint";
  panel.style.willChange = "width, height";
}

/**
 * The pill is drawn exactly while the panel is not out: while it is, the panel's own title line carries the pill's mark,
 * word and count and the trigger keeps its box only as the anchor and for the name it gives back on close, so the two
 * boxes never show together.
 */
function paintRunStatusTrigger(trigger: HTMLElement, open: boolean): void {
  if (runStatusTriggerPainted(open)) trigger.style.removeProperty("visibility");
  else trigger.style.visibility = "hidden";
}

/** The copy over the box: faded by hand, because nothing inside the panel is scaled. The head's copy is not in this fade:
 * it is left-aligned, so it is held while the box grows and written once the box has arrived (see the arrival in
 * `startRunStatusGrow`), and a close drops it with its own first frame. */
function runStatusContentMorphs(panel: HTMLElement, timing: { duration: number; easing: string }, phase: RunStatusMorphPhase): { animations: Animation[]; arrival: Animation | undefined } {
  const options: KeyframeAnimationOptions = { duration: timing.duration, easing: "linear", fill: "both" };
  const animations: Animation[] = [];
  const body = panel.querySelector<HTMLElement>(".chat-run-status__body");
  const head = panel.querySelector<HTMLElement>(".chat-run-status__head");
  const chevron = panel.querySelector<HTMLElement>(".chat-run-status__collapse > svg");
  let arrival: Animation | undefined;
  if (body) {
    animations.push(body.animate(phase === "opening"
      ? [{ opacity: 0 }, { opacity: 0, offset: CONTENT_SHOWN_FROM }, { opacity: 1, offset: CONTENT_SHOWN_TO }]
      : [{ opacity: 1 }, { opacity: 0, offset: CONTENT_HIDDEN_BY }, { opacity: 0 }], options));
  }
  if (chevron) {
    // The close chevron: it starts pointing the way the closed pill's did and flips up over the growth, so the frames the
    // copy is held for still carry the control the operator pressed.
    animations.push(chevron.animate(phase === "opening"
      ? [{ transform: "rotate(0deg)" }, { transform: "rotate(180deg)" }]
      : [{ transform: "rotate(180deg)" }, { transform: "rotate(0deg)" }], { duration: timing.duration, easing: timing.easing, fill: "both" }));
  }
  if (head) {
    // The rule under the head is the panel's: its colour is the only part of a border a box can fade.
    const rule = getComputedStyle(head).borderBottomColor;
    animations.push(head.animate(phase === "opening"
      ? [{ borderBottomColor: "transparent" }, { borderBottomColor: "transparent", offset: CHROME_SHOWN_FROM }, { borderBottomColor: rule }]
      : [{ borderBottomColor: rule }, { borderBottomColor: "transparent", offset: CONTENT_HIDDEN_BY }, { borderBottomColor: "transparent" }], options));
  }
  const copy = panel.querySelector<HTMLElement>(".chat-run-status__state");
  if (copy) {
    const headCopy = runStatusHeadCopyTiming(timing, phase);
    const fade = copy.animate(phase === "opening"
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 0 }], { duration: headCopy.duration, delay: headCopy.delay, easing: timing.easing, fill: "both" });
    // An open's copy is written after the growth, so it is kept out of the shape's own cut; a close's fade is one of the
    // animations the fold draws and cancels.
    if (phase === "opening") arrival = fade;
    else animations.push(fade);
  }
  return { animations, arrival };
}

/** Stops whatever the last open or close started, leaving the panel its flow. */
function stopRunStatusMorph(state: RunStatusPopoverState): void {
  state.grow = undefined;
  const morph = state.morph;
  if (!morph) return;
  state.morph = undefined;
  for (const animation of morph.animations) animation.cancel();
  morph.arrival?.cancel();
  returnRunStatusPanel(morph.panel);
  // A fold cut short by a reopen leaves the dialog open while the hide that started it already reported the control
  // closed; the state the control reports follows what is on screen, so a reopen it can still take the panel back to.
  if (morph.phase === "closing") morph.trigger.setAttribute("aria-expanded", String(morph.popover.open));
}

/** Gives a panel that has closed its flow back, once Web Awesome is done with it. */
function releaseRunStatusPainted(state: RunStatusPopoverState): void {
  const painted = state.painted;
  if (!painted) return;
  state.painted = undefined;
  for (const animation of painted.animations) animation.cancel();
  painted.arrival?.cancel();
  returnRunStatusPanel(painted.panel);
  // The panel was out of the popover's flow while its box travelled, so the popup re-reads the anchor and the panel.
  painted.popover.popup?.reposition();
}

/**
 * Holds the panel unpainted until Web Awesome has shown it, so the open can measure the box it has to become. A frame of
 * the finished panel is the flash the morph exists to avoid. Nothing here is recorded: the open belongs to
 * `settleRunStatusPanel`.
 */
function prepareRunStatusGrow(popover: RunStatusPopover, state: RunStatusPopoverState, trigger: HTMLElement): void {
  stopRunStatusMorph(state);
  releaseRunStatusPainted(state);
  const panel = popover.querySelector<HTMLElement>(".chat-run-status__panel");
  const timing = panel ? runStatusMorphTimingOf(panel) : undefined;
  if (!panel || !timing) return;
  panel.style.visibility = "hidden";
  state.grow = {
    panel,
    trigger,
    timing,
    pill: runStatusMorphRect(trigger),
    pillRadius: runStatusRadiusOf(trigger),
  };
}

/** Starts the prepared open: the panel's own box grows out of the pill's, and nothing inside it is transformed. */
function startRunStatusGrow(popover: RunStatusPopover, state: RunStatusPopoverState): void {
  const grow = state.grow;
  if (!grow) return;
  state.grow = undefined;
  const { panel, trigger, timing } = grow;
  const boxes = runStatusMorphBoxes({
    pill: grow.pill,
    panel: runStatusMorphRect(panel),
    pillRadius: grow.pillRadius,
    panelRadius: runStatusRadiusOf(panel),
    reducedMotion: false,
  });
  if (!boxes) {
    // No morph at all (reduced motion): the panel is the only box, so it shows at once while the pill stays hidden.
    panel.style.removeProperty("visibility");
    return;
  }
  borrowRunStatusPanel(panel);
  panel.style.removeProperty("visibility");
  const shape = panel.animate([runStatusBoxFrame(boxes.from), runStatusBoxFrame(boxes.to)], { duration: timing.duration, easing: timing.easing, fill: "both" });
  const content = runStatusContentMorphs(panel, timing, "opening");
  const morph: RunStatusMorph = { popover, panel, trigger, phase: "opening", animations: [shape, ...content.animations], arrival: content.arrival };
  state.morph = morph;
  shape.onfinish = () => {
    if (state.morph !== morph) return;
    // The box has arrived, so the panel's title is written where it stays: every other animation is cut, and only the
    // panel gets its flow back — the pill is not painted again until a close has landed.
    for (const animation of morph.animations) animation.cancel();
    returnRunStatusPanel(panel);
    popover.popup?.reposition();
    const arrival = morph.arrival;
    if (!arrival) {
      state.morph = undefined;
      return;
    }
    // The copy keeps fading in over the box it arrived on. A finished fade holds no effect of its own, so it is cancelled
    // once it ends and the morph is done.
    void arrival.finished.then(() => {
      if (state.morph !== morph) return;
      state.morph = undefined;
      arrival.cancel();
    }, () => {});
  };
}

/**
 * Draws a closing panel back into the pill's box. Web Awesome asked to hide the dialog and the panel is still painted, so
 * the same box that grew travels back; the hide itself is held (`wa-hide` is cancelable) until the box has arrived. The
 * close's own bookkeeping already happened in `settleRunStatusPanel`, and nothing here waits on the animation or writes a
 * choice.
 */
function startRunStatusReverse(popover: RunStatusPopover, state: RunStatusPopoverState, trigger: HTMLElement): void {
  stopRunStatusMorph(state);
  const panel = popover.querySelector<HTMLElement>(".chat-run-status__panel");
  const timing = panel ? runStatusMorphTimingOf(panel) : undefined;
  const boxes = panel && timing
    ? runStatusMorphBoxes({ pill: runStatusMorphRect(trigger), panel: runStatusMorphRect(panel), pillRadius: runStatusRadiusOf(trigger), panelRadius: runStatusRadiusOf(panel), reducedMotion: false })
    : undefined;
  if (!panel || !timing || !boxes) {
    popover.open = false;
    return;
  }
  borrowRunStatusPanel(panel);
  const shape = panel.animate([runStatusBoxFrame(boxes.to), runStatusBoxFrame(boxes.from)], { duration: timing.duration, easing: timing.easing, fill: "both" });
  const morph: RunStatusMorph = {
    popover,
    panel,
    trigger,
    phase: "closing",
    animations: [shape, ...runStatusContentMorphs(panel, timing, "closing").animations],
    arrival: undefined,
  };
  state.morph = morph;
  shape.onfinish = () => {
    if (state.morph !== morph) return;
    // The box stays at the pill's, filled by its own animation, until Web Awesome has taken the dialog off screen: putting
    // the panel back in flow first would flash its settled size for the frame between.
    state.morph = undefined;
    state.painted = morph;
    popover.open = false;
  };
}

/** Finishes a close once Web Awesome has taken the dialog off screen: the panel gets its flow back, the pill paints
 * again where the box arrived, and the focus a close took from it comes back. */
function settleRunStatusClose(state: RunStatusPopoverState, trigger: HTMLElement | undefined): void {
  releaseRunStatusPainted(state);
  if (trigger) paintRunStatusTrigger(trigger, false);
  const focus = state.returnFocus;
  state.returnFocus = undefined;
  focus?.focus({ preventScroll: true });
}

/**
 * Keeps one popover's trigger in step with the panel, which only the operator opens and closes: the ref writes no open
 * state, it anchors the panel and reports whether it is out. The trigger's ref calls this after every render, including
 * each streamed frame, so it finds the popover it anchors and only touches it when something actually changed. The ref
 * runs while its part is still a detached fragment, which is why a missing popover retries once after the commit.
 */
function driveRunStatusPanel(trigger: Element | undefined, panelId: string, retry = true): void {
  if (!(trigger instanceof HTMLElement)) return;
  const popover = document.getElementById(`${panelId}-surface`);
  if (!(popover instanceof HTMLElement) || !("open" in popover) || popover.getAttribute("for") !== trigger.id) {
    if (retry) queueMicrotask(() => driveRunStatusPanel(trigger, panelId, false));
    return;
  }
  const surface = popover as RunStatusPopover;
  let state = popoverStates.get(surface);
  if (!state) {
    state = { panel: { open: false }, shown: undefined, morph: undefined, grow: undefined, painted: undefined, returnFocus: undefined, keepFocus: false };
    popoverStates.set(surface, state);
    // The anchor is looked up per event: the trigger's element survives HUI's renders, but the attribute is the truth.
    const anchored = () => {
      const anchor = document.getElementById(surface.getAttribute("for") ?? "");
      return anchor instanceof HTMLElement ? anchor : undefined;
    };
    surface.addEventListener("wa-show", () => {
      const anchor = anchored();
      // The show is dispatched before Web Awesome places its popup, so pinning the corner here decides the settled box and
      // the morph's first frame alike.
      if (anchor) pinRunStatusPanel(surface, anchor);
      // The panel's own title line carries the pill's copy from here on: the pill itself is not drawn beside it, whether
      // this open morphs or opens at once.
      if (anchor) paintRunStatusTrigger(anchor, true);
      // A popover Web Awesome shows while a close is drawing would steal the panel's box: the close owns it until it
      // ends.
      if (state!.morph?.phase === "closing") return;
      settleRunStatusPanel(surface, true);
      const phase = runStatusMorphPhase(state!.shown, true, prefersReducedMotion());
      state!.shown = true;
      if (phase === "opening" && anchor) prepareRunStatusGrow(surface, state!, anchor);
      else stopRunStatusMorph(state!);
    });
    // Web Awesome moves the focus into its dialog just after the show, then finishes its own scale-in: the box starts
    // from the panel measured after it.
    surface.addEventListener("wa-after-show", () => {
      startRunStatusGrow(surface, state!);
    });
    surface.addEventListener("wa-hide", (event) => {
      // A close already drawing holds the dialog open until its box has arrived.
      if (state!.morph?.phase === "closing") {
        event.preventDefault();
        return;
      }
      const closing = runStatusMorphPhase(state!.shown, false, prefersReducedMotion()) === "closing";
      state!.shown = false;
      // The close's bookkeeping runs first and unchanged: the morph only draws, and never records a choice.
      settleRunStatusPanel(surface, false);
      const anchor = anchored();
      const active = document.activeElement;
      // A close that already drew gives the focus back where it began; the hide that ends it must not reset that, because
      // the trigger is hidden by then and the focus has already fallen to the page. A close from the header's session-list
      // control keeps the focus on that control, which is where the tap put it.
      const keepsFocus = state!.keepFocus;
      state!.keepFocus = false;
      if (!state!.painted) state!.returnFocus = anchor && !keepsFocus && (popover.contains(active) || active === anchor) ? anchor : undefined;
      if (!closing || !anchor) {
        stopRunStatusMorph(state!);
        return;
      }
      // Web Awesome asked to hide while the panel is still painted, so its own hide is held (the event is cancelable) and
      // the box draws itself back into the pill. Web Awesome puts itself back into its open state once the dispatch
      // returns, without a new show, so the panel keeps the position the popup gave it; the reverse ends by closing the
      // popover for real. The control keeps reporting the panel open for the fold: it is still on screen, and a control
      // that said otherwise would disagree with the screen until the fold landed, which is the disagreement the shared
      // settle gate waits out.
      event.preventDefault();
      startRunStatusReverse(surface, state!, anchor);
    });
    surface.addEventListener("wa-after-hide", () => settleRunStatusClose(state!, anchored()));
  }
  applyRunStatusPanel(trigger, panelId, state);
}

/**
 * Closes the panel through the chevron's path: the operator's own close, recorded so no later run reopens it, and the
 * popover hidden so the box draws itself back into the pill. `keepFocus` leaves the focus where a tap on another control
 * of the header put it; the chevron wants it back on the trigger.
 */
function closeRunStatusPanel(popover: RunStatusPopover, state: RunStatusPopoverState, options: { keepFocus: boolean }): void {
  state.panel = runStatusPanelChosen(state.panel, false);
  state.keepFocus = options.keepFocus;
  void popover.hide();
}

/**
 * Closes the Run status popover a chat pane's control owns, when it is open. A phone's panel is pinned over the header row
 * the session-list control leads, so a tap there has to open the drawer and dismiss the panel in the same press: the
 * close is the operator's and holds until they open the panel again, and the control keeps the focus the tap gave it.
 */
export function dismissRunStatusPanel(controlId: string): void {
  const popover = document.getElementById(`${controlId}-panel-surface`) as RunStatusPopover | null;
  const state = popover ? popoverStates.get(popover) : undefined;
  if (!popover || !state || !popover.open) return;
  closeRunStatusPanel(popover, state, { keepFocus: true });
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
      // The chevron is the operator's close, not HUI's: the wa-hide it causes records the same choice, and the focus comes
      // back to the trigger once the box has drawn back into it and the pill has painted again.
      closeRunStatusPanel(popover, state, { keepFocus: false });
    }
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
      ${ref((element) => driveRunStatusPanel(element, panelId))}
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
      without-arrow
    >
      <div class="chat-run-status__panel" id=${panelId} data-testid="run-status" role="dialog" aria-label="Run status">
        <header class="chat-run-status__head">
          <span class="chat-run-status__state" data-tone=${model.tone}>
            <span class="chat-run-status__state-mark" aria-hidden="true">${renderRunStatusMark(model.tone)}</span>
            <span class="chat-run-status__label">${model.label}</span>
            ${model.count ? html`<span class="chat-run-status__count">${model.count}</span>` : nothing}
          </span>
          <button type="button" class="btn btn--ghost btn--icon chat-icon-btn chat-run-status__collapse" aria-label="Close run status" @click=${closePanel}>${icons.chevronDown}</button>
        </header>
        <div class="chat-run-status__body">
          ${renderGoal(props, model, panelId)}
          ${renderPlan(props, model, panelId)}
          ${renderHelpers(props, model, panelId)}
          ${renderWatchers(props)}
        </div>
      </div>
    </wa-popover>`;
}
