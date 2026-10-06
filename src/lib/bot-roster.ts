/**
 * Pure presentation rules for the sidebar's Bots tab: which bots the roster
 * shows and in what order, how a row reads, and the browser-local choices
 * (selected tab, side panel) that are reading preferences, not gateway state.
 */
import type { BotView } from "./bots.ts";

/* ── sidebar tab strip ────────────────────────────────────────────────────── */

export type SidebarTab = "sessions" | "bots";
export const SIDEBAR_TABS: readonly SidebarTab[] = ["sessions", "bots"];
export const SIDEBAR_TAB_KEY = "hui.sidebar-tab";

export function normalizeSidebarTab(value: unknown): SidebarTab {
  return value === "bots" ? "bots" : "sessions";
}

export function readSidebarTab(): SidebarTab {
  try {
    return normalizeSidebarTab(localStorage.getItem(SIDEBAR_TAB_KEY));
  } catch {
    return "sessions";
  }
}

export function writeSidebarTab(tab: SidebarTab) {
  try { localStorage.setItem(SIDEBAR_TAB_KEY, tab); } catch { /* Keep the in-memory choice if storage is unavailable. */ }
}

/** WAI-ARIA tabs with automatic activation: arrows wrap, Home/End jump.
 * Undefined for keys a tab strip does not own. */
export function tabAfterKey<Tab extends string>(tabs: readonly Tab[], current: Tab, key: string): Tab | undefined {
  const index = Math.max(0, tabs.indexOf(current));
  if (key === "ArrowRight" || key === "ArrowDown") return tabs[(index + 1) % tabs.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return tabs[(index - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs.at(-1);
  return undefined;
}

/* ── side panel ───────────────────────────────────────────────────────────── */

export type BotPanelTab = "routines" | "memory";
export const BOT_PANEL_TABS: readonly BotPanelTab[] = ["routines", "memory"];
export type BotPanelState = { open: boolean; tab: BotPanelTab };
export const BOT_PANEL_KEY = "hui.bot-panel";
export const DEFAULT_BOT_PANEL: Readonly<BotPanelState> = { open: true, tab: "routines" };

export function normalizeBotPanel(value: unknown): BotPanelState {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    open: raw["open"] !== false,
    tab: raw["tab"] === "memory" ? "memory" : "routines",
  };
}

export function readBotPanel(): BotPanelState {
  try {
    return normalizeBotPanel(JSON.parse(localStorage.getItem(BOT_PANEL_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_BOT_PANEL };
  }
}

export function writeBotPanel(panel: BotPanelState) {
  try { localStorage.setItem(BOT_PANEL_KEY, JSON.stringify(panel)); } catch { /* Keep the in-memory choice if storage is unavailable. */ }
}

/* ── roster ───────────────────────────────────────────────────────────────── */

/** When the bot's chat last moved; its creation for a bot never spoken to. */
export function botActivityAt(bot: Pick<BotView, "lastMessage" | "updatedAt" | "createdAt">): number {
  for (const value of [bot.lastMessage?.at, bot.updatedAt, bot.createdAt]) {
    const at = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(at)) return at;
  }
  return 0;
}

/** Name, handle (with or without its @) and title, ignoring case. */
export function botMatches(bot: Pick<BotView, "name" | "handle" | "title">, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase().replace(/^@/u, "");
  if (!needle) return true;
  return [bot.name, bot.handle, bot.title ?? ""].some((value) => value.toLocaleLowerCase().includes(needle));
}

export type RosterOptions = { query: string; showHidden: boolean };

/** Latest activity first; the name breaks ties so the order is stable. */
function byActivity(a: BotView, b: BotView): number {
  return botActivityAt(b) - botActivityAt(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** The rows the Bots tab lists: archived bots never, hidden ones on request,
 * latest activity first. */
export function rosterBots(bots: readonly BotView[], options: RosterOptions): BotView[] {
  return bots
    .filter((bot) => !bot.archived && (options.showHidden || !bot.hidden) && botMatches(bot, options.query))
    .toSorted(byActivity);
}

export function hiddenBotCount(bots: readonly BotView[]): number {
  return bots.filter((bot) => bot.hidden && !bot.archived).length;
}

/** What Show archived lists, hidden or not: the archived bots the search
 * matches, latest activity first. */
export function archivedRosterBots(bots: readonly BotView[], query: string): BotView[] {
  return bots.filter((bot) => bot.archived && botMatches(bot, query)).toSorted(byActivity);
}

export function archivedBotCount(bots: readonly BotView[]): number {
  return bots.filter((bot) => bot.archived).length;
}

/** The row's second line: the latest message, else the bot's role. */
export function botPreview(bot: Pick<BotView, "lastMessage" | "title">): string {
  if (bot.lastMessage?.text) return `${bot.lastMessage.role === "user" ? "You: " : ""}${bot.lastMessage.text}`;
  return bot.title || "No messages yet";
}

/** Chat-list time: "now", "5m", "3h", "2d", then a short date. */
export function compactRelativeTime(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export type BotActivity = "running" | "waiting" | "summarizing" | "error" | "away" | "idle";

/** What the row's leading indicator says. A pending question outranks
 * everything; memory waits read as thinking because the turn has not started. */
export function botActivity(bot: Pick<BotView, "status" | "memory">): BotActivity {
  if (bot.status === "waiting") return "waiting";
  if (bot.status === "error") return "error";
  if (bot.status === "reconnecting" || bot.status === "disconnected") return "away";
  if (bot.memory?.waiting) return "summarizing";
  if (bot.status === "running" || bot.status === "starting") return "running";
  return "idle";
}

const ACTIVITY_LABELS: Record<BotActivity, string> = {
  running: "active now",
  waiting: "waiting for your answer",
  summarizing: "summarizing memory",
  error: "failed",
  away: "unreachable",
  idle: "idle",
};

export function botActivityLabel(bot: Pick<BotView, "status" | "memory">): string {
  return ACTIVITY_LABELS[botActivity(bot)];
}

export function botAccessibleName(bot: BotView): string {
  return [
    bot.name,
    ...(bot.title ? [bot.title] : []),
    ...(bot.worker ? [`on ${bot.worker.name}`] : []),
    botActivityLabel(bot),
    ...(bot.unread ? ["unread"] : []),
    ...(bot.hidden ? ["hidden"] : []),
    ...(bot.memory?.failing ? ["memory summaries failing"] : []),
  ].join(", ");
}
