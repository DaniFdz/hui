/**
 * The Bots tab: the sidebar roster, a bot's side panel (Routines | Memory |
 * Soul | Settings, the last in `bot-settings.ts`) and the archive and delete
 * confirmations. Rendering only; every read and write is a prop callback owned
 * by `hui-app.ts`. The bot's chat is the ordinary session pane (`renderHome`)
 * with a bot header, not a fork.
 */
import { html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { icons } from "../lib/icons.ts";
import { closeDropdownOnEscape, labelDropdown } from "../lib/web-awesome.ts";
import { navigationPath } from "../lib/navigation.ts";
import type { BotMemoryStatus, BotView, NewBotOptions } from "../lib/bots.ts";
import { BOT_LIMITS, botLook } from "../../shared/bots.ts";
import { rosterFaceState, type BotFaceSize, type BotFaceState } from "../lib/bot-face.ts";
import "../components/bot-face.ts";
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
  botSettingsShortcutLabel,
  BOT_PANEL_TABS,
  type BotPanelTab,
} from "../lib/bot-roster.ts";
import { botRoutineRuns, botRoutines, routineSchedule, RoutineFormError, ROUTINE_WEEKDAYS } from "../lib/bot-routines.ts";
import { memoryBudgetLabel, memoryUsageDetail, memoryUsageLabel, type MemoryLine } from "../lib/bot-memory.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { describeRoutineSchedule, formatTimestamp, runIsActive } from "./settings-automation.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";
import { renderBotSettings, type BotSettingsProps } from "./bot-settings.ts";

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
  /** Creates a bot named "New Bot" at once and opens its chat. */
  onNew: (options?: NewBotOptions) => void;
  /** A bot is being created: New bot waits for it. */
  creating: boolean;
  onEdit: (bot: BotView) => void;
  onSetHidden: (bot: BotView, hidden: boolean) => void;
  onArchive: (bot: BotView) => void;
  onToggleShowHidden: () => void;
  onToggleShowArchived: () => void;
  onRestore: (bot: BotView) => void;
  /** Asks before deleting a bot for good, active or archived. */
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
            if (action === "delete") { drawer.dialog(event); props.onDelete(bot); }
          }}>
          <button slot="trigger" type="button" class="session-action session-row__menu-btn" aria-label=${`Actions for ${bot.name}`} ?disabled=${props.pendingId === bot.id}>
            <span class="session-row__more-icon" aria-hidden="true">${icons.moreHorizontal}</span>
          </button>
          <wa-dropdown-item value="edit" class="session-menu__item"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.edit}</span><span class="session-menu__text">Edit bot…</span></wa-dropdown-item>
          <wa-dropdown-item value="hide" class="session-menu__item"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.eye}</span><span class="session-menu__text">${bot.hidden ? "Unhide" : "Hide"}</span></wa-dropdown-item>
          <div class="session-menu__separator" role="separator"></div>
          <wa-dropdown-item value="archive" variant="danger" class="session-menu__item session-menu__item--destructive"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.box}</span><span class="session-menu__text">Archive…</span></wa-dropdown-item>
          <wa-dropdown-item value="delete" variant="danger" class="session-menu__item session-menu__item--destructive"><span slot="icon" class="session-menu__icon" aria-hidden="true">${icons.trash}</span><span class="session-menu__text">Delete…</span></wa-dropdown-item>
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
      <button type="button" class="btn btn--sm bot-roster__new" ?disabled=${props.creating} aria-busy=${props.creating ? "true" : "false"}
        @click=${(event: Event) => { drawer.navigate(event); props.onNew(); }}>${icons.plus}<span>${props.creating ? "Creating…" : "New bot"}</span></button>
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

/** The Soul tab's read of SOUL.md: `soul` is undefined until read, null while the bot has none. */
export type BotSoulState = { loading: boolean; error: string; soul?: string | null };

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
  soul: {
    state: BotSoulState;
    /** The editor's text; undefined while SOUL.md is only shown. */
    draft: string | undefined;
    saving: boolean;
    saveError: string;
    /** Opens the editor on SOUL.md, or empty for Write it yourself. */
    onEdit: () => void;
    onDraft: (text: string) => void;
    onSave: () => void;
    onCancel: () => void;
    onRetry: () => void;
  };
  /** The Settings tab: everything but the bot, the ids and its face, which the panel supplies. */
  settings: Omit<BotSettingsProps, "bot" | "id" | "face">;
};

const PANEL_TAB_LABELS: Record<BotPanelTab, string> = { routines: "Routines", memory: "Memory", soul: "Soul", settings: "Settings" };

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

/** SOUL.md's editor: a textarea with Save and Cancel (Escape), the count against the limit, errors inline. */
function renderSoulEditor(props: BotPanelProps, draft: string) {
  const { soul } = props;
  const length = draft.trim().length;
  const over = length > BOT_LIMITS.soul;
  return html`<form class="bot-soul__editor" novalidate
    @submit=${(event: SubmitEvent) => { event.preventDefault(); if (!over) soul.onSave(); }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key !== "Escape" || soul.saving) return;
      event.preventDefault();
      event.stopPropagation();
      soul.onCancel();
    }}>
    <label class="bot-field"><span class="bot-field__label">SOUL.md</span>
      <textarea class="settings-input bot-soul__textarea" name="soul" rows="16" spellcheck="true" .value=${draft} ?disabled=${soul.saving}
        aria-invalid=${over ? "true" : "false"} placeholder="# Who I am"
        @input=${(event: Event) => soul.onDraft((event.currentTarget as HTMLTextAreaElement).value)}></textarea></label>
    <p class="bot-field__hint ${over ? "bot-field__error" : ""}" aria-live="polite">${length
      ? `${length.toLocaleString()} of ${BOT_LIMITS.soul.toLocaleString()} characters. ${props.bot.name} reads it from its next turn.`
      : `Saved empty, SOUL.md goes and ${props.bot.name} asks what you expect from it again.`}</p>
    ${soul.saveError ? html`<p class="bot-field__error" role="alert">${soul.saveError}</p>` : nothing}
    <div class="bot-soul__actions">
      <button type="submit" class="btn primary btn--sm" ?disabled=${soul.saving || over}>${soul.saving ? "Saving…" : "Save"}</button>
      <button type="button" class="btn btn--sm" ?disabled=${soul.saving} @click=${soul.onCancel}>Cancel</button>
    </div>
  </form>`;
}

/** SOUL.md as markdown with Edit; while the bot has none, what its first conversation does, and Write it yourself. */
function renderSoulTab(props: BotPanelProps) {
  const { soul } = props;
  const { state } = soul;
  const name = props.bot.name;
  if (soul.draft !== undefined) return renderSoulEditor(props, soul.draft);
  if (state.soul === undefined) {
    return state.error
      ? html`<div class="bot-panel__state" role="alert">${state.error} <button type="button" class="btn btn--sm" @click=${soul.onRetry}>Retry</button></div>`
      : html`<p class="bot-panel__state" role="status">Reading ${name}'s soul…</p>`;
  }
  const refreshFailed = state.error ? html`<p class="bot-field__error" role="alert">Refresh failed: ${state.error}</p>` : nothing;
  if (state.soul === null) {
    return html`<div class="bot-soul__empty">
      <p class="bot-soul__empty-title">${name} writes its soul in your first conversation</p>
      <p class="bot-panel__hint">It asks what you expect from it, a question or two at a time, then saves who it is, what it looks after, how it works and when it reaches out to you as its SOUL.md. Later, just tell it what to change.</p>
      <button type="button" class="btn btn--sm bot-soul__write" @click=${soul.onEdit}>${icons.edit}<span>Write it yourself</span></button>
    </div>
    ${refreshFailed}`;
  }
  return html`<div class="bot-soul__toolbar">
      <span class="bot-soul__file">SOUL.md</span>
      <button type="button" class="btn btn--sm bot-soul__edit" aria-label=${`Edit ${name}'s soul`} @click=${soul.onEdit}>${icons.edit}<span>Edit</span></button>
    </div>
    ${state.soul.length > BOT_LIMITS.soul
      ? html`<p class="bot-memory__notice" role="status">SOUL.md has ${state.soul.length.toLocaleString()} characters; ${name} reads only the first ${BOT_LIMITS.soul.toLocaleString()}.</p>`
      : nothing}
    <div class="chat-text bot-soul__body">${renderMarkdown(state.soul)}</div>
    ${refreshFailed}
    <p class="bot-panel__hint">${name} follows this every turn. Ask it to change something and it updates SOUL.md and tells you.</p>`;
}

function renderPanelTab(props: BotPanelProps) {
  switch (props.tab) {
    case "routines": return renderRoutinesTab(props);
    case "memory": return renderMemoryTab(props);
    case "soul": return renderSoulTab(props);
    // Keyed: another bot's tab starts afresh (its look closed, nothing typed carried over).
    case "settings": return keyed(props.bot.id, renderBotSettings({ ...props.settings, bot: props.bot, id: props.id, face: (avatar) => renderBotAvatar({ id: props.bot.id, avatar }, "md") }));
  }
}

/** The panel: a header with the bot's name and Close, then its tabs on a full-width row of their own (as the
 * sidebar's Agents | Bots), which leaves room for more tabs than a segmented control beside Close would. */
export function renderBotPanel(props: BotPanelProps) {
  const tabpanel = `${props.id}-tabpanel`;
  return html`${props.sheet ? html`<button type="button" class="bot-panel__backdrop" tabindex="-1" aria-label="Close the bot panel" @click=${props.onClose}></button>` : nothing}
    <aside class="bot-panel ${props.sheet ? "bot-panel--sheet" : ""}" id=${props.id} aria-label=${`${props.bot.name}: bot panel`}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Escape" || !props.sheet || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}>
      <header class="bot-panel__header">
        <h2 class="bot-panel__title">${props.bot.name}</h2>
        <button type="button" class="btn btn--ghost btn--icon chat-icon-btn bot-panel__close" aria-label="Close the bot panel" title="Close" @click=${props.onClose}>${icons.close}</button>
      </header>
      <div class="bot-panel__tabs" role="tablist" aria-label=${`${props.bot.name}'s panel`}>
        ${BOT_PANEL_TABS.map((tab) => html`<button type="button" role="tab" class="bot-panel__tab" id=${panelTabId(props.id, tab)} data-tab=${tab}
          aria-selected=${String(props.tab === tab)} aria-controls=${tabpanel} tabindex=${props.tab === tab ? "0" : "-1"}
          title=${tab === "settings" ? `Settings (${botSettingsShortcutLabel()})` : nothing}
          @click=${() => props.onTab(tab)} @keydown=${(event: KeyboardEvent) => onPanelTabKeydown(event, props)}>${PANEL_TAB_LABELS[tab]}${tab === "routines" && props.bot.routines ? html`<span class="bot-panel__count">${props.bot.routines}</span>` : nothing}</button>`)}
      </div>
      <div class="bot-panel__body" role="tabpanel" id=${tabpanel} aria-labelledby=${panelTabId(props.id, props.tab)} tabindex="0">
        ${renderPanelTab(props)}
      </div>
    </aside>`;
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
      <div class="exec-approval-sub">${bot.name} is deleted for good: its chat leaves HUI, and its routines, its memory and its folder (SOUL.md and every file in it) go. A workspace you chose for it stays. This cannot be undone.</div>
      ${error ? html`<p class="group-action-dialog__error" role="alert">${error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn danger" ?disabled=${pending}>${pending ? "Deleting…" : "Delete"}</button>
        <button type="button" class="btn bot-delete-cancel" ?disabled=${pending} @click=${onCancel}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}
