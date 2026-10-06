/**
 * The Bots tab: the sidebar roster, a bot's side panel (Routines | Memory),
 * the New/Edit bot dialog and the archive confirmation. Rendering only; every
 * read and write is a prop callback owned by `hui-app.ts`. The bot's chat is
 * the ordinary session pane (`renderHome`) with a bot header, not a fork.
 */
import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../lib/icons.ts";
import { closeDropdownOnEscape, labelDropdown } from "../lib/web-awesome.ts";
import { navigationPath } from "../lib/navigation.ts";
import type { BotDraft, BotMemoryStatus, BotView } from "../lib/bots.ts";
import { BOT_FACE_COLORS, BOT_FACE_SHAPES, BOT_FACE_SHAPE_LABELS, BOT_LIMITS, BOT_THINKING_LEVELS, botLook, type BotAvatar, type BotFaceShape } from "../../shared/bots.ts";
import { facePath, rosterFaceState, type BotFaceSize, type BotFaceState } from "../lib/bot-face.ts";
import "../components/bot-face.ts";
import { VOICE_LIMITS, type VoiceProfile } from "../../shared/voice.ts";
import { languageOptions, speedLabel, voiceOptions } from "../lib/voice.ts";
import type { RuntimeModel } from "../lib/sessions-store.ts";
import type { AutomationRun, AutomationSnapshot, AutomationTask, AutomationTaskInput } from "../lib/automation-types.ts";
import {
  archivedBotCount,
  archivedRosterBots,
  botAccessibleName,
  botActivity,
  botActivityAt,
  botPreview,
  compactRelativeTime,
  hiddenBotCount,
  rosterBots,
  tabAfterKey,
  BOT_PANEL_TABS,
  type BotPanelTab,
} from "../lib/bot-roster.ts";
import { botRoutineRuns, botRoutines, routineSchedule, RoutineFormError, ROUTINE_WEEKDAYS } from "../lib/bot-routines.ts";
import { memoryBudgetLabel, memoryUsageDetail, memoryUsageLabel, type MemoryLine } from "../lib/bot-memory.ts";
import { describeRoutineSchedule, formatTimestamp, runIsActive } from "./settings-automation.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";
import { renderPicker } from "./settings-picker.ts";
import { renderDirectoryPicker } from "./directory-picker.ts";

// Node's focused view tests import this module without a CSS loader.
if (typeof document !== "undefined") {
  await import("../styles/bots.css");
}

/* ── avatar ───────────────────────────────────────────────────────────────── */

export type BotAvatarOptions = {
  /** What the face shows; an emoji has no expressions. */
  state?: BotFaceState;
  badge?: TemplateResult | typeof nothing;
  /** The call's audio level (0–1) for a large face that speaks or listens. */
  level?: () => number | undefined;
};

/** A bot's face (or its emoji, while it has one), decorative: the name and status stay in text beside it. */
export function renderBotAvatar(bot: Pick<BotView, "id" | "avatar">, size: BotFaceSize = "md", options: BotAvatarOptions = {}) {
  const look = botLook(bot);
  const badge = options.badge ?? nothing;
  if (look.kind === "emoji") {
    return html`<span class="bot-avatar bot-avatar--${size} bot-avatar--emoji" style=${`--bot-avatar-color: ${look.color}`} aria-hidden="true"><span class="bot-avatar__glyph">${look.emoji}</span>${badge}</span>`;
  }
  return html`<span class="bot-avatar bot-avatar--${size} bot-avatar--face" aria-hidden="true"><hui-bot-face size=${size} shape=${look.shape} .color=${look.color}
    .seed=${look.seed} state=${options.state ?? "idle"} .level=${options.level}></hui-bot-face>${badge}</span>`;
}

function activityBadge(bot: BotView) {
  const activity = botActivity(bot);
  if (activity === "idle") return nothing;
  if (activity === "waiting") return html`<span class="bot-avatar__badge bot-avatar__badge--waiting" title="Waiting for your answer">${icons.hand}</span>`;
  if (activity === "error") return html`<span class="bot-avatar__badge bot-avatar__badge--error" title="Failed">${icons.alertTriangle}</span>`;
  if (activity === "away") return html`<span class="bot-avatar__badge bot-avatar__badge--away" title="Unreachable">${icons.plug}</span>`;
  return html`<span class="bot-avatar__badge bot-avatar__badge--${activity}" title=${activity === "summarizing" ? "Summarizing memory…" : "Active now"}></span>`;
}

/* ── roster ───────────────────────────────────────────────────────────────── */

export type BotRosterProps = {
  bots: readonly BotView[];
  /** The first read is still pending; a refresh keeps the current rows. */
  loading: boolean;
  error: string;
  query: string;
  showHidden: boolean;
  /** Archived bots listed below the roster, each with Restore. */
  showArchived: boolean;
  activeBotId: string;
  menuFor: string;
  notice: string;
  noticeFailed: boolean;
  /** Pending Hide/Unhide, archive, restore or delete, so the row cannot be acted on twice. */
  pendingId: string;
  now: number;
  onSelect: (bot: BotView) => void;
  onNew: () => void;
  onEdit: (bot: BotView) => void;
  onSetHidden: (bot: BotView, hidden: boolean) => void;
  onArchive: (bot: BotView) => void;
  onToggleShowHidden: () => void;
  onToggleShowArchived: () => void;
  onRestore: (bot: BotView) => void;
  /** Asks before deleting an archived bot for good. */
  onDelete: (bot: BotView) => void;
  onRetry: () => void;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
};

/** Drawer handling stays with the shell, which owns the mobile navigation. */
export type RosterDrawer = { navigate: (event: Event) => void; dialog: (event: Event) => void };

function rosterMenuId(id: string): string {
  return `bot-actions-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function botRow(bot: BotView, props: BotRosterProps, drawer: RosterDrawer) {
  const active = props.activeBotId === bot.id;
  const open = props.menuFor === bot.id;
  const at = botActivityAt(bot);
  const activity = botActivity(bot);
  const preview = activity === "summarizing" ? "Summarizing memory…" : activity === "waiting" ? "Waiting for your answer" : botPreview(bot);
  const unread = bot.unread && !active;
  return html`<div
    class="session-row-wrap session-row-host sidebar-recent-session bot-row ${active ? "sidebar-recent-session--active" : ""} ${unread ? "sidebar-recent-session--unread" : ""} ${bot.hidden ? "bot-row--hidden" : ""} ${props.pendingId === bot.id ? "sidebar-recent-session--moving" : ""}"
    data-bot-id=${bot.id} data-session-row-action-count="1">
    <a href=${navigationPath({ kind: "bot", id: bot.id })} class="session-row sidebar-recent-session__link bot-row__link" draggable="false"
      aria-current=${active ? "true" : "false"} aria-label=${botAccessibleName(bot)}
      @click=${(event: MouseEvent) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        drawer.navigate(event);
        props.onSelect(bot);
      }}>
      ${renderBotAvatar(bot, "sm", { state: rosterFaceState(bot), badge: activityBadge(bot) })}
      <span class="bot-row__text">
        <span class="bot-row__top">
          <span class="bot-row__name sidebar-recent-session__name">${bot.name}</span>
          ${bot.memory?.failing ? html`<span class="bot-row__warning" title=${`Memory summaries are failing: ${bot.memory.failing.error}`}>${icons.alertTriangle}</span>` : nothing}
          <time class="bot-row__time" datetime=${at ? new Date(at).toISOString() : nothing} title=${at ? new Date(at).toLocaleString() : nothing}>${compactRelativeTime(at, props.now)}</time>
        </span>
        <span class="bot-row__bottom">
          ${bot.hidden ? html`<span class="bot-row__tag">Hidden</span>` : nothing}
          <span class="bot-row__preview">${preview}</span>
          ${unread ? html`<span class="sidebar-session-unread-dot bot-row__unread" title="Unread"></span>` : nothing}
        </span>
      </span>
    </a>
    <span class="sidebar-recent-session__aside session-row-aside">
      <span class="session-row-actions">
        <wa-dropdown class="session-menu" placement="bottom-end" distance="4" .open=${open} id=${rosterMenuId(bot.id)}
          @keydown=${closeDropdownOnEscape}
          @wa-show=${(event: Event) => { labelDropdown(event); if (!open) props.onToggleMenu(bot.id); }}
          @wa-hide=${() => { if (open) props.onCloseMenu(); }}
          @wa-select=${(event: CustomEvent<{ item: { value: string } }>) => {
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[slot="trigger"]')?.focus();
            props.onCloseMenu();
            const action = event.detail.item.value;
            if (action === "edit") { drawer.dialog(event); props.onEdit(bot); }
            if (action === "hide") props.onSetHidden(bot, !bot.hidden);
            if (action === "archive") { drawer.dialog(event); props.onArchive(bot); }
          }}>
          <button slot="trigger" type="button" class="session-action session-row__menu-btn" aria-label=${`Actions for ${bot.name}`} ?disabled=${props.pendingId === bot.id}>
            <span class="session-row__more-icon" aria-hidden="true">${icons.moreHorizontal}</span>
          </button>
          <wa-dropdown-item value="edit" class="session-menu__item"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.edit}</span><span class="session-menu__text">Edit bot…</span></wa-dropdown-item>
          <wa-dropdown-item value="hide" class="session-menu__item"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.eye}</span><span class="session-menu__text">${bot.hidden ? "Unhide" : "Hide"}</span></wa-dropdown-item>
          <div class="session-menu__separator" role="separator"></div>
          <wa-dropdown-item value="archive" variant="danger" class="session-menu__item session-menu__item--destructive"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.box}</span><span class="session-menu__text">Archive…</span></wa-dropdown-item>
        </wa-dropdown>
      </span>
    </span>
  </div>`;
}

/** An archived bot keeps its chat and memory but has no chat to open until
 * it is restored, so its row is not a link. Restore brings it back; Delete,
 * after a confirmation, removes it for good. */
function archivedRow(bot: BotView, props: BotRosterProps, drawer: RosterDrawer) {
  const pending = props.pendingId === bot.id;
  return html`<li class="bot-archived-row" data-bot-id=${bot.id}>
    ${renderBotAvatar(bot, "sm", { state: "offline" })}
    <span class="bot-archived-row__text">
      <span class="bot-archived-row__name">${bot.name}</span>
      <span class="bot-archived-row__meta">${bot.title || botPreview(bot)}</span>
    </span>
    <button type="button" class="btn btn--sm bot-archived-row__restore" ?disabled=${pending} aria-label=${`Restore ${bot.name}`}
      @click=${() => props.onRestore(bot)}>${pending ? "Restoring…" : "Restore"}</button>
    <button type="button" class="btn btn--sm bot-archived-row__delete" ?disabled=${pending} aria-label=${`Delete ${bot.name}`} title="Delete"
      @click=${(event: Event) => { drawer.dialog(event); props.onDelete(bot); }}>${icons.trash}</button>
  </li>`;
}

/** Show hidden (N) and Show archived (N), each only while some are; then,
 * while Show archived is on, the archived bots with Restore and Delete. */
function renderRosterToggles(props: BotRosterProps, drawer: RosterDrawer) {
  const hidden = hiddenBotCount(props.bots);
  const archived = archivedBotCount(props.bots);
  if (!hidden && !archived) return nothing;
  const rows = props.showArchived && archived ? archivedRosterBots(props.bots, props.query) : [];
  return html`<div class="bot-roster__toggles">
      ${hidden ? html`<button type="button" class="bot-roster__hidden-toggle" aria-pressed=${String(props.showHidden)} @click=${props.onToggleShowHidden}>
        ${icons.eye}<span>Show hidden (${hidden})</span></button>` : nothing}
      ${archived ? html`<button type="button" class="bot-roster__hidden-toggle" aria-pressed=${String(props.showArchived)} @click=${props.onToggleShowArchived}>
        ${icons.box}<span>Show archived (${archived})</span></button>` : nothing}
    </div>
    ${props.showArchived && archived ? html`<section class="bot-roster__archived" aria-label="Archived bots">
      ${rows.length
        ? html`<ul class="bot-roster__archived-list">${rows.map((bot) => archivedRow(bot, props, drawer))}</ul>`
        : html`<p class="sidebar-list__note" role="status">No matching archived bots.</p>`}
    </section>` : nothing}`;
}

export function renderBotRoster(props: BotRosterProps, drawer: RosterDrawer) {
  const notice = props.notice
    ? html`<p class="sidebar-list__note sidebar-session-move-note ${props.noticeFailed ? "is-error" : ""}" role=${props.noticeFailed ? "alert" : "status"} aria-live="polite">${props.notice}</p>`
    : nothing;
  const known = props.bots.filter((bot) => !bot.archived);
  if (!known.length) {
    if (props.error) {
      return html`${notice}<div class="sidebar-empty bot-roster__state"><p class="sidebar-list__note is-error" role="alert">${props.error}</p>
        <button type="button" class="btn btn--sm" @click=${props.onRetry}>Retry</button></div>`;
    }
    if (props.loading) return html`<p class="sidebar-list__note" role="status">Loading bots…</p>`;
    const archived = archivedBotCount(props.bots);
    return html`${notice}<div class="sidebar-empty bot-roster__empty">
      <p class="bot-roster__empty-title">${archived ? "No active bots" : "No bots yet"}</p>
      <p class="sidebar-list__note">${archived
        ? `${archived === 1 ? "One archived bot keeps its chat and memory" : `${archived} archived bots keep their chats and memory`}; Show archived lists ${archived === 1 ? "it" : "them"} to restore or delete.`
        : "A bot is a named agent with one permanent chat, its own model and a memory that summarizes older messages by itself. Routines can message it on a schedule."}</p>
      <button type="button" class="btn btn--sm bot-roster__new" @click=${(event: Event) => { drawer.dialog(event); props.onNew(); }}>${icons.plus}<span>New bot</span></button>
    </div>
    ${renderRosterToggles(props, drawer)}`;
  }
  const rows = rosterBots(props.bots, { query: props.query, showHidden: props.showHidden });
  return html`${notice}
    ${props.error ? html`<p class="sidebar-list__note is-error" role="alert">${props.error} <button type="button" class="btn btn--sm" @click=${props.onRetry}>Retry</button></p>` : nothing}
    <div class="session-group__rows sidebar-recent-sessions__list bot-roster__rows">
      ${rows.length
        ? rows.map((bot) => botRow(bot, props, drawer))
        : html`<p class="sidebar-list__note" role="status">${props.query.trim() ? "No matching bots." : "Every bot is hidden."}</p>`}
    </div>
    ${renderRosterToggles(props, drawer)}`;
}

/* ── chat placeholder (no bot or no chat yet) ─────────────────────────────── */

export type BotPlaceholderProps = {
  title: string;
  message: string;
  tone: "status" | "alert";
  mobileNav: boolean;
  onRetry?: () => void;
  /** The action's label; "Retry" unless the placeholder offers something else. */
  actionLabel?: string;
  onToggleNavigation: (event: Event) => void;
};

export function renderBotPlaceholder(props: BotPlaceholderProps) {
  return html`<div class="bot-workspace bot-workspace--placeholder">
    <header class="transcript__head chat-pane__header bot-workspace__header">
      <div class="chat-pane__header-leading">
        ${props.mobileNav ? html`<button class="btn btn--ghost btn--icon chat-icon-btn chat-pane__nav-toggle" type="button" aria-label="Open navigation"
          aria-controls="primary-navigation-drawer" aria-expanded="false" @click=${props.onToggleNavigation}>${icons.menu}</button>` : nothing}
        <div class="transcript__identity chat-pane__crumbs"><h2 class="transcript__title chat-pane__session-title">${props.title}</h2></div>
      </div>
    </header>
    <div class="agent-chat__empty bot-workspace__message" role=${props.tone}>
      <span>${props.message}</span>
      ${props.onRetry ? html`<button type="button" class="btn btn--sm" @click=${props.onRetry}>${props.actionLabel ?? "Retry"}</button>` : nothing}
    </div>
  </div>`;
}

/* ── side panel ───────────────────────────────────────────────────────────── */

export type BotMemoryState = {
  loading: boolean;
  error: string;
  status?: BotMemoryStatus;
  lines?: readonly MemoryLine[];
};

export type MemoryZoomState = { loading: boolean; error: string; lines: readonly MemoryLine[] };

export type BotPanelProps = {
  bot: BotView;
  id: string;
  tab: BotPanelTab;
  /** Narrow layouts show the panel as a sheet over the chat. */
  sheet: boolean;
  timezone: string;
  onTab: (tab: BotPanelTab) => void;
  onClose: () => void;
  routines: {
    automation: AutomationSnapshot | undefined;
    error: string;
    pending: boolean;
    formError: string;
    actionError: string;
    onCreate: (input: AutomationTaskInput) => Promise<boolean>;
    onFormError: (message: string) => void;
    onSetEnabled: (task: AutomationTask, enabled: boolean) => void;
    onRun: (task: AutomationTask) => void;
    onDelete: (task: AutomationTask) => void;
    onRetry: () => void;
  };
  memory: {
    state: BotMemoryState;
    zoom: ReadonlyMap<string, MemoryZoomState>;
    onZoom: (line: MemoryLine) => void;
    onRefresh: () => void;
    /** OptChat's browse page; a same-origin link opens it in a new tab. */
    pageUrl: string;
  };
};

const PANEL_TAB_LABELS: Record<BotPanelTab, string> = { routines: "Routines", memory: "Memory" };

function panelTabId(panelId: string, tab: BotPanelTab): string {
  return `${panelId}-tab-${tab}`;
}

function onPanelTabKeydown(event: KeyboardEvent, props: BotPanelProps) {
  const next = tabAfterKey(BOT_PANEL_TABS, props.tab, event.key);
  if (!next) return;
  event.preventDefault();
  props.onTab(next);
  const list = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
  queueMicrotask(() => list?.querySelector<HTMLElement>(`#${CSS.escape(panelTabId(props.id, next))}`)?.focus());
}

const RUN_LABELS: Record<AutomationRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const playIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;

function renderRoutine(task: AutomationTask, props: BotPanelProps) {
  const { routines } = props;
  return html`<li class="bot-routine ${task.enabled ? "" : "bot-routine--paused"}" data-routine=${task.id}>
    <div class="bot-routine__head">
      <span class="bot-routine__name">${task.name}</span>
      ${renderSettingsToggle(`Enable ${task.name}`, task.enabled, (checked) => routines.onSetEnabled(task, checked), routines.pending)}
    </div>
    <p class="bot-routine__meta">${describeRoutineSchedule(task.schedule)} · ${task.enabled ? `next ${formatTimestamp(task.nextRunAt)}` : "paused"}</p>
    <p class="bot-routine__prompt" title=${task.prompt}>${task.prompt}</p>
    <div class="bot-routine__actions">
      <button type="button" class="btn btn--sm bot-routine__run" ?disabled=${routines.pending} aria-label=${`Run now: ${task.name}`} @click=${() => routines.onRun(task)}>${playIcon}<span>Run now</span></button>
      <button type="button" class="btn btn--sm btn--ghost bot-routine__delete" ?disabled=${routines.pending} aria-label=${`Delete ${task.name}`} @click=${() => routines.onDelete(task)}>${icons.trash}<span>Delete</span></button>
    </div>
  </li>`;
}

function renderRun(run: AutomationRun) {
  return html`<li class="bot-run" data-run=${run.id} data-status=${run.status}>
    <div class="bot-run__head"><span class="bot-run__name">${run.taskName}</span><span class="bot-run__status">${RUN_LABELS[run.status]}</span></div>
    <p class="bot-run__facts">${run.source === "manual" ? "Run now" : "Scheduled"} · ${formatTimestamp(run.startedAt ?? run.createdAt)}</p>
    ${run.summary ? html`<p class="bot-run__body">${run.summary}</p>` : nothing}
    ${run.error ? html`<p class="bot-run__body bot-run__body--error" role="alert">${run.error}</p>` : nothing}
  </li>`;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function submitRoutine(event: SubmitEvent, props: BotPanelProps) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const { routines } = props;
  try {
    const name = formText(data, "name");
    if (!name) throw new RoutineFormError("Name the routine.");
    const prompt = formText(data, "prompt");
    if (!prompt) throw new RoutineFormError("Write what the routine sends to the bot.");
    const cadence = formText(data, "cadence");
    const schedule = routineSchedule({
      cadence,
      every: formText(data, "every"),
      unit: formText(data, "unit"),
      time: formText(data, cadence === "weekly" ? "weeklyTime" : "dailyTime"),
      weekday: formText(data, "weekday"),
      at: formText(data, "at"),
    }, props.timezone);
    // Only an accepted routine clears the form; a refusal keeps the input.
    void routines.onCreate({ name, description: "", sessionId: props.bot.sessionId, prompt, schedule, enabled: true }).then((created) => {
      if (created) form.reset();
    });
  } catch (error) {
    routines.onFormError(error instanceof RoutineFormError ? error.message : "Could not read the routine form.");
  }
}

function renderRoutineForm(props: BotPanelProps, open: boolean) {
  const { routines } = props;
  const cadences = [["every", "Every"], ["daily", "Daily"], ["weekly", "Weekly"], ["once", "Once"]] as const;
  return html`<details class="bot-routine-form" ?open=${open}>
    <summary class="bot-routine-form__summary">${icons.plus}<span>Add routine</span></summary>
    <form class="bot-routine-form__body" novalidate @submit=${(event: SubmitEvent) => submitRoutine(event, props)}>
      <label class="bot-field"><span class="bot-field__label">Name</span>
        <input class="settings-input" name="name" type="text" maxlength="200" placeholder="Inbox digest" autocomplete="off" /></label>
      <label class="bot-field"><span class="bot-field__label">Prompt</span>
        <textarea class="settings-input" name="prompt" rows="3" maxlength="20000" placeholder="What should the bot do each time?"></textarea></label>
      <fieldset class="bot-field bot-routine-form__schedule">
        <legend class="bot-field__label">Schedule</legend>
        <div class="settings-segmented bot-routine-form__cadence">
          ${cadences.map(([value, label]) => html`<label class="settings-segmented__btn"><input type="radio" name="cadence" value=${value} ?checked=${value === "daily"} /><span>${label}</span></label>`)}
        </div>
        <div class="bot-routine-form__when bot-routine-form__when--every">
          <label class="bot-routine-form__inline"><span>Every</span><input class="settings-input" name="every" type="number" min="1" step="1" value="1" aria-label="Repeat every" /></label>
          <select class="settings-input" name="unit" aria-label="Interval unit">
            <option value="minutes">minutes</option><option value="hours" selected>hours</option><option value="days">days</option>
          </select>
        </div>
        <div class="bot-routine-form__when bot-routine-form__when--daily">
          <label class="bot-routine-form__inline"><span>At</span><input class="settings-input" name="dailyTime" type="time" value="08:00" aria-label="Daily time" /></label>
        </div>
        <div class="bot-routine-form__when bot-routine-form__when--weekly">
          <select class="settings-input" name="weekday" aria-label="Day of the week">
            ${ROUTINE_WEEKDAYS.map((day, index) => html`<option value=${String(index)} ?selected=${index === 1}>${day}</option>`)}
          </select>
          <label class="bot-routine-form__inline"><span>at</span><input class="settings-input" name="weeklyTime" type="time" value="09:00" aria-label="Weekly time" /></label>
        </div>
        <div class="bot-routine-form__when bot-routine-form__when--once">
          <label class="bot-routine-form__inline"><span>On</span><input class="settings-input" name="at" type="datetime-local" aria-label="Run once at" /></label>
        </div>
        <p class="bot-field__hint">Times are in ${props.timezone}.</p>
      </fieldset>
      ${routines.formError ? html`<p class="bot-field__error" role="alert">${routines.formError}</p>` : nothing}
      <div class="bot-routine-form__actions"><button type="submit" class="btn primary btn--sm" ?disabled=${routines.pending}>Add routine</button></div>
    </form>
  </details>`;
}

function renderRoutinesTab(props: BotPanelProps) {
  const { routines } = props;
  if (!routines.automation) {
    return routines.error
      ? html`<div class="bot-panel__state" role="alert">${routines.error} <button type="button" class="btn btn--sm" @click=${routines.onRetry}>Retry</button></div>`
      : html`<p class="bot-panel__state" role="status">Reading routines…</p>`;
  }
  const tasks = botRoutines(routines.automation, props.bot.sessionId);
  const runs = botRoutineRuns(routines.automation, props.bot.sessionId);
  return html`
    ${routines.actionError ? html`<p class="bot-field__error" role="alert">${routines.actionError}</p>` : nothing}
    ${tasks.length
      ? html`<ul class="bot-routines" aria-label="Routines">${tasks.map((task) => renderRoutine(task, props))}</ul>`
      : html`<p class="bot-panel__hint">No routines yet. A routine sends its prompt to ${props.bot.name}'s chat on a schedule, marked with its name.</p>`}
    ${renderRoutineForm(props, tasks.length === 0)}
    <section class="bot-panel__section" aria-labelledby=${`${props.id}-runs`}>
      <h3 class="bot-panel__heading" id=${`${props.id}-runs`}>Latest runs</h3>
      ${runs.length
        ? html`<ul class="bot-runs">${runs.map(renderRun)}</ul>`
        : html`<p class="bot-panel__hint">Runs appear here with their outcome.</p>`}
      ${runs.some(runIsActive) ? html`<p class="bot-panel__hint" role="status">A run is in progress.</p>` : nothing}
    </section>
    ${routines.automation && routines.error ? html`<p class="bot-field__error" role="alert">Refresh failed: ${routines.error}</p>` : nothing}`;
}

function renderMemoryLine(line: MemoryLine, props: BotPanelProps, depth: number): TemplateResult {
  const { memory } = props;
  if (line.message) {
    return html`<li class="bot-memory__item bot-memory__item--message" style=${`--memory-depth: ${depth}`}>
      <div class="bot-memory__message"><span class="bot-memory__address">message ${line.id}</span><span class="bot-memory__message-text">${line.text}</span></div>
    </li>`;
  }
  const zoom = memory.zoom.get(line.address);
  return html`<li class="bot-memory__item" style=${`--memory-depth: ${depth}`}>
    <button type="button" class="bot-memory__line" aria-expanded=${String(Boolean(zoom))}
      aria-label=${`${zoom ? "Collapse" : "Zoom into"} ${line.address}: ${line.text}`} @click=${() => memory.onZoom(line)}>
      <span class="bot-memory__chevron" aria-hidden="true">${icons.chevron}</span>
      <span class="bot-memory__address">${line.address}</span><span class="bot-memory__text">${line.text}</span>
    </button>
    ${zoom?.loading ? html`<p class="bot-memory__zoom-state" role="status">Opening ${line.address}…</p>` : nothing}
    ${zoom?.error ? html`<p class="bot-memory__zoom-state bot-field__error" role="alert">${zoom.error}</p>` : nothing}
    ${zoom?.lines.length ? html`<ol class="bot-memory__children">${zoom.lines.map((child) => renderMemoryLine(child, props, depth + 1))}</ol>` : nothing}
  </li>`;
}

function renderMemoryTab(props: BotPanelProps) {
  const { state } = props.memory;
  const status = state.status;
  if (!status) {
    return state.error
      ? html`<div class="bot-panel__state" role="alert">${state.error} <button type="button" class="btn btn--sm" @click=${props.memory.onRefresh}>Retry</button></div>`
      : html`<p class="bot-panel__state" role="status">Reading memory…</p>`;
  }
  const lines = state.lines ?? [];
  return html`
    <dl class="bot-memory__stats">
      <div><dt>Messages</dt><dd>${status.messages.toLocaleString()}</dd></div>
      <div><dt>View</dt><dd>${memoryBudgetLabel(status.viewBytes)}</dd></div>
      <div><dt>Lines</dt><dd>${status.viewLines.toLocaleString()}</dd></div>
      <div><dt>Pending summaries</dt><dd>${status.pending.toLocaleString()}</dd></div>
      <div class="bot-memory__usage"><dt>Summarizer since the gateway started</dt><dd title=${memoryUsageDetail(status.usage)}>${memoryUsageLabel(status.usage)}</dd></div>
    </dl>
    ${status.waiting ? html`<p class="bot-memory__notice" role="status">Summarizing memory…</p>` : nothing}
    ${status.failing ? html`<p class="bot-memory__notice bot-memory__notice--failing" role="alert">Summaries are failing${status.failing.node ? ` at ${status.failing.node}` : ""}: ${status.failing.error}. HUI keeps retrying.</p>` : nothing}
    ${state.error ? html`<p class="bot-field__error" role="alert">Refresh failed: ${state.error}</p>` : nothing}
    <div class="bot-memory__actions">
      <a class="btn btn--sm" href=${props.memory.pageUrl} target="_blank" rel="noopener">${icons.externalLink}<span>Open memory page</span></a>
      <button type="button" class="btn btn--sm btn--ghost" ?disabled=${state.loading} @click=${props.memory.onRefresh}>${icons.refresh}<span>${state.loading ? "Refreshing…" : "Refresh"}</span></button>
    </div>
    ${lines.length
      ? html`<ol class="bot-memory__view" aria-label="Memory view, oldest first">${lines.map((line) => renderMemoryLine(line, props, 0))}</ol>`
      : html`<p class="bot-panel__hint">Nothing remembered yet. Each message joins the memory; older ones are summarized into shorter lines you can zoom back into.</p>`}`;
}

export function renderBotPanel(props: BotPanelProps) {
  const tabpanel = `${props.id}-tabpanel`;
  return html`${props.sheet ? html`<button type="button" class="bot-panel__backdrop" tabindex="-1" aria-label="Close routines and memory" @click=${props.onClose}></button>` : nothing}
    <aside class="bot-panel ${props.sheet ? "bot-panel--sheet" : ""}" id=${props.id} aria-label=${`${props.bot.name}: routines and memory`}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Escape" || !props.sheet || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}>
      <header class="bot-panel__header">
        <div class="bot-panel__tabs" role="tablist" aria-label="Bot panel">
          ${BOT_PANEL_TABS.map((tab) => html`<button type="button" role="tab" class="bot-panel__tab" id=${panelTabId(props.id, tab)}
            aria-selected=${String(props.tab === tab)} aria-controls=${tabpanel} tabindex=${props.tab === tab ? "0" : "-1"}
            @click=${() => props.onTab(tab)} @keydown=${(event: KeyboardEvent) => onPanelTabKeydown(event, props)}>${PANEL_TAB_LABELS[tab]}${tab === "routines" && props.bot.routines ? html`<span class="bot-panel__count">${props.bot.routines}</span>` : nothing}</button>`)}
        </div>
        <button type="button" class="btn btn--ghost btn--icon chat-icon-btn bot-panel__close" aria-label="Close routines and memory" title="Close" @click=${props.onClose}>${icons.close}</button>
      </header>
      <div class="bot-panel__body" role="tabpanel" id=${tabpanel} aria-labelledby=${panelTabId(props.id, props.tab)} tabindex="0">
        ${props.tab === "routines" ? renderRoutinesTab(props) : renderMemoryTab(props)}
      </div>
    </aside>`;
}

/* ── New / Edit bot dialog ────────────────────────────────────────────────── */

/** The dialog's text fields; the pickers are controlled by the app. */
export type BotFormValues = Pick<BotDraft, "name" | "title" | "instructions" | "cwd" | "emoji">;

export type BotDialogProps = {
  mode: "create" | "edit";
  /** The bot as it was when the dialog opened; edits never chase a refresh. */
  bot?: BotView;
  pending: boolean;
  error: string;
  models: readonly RuntimeModel[];
  model: string;
  thinking: string;
  memoryModel: string;
  directorySuggestions: readonly string[];
  onDirectoryInput: (value: string) => void;
  onModel: (value: string) => void;
  onThinking: (value: string) => void;
  onMemoryModel: (value: string) => void;
  onSubmit: (values: BotFormValues) => void;
  onCancel: () => void;
  /** The Look: a face (shape and color) or an emoji. */
  look: BotDialogLook;
  /** The voice section: present while VoiceStudio is connected (HUI-18). */
  voice?: BotDialogVoice;
};

export type BotDialogLook = {
  kind: "face" | "emoji";
  shape: BotFaceShape;
  /** #rrggbb: a palette color, or a custom one the bot already has. */
  color: string;
  emoji: string;
  /** Seeds the preview's plush texture: the bot's, or any for a new bot. */
  seed: number;
  onKind: (kind: "face" | "emoji") => void;
  onShape: (shape: BotFaceShape) => void;
  onColor: (color: string) => void;
  onEmoji: (emoji: string) => void;
};

/** A shape's outline, small, for its picker chip. */
function shapeIcon(shape: BotFaceShape) {
  return html`<svg class="bot-dialog__shape-icon" viewBox="16 22 88 88" aria-hidden="true" focusable="false"><path d=${facePath(shape)}></path></svg>`;
}

/** Face (shape and color, previewed live) or Emoji. Native radio groups: Tab enters each group, arrows choose. */
function renderLookField(look: BotDialogLook, pending: boolean) {
  const face = look.kind === "face";
  const custom = BOT_FACE_COLORS.some((color) => color.hex === look.color) ? undefined : look.color;
  const swatches = [...BOT_FACE_COLORS.map((color) => ({ hex: color.hex, label: color.label })), ...(custom ? [{ hex: custom, label: `Custom ${custom}` }] : [])];
  const preview: Pick<BotView, "id" | "avatar"> & { avatar: BotAvatar } = { id: "preview", avatar: { color: look.color, shape: look.shape, ...(face ? {} : { emoji: look.emoji.trim() || "🤖" }) } };
  return html`<fieldset class="field input-dialog__field bot-dialog__look" data-face-stage>
    <legend class="bot-dialog__look-legend">Look</legend>
    <div class="settings-segmented bot-dialog__look-kind" role="radiogroup" aria-label="Look">
      ${([["face", "Face"], ["emoji", "Emoji"]] as const).map(([value, label]) => html`<label class="settings-segmented__btn">
        <input type="radio" name="look" value=${value} .checked=${look.kind === value} ?disabled=${pending} @change=${() => look.onKind(value)} /><span>${label}</span></label>`)}
    </div>
    <div class="bot-dialog__look-body">
      <div class="bot-dialog__look-preview">${face
        ? html`<span class="bot-avatar bot-avatar--lg bot-avatar--face" aria-hidden="true"><hui-bot-face size="lg" shape=${look.shape} .color=${look.color} .seed=${look.seed} state="idle"></hui-bot-face></span>`
        : renderBotAvatar(preview, "lg")}</div>
      ${face ? html`<div class="bot-dialog__look-pickers">
        <div class="bot-dialog__shapes" role="radiogroup" aria-label="Shape">
          ${BOT_FACE_SHAPES.map((shape) => html`<label class="bot-dialog__chip" style=${`--bot-look-color: ${look.color}`}>
            <input type="radio" name="shape" value=${shape} .checked=${look.shape === shape} ?disabled=${pending} @change=${() => look.onShape(shape)} />
            ${shapeIcon(shape)}<span>${BOT_FACE_SHAPE_LABELS[shape]}</span></label>`)}
        </div>
        <div class="bot-dialog__colors" role="radiogroup" aria-label="Color">
          ${swatches.map((color) => html`<label class="bot-dialog__swatch" style=${`--swatch: ${color.hex}`} title=${color.label}>
            <input type="radio" name="color" value=${color.hex} aria-label=${color.label} .checked=${look.color === color.hex} ?disabled=${pending} @change=${() => look.onColor(color.hex)} /></label>`)}
        </div>
      </div>` : html`<label class="bot-dialog__emoji"><span class="bot-field__label">Emoji</span>
        <input class="settings-input" name="emoji" type="text" maxlength="16" autocomplete="off" placeholder="🤖" .value=${look.emoji} ?disabled=${pending}
          @input=${(event: Event) => look.onEmoji((event.target as HTMLInputElement).value)} /></label>`}
    </div>
    <span class="bot-field__hint">${face
      ? "Its face shows what it is doing: thinking, using tools, waiting for you, listening and speaking on calls."
      : "One emoji instead of a face."}</span>
  </fieldset>`;
}

export type BotDialogVoice = {
  voices: readonly VoiceProfile[];
  loading: boolean;
  error: string;
  profile: string;
  speed: number;
  /** One of Whisper's language codes, or "" for Auto (VoiceStudio detects it). */
  language: string;
  /** A preview of the chosen voice is loading or playing. */
  previewing: boolean;
  onProfile: (value: string) => void;
  onSpeed: (value: number) => void;
  onLanguage: (value: string) => void;
  /** Plays a sentence in the chosen voice, speed and language, or stops it. */
  onPreview: () => void;
};

/** Every language's English name and code, read once: they never change while HUI runs. */
let languageChoices: ReturnType<typeof languageOptions> | undefined;

function renderVoiceField(voice: BotDialogVoice, pending: boolean) {
  languageChoices ??= languageOptions();
  return html`<div class="field input-dialog__field bot-dialog__voice"><span>Voice</span>
    <div class="bot-dialog__voice-row">
      ${renderPicker({ label: "Voice", value: voice.profile, disabled: pending, searchable: true, searchPlaceholder: "Search voices",
        options: voiceOptions(voice.voices, voice.profile), onChange: voice.onProfile })}
      <button type="button" class="btn btn--sm bot-dialog__preview" aria-pressed=${String(voice.previewing)} ?disabled=${pending}
        @click=${voice.onPreview}>${voice.previewing ? "Stop" : "Preview"}</button>
    </div>
    <label class="bot-dialog__speed"><span>Speed</span>
      <input type="range" min=${String(VOICE_LIMITS.speedMin)} max=${String(VOICE_LIMITS.speedMax)} step="0.05" .value=${String(voice.speed)}
        aria-valuetext=${speedLabel(voice.speed)} ?disabled=${pending}
        @input=${(event: Event) => voice.onSpeed(Number((event.target as HTMLInputElement).value))} />
      <output>${speedLabel(voice.speed)}</output></label>
    <span class="bot-field__hint" role=${voice.error ? "alert" : nothing}>${voice.error || (voice.loading ? "Reading VoiceStudio's voices…" : "How the bot sounds when it reads aloud and on calls, through your VoiceStudio.")}</span>
  </div>
  <div class="field input-dialog__field bot-dialog__language"><span>Language</span>
    ${renderPicker({ label: "Language", value: voice.language, disabled: pending, searchable: true, searchPlaceholder: "Search languages",
      options: languageChoices, onChange: voice.onLanguage })}
    <span class="bot-field__hint">What VoiceStudio listens for in voice notes and calls and speaks in. Auto detects it each time. Nothing is translated: the bot answers in the language its instructions ask for.</span>
  </div>`;
}

const THINKING_LABELS: Record<(typeof BOT_THINKING_LEVELS)[number], string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };
/** "Gateway default" sends "": a new bot leaves the choice to the gateway, an
 * edited one goes back to it (the model and thinking level a new chat gets). */
const THINKING_CHOICES: readonly (readonly [string, string])[] = [["", "Gateway default"], ...BOT_THINKING_LEVELS.map((level) => [level, THINKING_LABELS[level]] as const)];

/** `empty` labels the default choice, the empty value. */
function modelOptions(models: readonly RuntimeModel[], empty: string, current: string) {
  const options = [{ value: "", label: empty }, ...models.map((model) => ({ value: `${model.provider}/${model.id}`, label: model.name, description: model.provider }))];
  // A model no longer in the catalog still shows what the bot runs on.
  return current && !options.some((option) => option.value === current) ? [...options, { value: current, label: current }] : options;
}

export function renderBotDialog(props: BotDialogProps) {
  const editing = props.mode === "edit" ? props.bot : undefined;
  const titleId = "bot-dialog-title";
  return html`<dialog class="hui-modal-dialog group-action-dialog bot-dialog" aria-labelledby=${titleId}
    @cancel=${(event: Event) => { event.preventDefault(); if (!props.pending) props.onCancel(); }}>
    <form class="exec-approval-card bot-dialog__card" method="dialog" novalidate @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      props.onSubmit({
        name: formText(data, "name"),
        title: formText(data, "title"),
        instructions: formText(data, "instructions"),
        cwd: formText(data, "cwd"),
        emoji: formText(data, "emoji"),
      });
    }}>
      <div class="exec-approval-title" id=${titleId}>${editing ? `Edit ${editing.name}` : "New bot"}</div>
      <div class="exec-approval-sub">${editing
        ? "Changes apply to the bot's next turn. Its chat and memory stay as they are."
        : "A bot keeps one permanent chat with its own model and memory. Say hi once it is created."}</div>
      <label class="field input-dialog__field bot-dialog__name"><span>Name</span>
        <input class="settings-input" name="name" type="text" required maxlength=${BOT_LIMITS.name} autocomplete="off" placeholder="Scout" .value=${editing?.name ?? ""} ?disabled=${props.pending} /></label>
      ${renderLookField(props.look, props.pending)}
      <label class="field input-dialog__field"><span>Title</span>
        <input class="settings-input" name="title" type="text" maxlength=${BOT_LIMITS.title} autocomplete="off" placeholder="Research assistant" .value=${editing?.title ?? ""} ?disabled=${props.pending} /></label>
      <label class="field input-dialog__field"><span>Instructions</span>
        <textarea class="settings-input bot-dialog__instructions" name="instructions" rows="5" maxlength=${BOT_LIMITS.instructions} placeholder="Who the bot is, what it looks after and how it should work." .value=${editing?.instructions ?? ""} ?disabled=${props.pending}></textarea></label>
      <div class="bot-dialog__row">
        <div class="field input-dialog__field"><span>Model</span>
          ${renderPicker({ label: "Model", value: props.model, disabled: props.pending, searchable: true, searchPlaceholder: "Search models",
            options: modelOptions(props.models, "Gateway default", props.model), onChange: props.onModel })}</div>
        <div class="field input-dialog__field"><span>Thinking</span>
          ${renderPicker({ label: "Thinking", value: props.thinking, disabled: props.pending,
            options: THINKING_CHOICES.map(([value, label]) => ({ value, label })), onChange: props.onThinking })}</div>
      </div>
      <div class="field input-dialog__field"><span>Memory model</span>
        ${renderPicker({ label: "Memory model", value: props.memoryModel, disabled: props.pending, searchable: true, searchPlaceholder: "Search models",
          options: modelOptions(props.models, "Same as bot", props.memoryModel), onChange: props.onMemoryModel })}
        <span class="bot-field__hint">Writes the summaries that let the chat go on forever. A fast, cheap model is enough.</span></div>
      ${props.voice ? renderVoiceField(props.voice, props.pending) : nothing}
      <div class="field input-dialog__field"><label for="bot-dialog-cwd">Workspace directory</label>
        ${renderDirectoryPicker({ id: "bot-dialog-cwd", label: "Workspace directory", value: editing?.cwd ?? "", suggestions: props.directorySuggestions, onInput: props.onDirectoryInput, inputClass: "settings-input", externalLabel: true, placeholder: "Automatic" })}
        <span class="bot-field__hint">${editing ? "Can change only while the bot is idle." : "Leave empty for a private folder HUI creates for this bot."}</span></div>
      ${props.error ? html`<p class="group-action-dialog__error bot-field__error" role="alert">${props.error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn primary" ?disabled=${props.pending}>${props.pending ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create bot"}</button>
        <button type="button" class="btn" ?disabled=${props.pending} @click=${props.onCancel}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}

/* ── archive confirmation ─────────────────────────────────────────────────── */

export function renderBotArchiveDialog(bot: BotView, pending: boolean, error: string, onConfirm: () => void, onCancel: () => void) {
  return html`<dialog class="hui-modal-dialog group-action-dialog bot-archive-dialog" aria-labelledby="bot-archive-title"
    @cancel=${(event: Event) => { event.preventDefault(); if (!pending) onCancel(); }}>
    <form class="exec-approval-card" method="dialog" @submit=${(event: SubmitEvent) => { event.preventDefault(); onConfirm(); }}>
      <div class="exec-approval-title" id="bot-archive-title">Archive ${bot.name}?</div>
      <div class="exec-approval-sub">${bot.name} leaves the roster and its routines are disabled. Its chat, memory and workspace stay on this machine, and it can be restored.</div>
      ${error ? html`<p class="group-action-dialog__error" role="alert">${error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn danger" ?disabled=${pending}>${pending ? "Archiving…" : "Archive"}</button>
        <button type="button" class="btn bot-archive-cancel" ?disabled=${pending} @click=${onCancel}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}

/* ── delete confirmation ──────────────────────────────────────────────────── */

/** Deleting cannot be undone, so the dialog says what goes and what stays, and Cancel has the focus. */
export function renderBotDeleteDialog(bot: BotView, pending: boolean, error: string, onConfirm: () => void, onCancel: () => void) {
  return html`<dialog class="hui-modal-dialog group-action-dialog bot-delete-dialog" aria-labelledby="bot-delete-title"
    @cancel=${(event: Event) => { event.preventDefault(); if (!pending) onCancel(); }}>
    <form class="exec-approval-card" method="dialog" @submit=${(event: SubmitEvent) => { event.preventDefault(); onConfirm(); }}>
      <div class="exec-approval-title" id="bot-delete-title">Delete ${bot.name}?</div>
      <div class="exec-approval-sub">${bot.name} and its routines are deleted for good; it cannot be restored. Its chat stays in Pi's Durable store, which HUI no longer opens, and the files in its workspace stay on this machine.</div>
      ${error ? html`<p class="group-action-dialog__error" role="alert">${error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn danger" ?disabled=${pending}>${pending ? "Deleting…" : "Delete"}</button>
        <button type="button" class="btn bot-delete-cancel" ?disabled=${pending} @click=${onCancel}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}
