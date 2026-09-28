import { DEFAULT_SESSION_STAGE, isSessionStage, stageRank } from "../../shared/session-stages.ts";
import { sessionGroupLabel, type SessionGroup, type SessionStatus, type SessionView } from "./sessions-store.ts";

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
    status: (["idle", "running", "waiting", "starting", "error"] as const).find((status) => status === raw["status"]) ?? "all",
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

export type SidebarSessionTreeRow = { session: SessionView; depth: number; hasChildren: boolean };

/** Keeps spawned sessions immediately below their parent while preserving the
 * sort order already chosen for each sibling set. Missing parents and cycles
 * degrade to ordinary root rows instead of hiding a conversation. */
export function sessionTreeRows(sessions: readonly SessionView[], collapsed: ReadonlySet<string> = new Set()): SidebarSessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
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
    output.push({ session, depth, hasChildren: false });
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
    hiddenBelow = collapsed.has(row.session.id) ? row.depth : undefined;
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
  const query = search.trim().toLocaleLowerCase();
  const filtering = Boolean(query) || options.status !== "all";
  const hideEmpty = options.hideEmpty === "always" || (options.hideEmpty === "filtering" && filtering);
  return projected.flatMap((group) => {
    const groupMatches = group.kind !== "none" && `${group.label} ${sessionGroupLabel(group.label)}`.toLocaleLowerCase().includes(query);
    const sessions = group.sessions.filter((session) =>
      !session.archived &&
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
