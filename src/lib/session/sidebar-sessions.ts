/**
 * The sidebar's projection of the session registry: grouping, sorting, filtering, the parent/child tree and
 * custom group order and Run status's child-session index, plus the per-browser view options in localStorage. Every projection is view-only; the
 * registry's groups and order are changed only through its API. Run status's own Sessions section also merges in
 * what a bot's chat started through `create_session`, by the same projection discipline.
 */
import { DEFAULT_SESSION_STAGE, isSessionStage, stageRank } from "../kanban.ts";
import type { SessionGroup, SessionStatus, SessionView } from "../../api/sessions.ts";
import { sessionGroupLabel } from "./sessions.ts";
import { sessionTreeIds } from "./tree.ts";

export type SidebarSessionOptions = {
  groupBy: "custom" | "project" | "none";
  sortBy: "updated" | "created" | "title" | "stage";
  status: "all" | SessionStatus;
  hideEmpty: "filtering" | "always" | "never";
};

export const DEFAULT_SIDEBAR_SESSION_OPTIONS: Readonly<SidebarSessionOptions> = {
  groupBy: "custom", sortBy: "updated", status: "all", hideEmpty: "filtering",
};

export const SIDEBAR_SESSION_OPTIONS_KEY = "hui.sidebar-session-options";

/** Browser reading preferences only; the registry's labels and order stay intact. */
export function normalizeSidebarSessionOptions(value: unknown): SidebarSessionOptions {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    groupBy: raw["groupBy"] === "project" || raw["groupBy"] === "none" ? raw["groupBy"] : "custom",
    sortBy: raw["sortBy"] === "created" || raw["sortBy"] === "title" || raw["sortBy"] === "stage" ? raw["sortBy"] : "updated",
    status: (["idle", "running", "waiting", "starting", "error", "reconnecting", "disconnected"] as const).find((status) => status === raw["status"]) ?? "all",
    hideEmpty: raw["hideEmpty"] === "always" || raw["hideEmpty"] === "never" ? raw["hideEmpty"] : "filtering",
  };
}

export function readSidebarSessionOptions(): SidebarSessionOptions {
  try {
    return normalizeSidebarSessionOptions(JSON.parse(localStorage.getItem(SIDEBAR_SESSION_OPTIONS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_SIDEBAR_SESSION_OPTIONS };
  }
}

export function writeSidebarSessionOptions(options: SidebarSessionOptions) {
  try { localStorage.setItem(SIDEBAR_SESSION_OPTIONS_KEY, JSON.stringify(options)); } catch { /* Keep the in-memory choice if storage is unavailable. */ }
}

export type SidebarSessionGroup = SessionGroup & {
  key: string;
  kind: SidebarSessionOptions["groupBy"];
};

const CHILD_STATUS_ORDER: Partial<Record<SessionStatus, number>> = { running: 0, waiting: 1, error: 2, idle: 3 };

/** A child or started session's place in Run status's Sessions section: running first, then waiting, error, idle,
 * everything else last. Shared by `childSessionsByParent`'s sibling sort and `mergeChildAndStartedSessions`'s merge
 * sort so neither keeps its own copy of the ranking. */
function childStatusRank(status: SessionStatus): number {
  return CHILD_STATUS_ORDER[status] ?? 4;
}

/** Index ordinary, unarchived children once per registry projection, never once per parent or streamed frame.
 * Stable sibling order breaks status ties; helpers belong in Helpers, not Sessions. */
export function childSessionsByParent(groups: readonly SessionGroup[]): ReadonlyMap<string, readonly SessionView[]> {
  const children = new Map<string, SessionView[]>();
  for (const group of groups) {
    for (const session of group.sessions) {
      const parentId = session.parentId;
      if (!parentId || session.subagent || session.archived) continue;
      const siblings = children.get(parentId);
      if (siblings) siblings.push(session);
      else children.set(parentId, [session]);
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => childStatusRank(a.status) - childStatusRank(b.status));
  }
  return children;
}

/** Index every non-archived, non-subagent, ordinary session a bot started (its view carries `createdBy`) by that
 * bot's id, once per registry projection. A bot's own forever chat is excluded defensively too, though its view can
 * never carry both `createdBy` and `bot` (the server's `!bot` guard on `createdBy`). */
export function startedSessionsByBot(groups: readonly SessionGroup[]): ReadonlyMap<string, readonly SessionView[]> {
  const started = new Map<string, SessionView[]>();
  for (const group of groups) {
    for (const session of group.sessions) {
      const botId = session.createdBy?.id;
      if (!botId || session.archived || session.subagent || session.bot) continue;
      const siblings = started.get(botId);
      if (siblings) siblings.push(session);
      else started.set(botId, [session]);
    }
  }
  for (const siblings of started.values()) {
    siblings.sort((a, b) => childStatusRank(a.status) - childStatusRank(b.status));
  }
  return started;
}

/** A parent's own children plus whatever else a bot's chat started, as one Sessions list: the parent's own entry
 * wins a clash by id, then every row sorts by status, newest-updated first and finally by id so two redraws of the
 * same data never reorder. An empty `started` returns `children` unchanged, so a non-bot chat's identity is kept. */
export function mergeChildAndStartedSessions(
  children: readonly SessionView[], started: readonly SessionView[],
): readonly SessionView[] {
  if (!started.length) return children;
  const byId = new Map(children.map((session) => [session.id, session]));
  for (const session of started) if (!byId.has(session.id)) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) =>
    childStatusRank(a.status) - childStatusRank(b.status) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Only an open Run status draws rows; keep the cap separate from the complete live-work count. */
export function runStatusChildRows(children: readonly SessionView[]): { rows: readonly SessionView[]; more: number } {
  return { rows: children.slice(0, 8), more: Math.max(0, children.length - 8) };
}

export type SidebarSessionTreeRow = { session: SessionView; depth: number; hasChildren: boolean; collapsed: boolean };

/** Keeps spawned sessions immediately below their parent while preserving the
 * sort order already chosen for each sibling set. Missing parents and cycles
 * degrade to ordinary root rows instead of hiding a conversation. With `fold`,
 * only the selected session's ancestors show their children, so a selected
 * subagent stays visible, and `toggled` flips that default; without it every
 * tree is expanded. */
export function sessionTreeRows(sessions: readonly SessionView[], fold?: { selectedId: string; toggled: ReadonlySet<string> }): SidebarSessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const openByDefault = new Set<string>();
  for (let id = fold && byId.get(fold.selectedId)?.parentId; id && byId.has(id) && !openByDefault.has(id); id = byId.get(id)!.parentId) openByDefault.add(id);
  const folded = (id: string) => !!fold && openByDefault.has(id) === fold.toggled.has(id);
  const children = new Map<string, SessionView[]>();
  for (const session of sessions) {
    if (!session.parentId || !byId.has(session.parentId) || session.parentId === session.id) continue;
    const list = children.get(session.parentId) ?? [];
    list.push(session);
    children.set(session.parentId, list);
  }
  const output: SidebarSessionTreeRow[] = [];
  const visited = new Set<string>();
  const append = (session: SessionView, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    output.push({ session, depth, hasChildren: false, collapsed: false });
    for (const child of children.get(session.id) ?? []) append(child, depth + 1);
  };
  for (const session of sessions) {
    if (!session.parentId || !byId.has(session.parentId)) append(session, 0);
  }
  for (const session of sessions) append(session, 0);
  // Project visibility only after traversal so hidden descendants cannot
  // reappear as orphan roots in the cycle-recovery pass.
  let hiddenBelow: number | undefined;
  return output.filter((row, index) => {
    row.hasChildren = (output[index + 1]?.depth ?? 0) > row.depth;
    if (hiddenBelow !== undefined && row.depth > hiddenBelow) return false;
    row.collapsed = row.hasChildren && folded(row.session.id);
    hiddenBelow = row.collapsed ? row.depth : undefined;
    return true;
  });
}

function sessionMatches(session: SessionView, query: string): boolean {
  const pullRequests = (session.pullRequests ?? []).map((pr) => `${pr.repository}#${pr.number} ${pr.title ?? ""}`).join(" ");
  const jiraIssues = (session.jiraIssues ?? []).map((issue) => `${issue.key} ${issue.summary ?? ""}`).join(" ");
  return `${session.title} ${session.tool} ${session.cwd} ${session.group} ${sessionGroupLabel(session.group)} ${pullRequests} ${jiraIssues}`
    .toLocaleLowerCase().includes(query);
}

export function filterSessionGroups(groups: readonly SessionGroup[], search: string): SessionGroup[] {
  const query = search.trim().toLocaleLowerCase();
  return groups.flatMap((group) => {
    const matches = !query || `${group.label} ${sessionGroupLabel(group.label)}`.toLocaleLowerCase().includes(query);
    const sessions = group.sessions.filter((session) => matches || sessionMatches(session, query));
    return !query || sessions.length ? [{ ...group, sessions }] : [];
  });
}

function compareSessions(a: SessionView, b: SessionView, sortBy: SidebarSessionOptions["sortBy"]): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  // Stage follows the board, Investigation to Done (Backlog never holds a
  // session; an unknown or legacy stage counts as Investigation); recency
  // breaks ties.
  if (sortBy === "stage") {
    const stage = (session: SessionView) => isSessionStage(session.stage) ? session.stage : DEFAULT_SESSION_STAGE;
    const rank = stageRank(stage(a)) - stageRank(stage(b));
    if (rank) return rank;
  }
  const order = sortBy === "title"
    ? a.title.localeCompare(b.title)
    : (sortBy === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  return order || a.id.localeCompare(b.id);
}

/** A pure view projection: virtual project groups never become registry groups. */
export function sidebarSessionGroups(
  groups: readonly SessionGroup[], search: string, options: SidebarSessionOptions,
): SidebarSessionGroup[] {
  let projected: SidebarSessionGroup[];
  if (options.groupBy === "custom") {
    // The server returns catalog order, which is the user's order; only OTHER
    // is pinned last so an unordered response still renders predictably.
    projected = groups.map((group) => ({ ...group, key: group.label, kind: "custom" }));
    projected.sort((a, b) => Number(a.label === "ungrouped") - Number(b.label === "ungrouped"));
  } else if (options.groupBy === "project") {
    const byProject = new Map<string, SidebarSessionGroup>();
    for (const session of groups.flatMap((group) => group.sessions)) {
      const cwd = session.cwd;
      let group = byProject.get(cwd);
      if (!group) {
        const label = cwd.split("/").filter(Boolean).at(-1) || cwd || "ungrouped";
        group = { label, key: `\u0000project:${cwd}`, kind: "project", cwd, sessions: [] };
        byProject.set(cwd, group);
      }
      group.sessions.push(session);
    }
    projected = [...byProject.values()].sort((a, b) => a.label.localeCompare(b.label));
  } else {
    projected = [{ label: "", key: "\u0000flat", kind: "none", sessions: groups.flatMap((group) => group.sessions) }];
  }
  const all = groups.flatMap((group) => group.sessions);
  const swarmIds = sessionTreeIds(all, all.filter((session) => session.subagent?.collect).map((helper) => helper.id));
  const query = search.trim().toLocaleLowerCase();
  const filtering = Boolean(query) || options.status !== "all";
  const hideEmpty = options.hideEmpty === "always" || (options.hideEmpty === "filtering" && filtering);
  return projected.flatMap((group) => {
    const groupMatches = group.kind !== "none" && `${group.label} ${sessionGroupLabel(group.label)}`.toLocaleLowerCase().includes(query);
    // Like OpenClaw, Swarm helpers and their own subagents get no rows: the parent's Run status Helpers section lists and opens them.
    const sessions = group.sessions.filter((session) =>
      !session.archived && !swarmIds.has(session.id) &&
      (options.status === "all" || session.status === options.status) &&
      (!query || groupMatches || sessionMatches(session, query)),
    ).toSorted((a, b) => compareSessions(a, b, options.sortBy));
    return sessions.length || (!hideEmpty && group.kind !== "none") ? [{ ...group, sessions }] : [];
  });
}

/** Custom group labels in catalog order; OTHER is not a reorderable group. */
export function customGroupOrder(groups: readonly SessionGroup[]): string[] {
  return groups.map((group) => group.label).filter((label) => label && label !== "ungrouped");
}

/** The complete catalog order after dropping `dragged` before or after
 * `target`, or undefined when the drop would not change anything. */
export function moveGroupLabel(
  order: readonly string[], dragged: string, target: string, position: "before" | "after",
): string[] | undefined {
  if (dragged === target || !order.includes(dragged) || !order.includes(target)) return undefined;
  const next = order.filter((label) => label !== dragged);
  next.splice(next.indexOf(target) + (position === "after" ? 1 : 0), 0, dragged);
  return next.every((label, index) => label === order[index]) ? undefined : next;
}
