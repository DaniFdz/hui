/**
 * The Dashboard's projection of the session list the app already holds, in two independent parts. Lanes say what the
 * operator can do with each top-level session in flight: answer a question, fix a session that stopped, read an unread
 * answer, watch the ones still in flight, or pick up parked work. A stopped session is in Fix whether its last run
 * failed (it settles idle with a live runtime, so the row can resume it) or its runtime is no longer connected (the
 * row can only open it, to be retried in the session). A lane keeps its sessions in the order the operator should take
 * them: the longest wait first for the resting lanes, the newest first for the ones in flight. Filters narrow the lanes
 * without reordering them, by group, status, worker, Kanban stage and a text query over the title, the displayed path
 * and the group, and feed the page's counts and filter choices. The choices always come from every session in flight,
 * so they do not vanish while the operator filters. A finished session (idle in Done) is counted apart and sits in no
 * lane; subagents count on their parent; archived sessions are not sessions here.
 */
import type { SessionGroup, SessionStage, SessionStatus, SessionView } from "../api/schema/sessions.ts";
import { SESSION_STAGE_LABELS, isSessionStage } from "./kanban.ts";
import { sessionGroupLabel } from "./session/sessions.ts";

export const DASHBOARD_STATUS_LABELS: Readonly<Record<SessionStatus, string>> = {
  waiting: "Needs input",
  error: "Error",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting",
  running: "Running",
  starting: "Starting",
  idle: "Idle",
};

export const DASHBOARD_ROWS = 3;

/** The worker value of a session running on this gateway, which has no worker record. */
export const LOCAL_WORKER = "local";

/** What the operator can do with a session in flight. */
export type SessionLaneKey = "answer" | "fix" | "unread" | "flight" | "parked";
export type SessionLane = { key: SessionLaneKey; label: string; sessions: SessionView[] };

const LANES: readonly { key: SessionLaneKey; label: string }[] = [
  { key: "answer", label: "Answer" },
  { key: "fix", label: "Fix" },
  { key: "unread", label: "Unread" },
  { key: "flight", label: "In flight" },
  { key: "parked", label: "Parked" },
];

/** The lane a session belongs to, first reason it holds winning. A run that is going again is no decision, even while
 * the turn before it is still on record as failed, and a question comes before any stop. Fix holds a runtime that is
 * not connected (`error`, `disconnected`) and, because a failed turn settles the session idle rather than error, one
 * whose last run failed. Only then does an idle session's unread answer name its lane; a read one is parked. */
export function laneOf(session: SessionView): SessionLaneKey {
  switch (session.status) {
    case "running":
    case "starting":
    case "reconnecting": return "flight";
    case "waiting": return "answer";
    case "error":
    case "disconnected": return "fix";
    case "idle":
      if (session.runFailed) return "fix";
      return session.unread ? "unread" : "parked";
  }
}

/** What narrows the lanes. An empty value is no filter on that dimension. */
export type SessionFilters = { group: string; status: SessionStatus | ""; worker: string; stage: SessionStage | ""; query: string };

export const EMPTY_FILTERS: SessionFilters = { group: "", status: "", worker: "", stage: "", query: "" };

/** One value a filter offers, with how many sessions in flight carry it. */
export type FilterOption = { value: string; label: string; count: number };
export type FilterOptions = { groups: FilterOption[]; statuses: FilterOption[]; workers: FilterOption[]; stages: FilterOption[] };

export type SessionSummary = {
  /** Top-level sessions in flight, before filtering. */
  total: number;
  /** Top-level sessions in flight that pass the filters. */
  matched: number;
  /** Idle in Done: counted only, never filtered. */
  finished: number;
  /** Over the matched sessions. */
  statuses: Record<SessionStatus, number>;
  /** Over the matched sessions. */
  stages: Record<SessionStage, number>;
  /** Always all five, in lane order. */
  lanes: SessionLane[];
  subagents: ReadonlyMap<string, { total: number; active: number }>;
};

const matchesQuery = (session: SessionView, query: string) =>
  `${session.title} ${session.displayCwd} ${session.group}`.toLocaleLowerCase().includes(query);

function matches(session: SessionView, filters: SessionFilters, query: string): boolean {
  if (filters.group && session.group !== filters.group) return false;
  if (filters.status && session.status !== filters.status) return false;
  if (filters.stage && (!isSessionStage(session.stage) || session.stage !== filters.stage)) return false;
  if (filters.worker && (session.worker?.id ?? LOCAL_WORKER) !== filters.worker) return false;
  return !query || matchesQuery(session, query);
}

/** Whether a session passes every dimension of the filters. Archived sessions, subagents and finished sessions are
 * the caller's to leave out: this only reads the dimensions. */
export function matchesFilters(session: SessionView, filters: SessionFilters): boolean {
  return matches(session, filters, filters.query.trim().toLocaleLowerCase());
}

/** Whether a session is idle in Done, the one state that counts as finished rather than in flight. */
const isFinished = (session: SessionView) => session.status === "idle" && session.stage === "done";

/** Whether a session is in flight: a top-level session that is not archived and not idle in Done. */
function inFlight(session: SessionView): boolean {
  return !session.archived && !session.parentId && !isFinished(session);
}

const updatedTime = (session: SessionView): number | undefined => {
  const time = Date.parse(session.updatedAt);
  return Number.isNaN(time) ? undefined : time;
};

/** Longest wait first; a time HUI cannot read sorts last. */
const longestWaitFirst = (a: SessionView, b: SessionView) => {
  const first = updatedTime(a);
  const second = updatedTime(b);
  if (first === undefined) return second === undefined ? 0 : 1;
  if (second === undefined) return -1;
  return first - second;
};

/** Newest first; a time HUI cannot read sorts last. */
const newestFirst = (a: SessionView, b: SessionView) => {
  const first = updatedTime(a);
  const second = updatedTime(b);
  if (first === undefined) return second === undefined ? 0 : 1;
  if (second === undefined) return -1;
  return second - first;
};

const emptyStatuses = (): Record<SessionStatus, number> => ({ waiting: 0, error: 0, disconnected: 0, reconnecting: 0, running: 0, starting: 0, idle: 0 });
const emptyStages = (): Record<SessionStage, number> => ({ investigation: 0, implementation: 0, testing: 0, done: 0 });

export function summarizeSessions(groups: readonly SessionGroup[], filters: SessionFilters = EMPTY_FILTERS): SessionSummary {
  const statuses = emptyStatuses();
  const stages = emptyStages();
  const subagents = new Map<string, { total: number; active: number }>();
  const buckets: Record<SessionLaneKey, SessionView[]> = { answer: [], fix: [], unread: [], flight: [], parked: [] };
  const query = filters.query.trim().toLocaleLowerCase();
  let total = 0;
  let matched = 0;
  let finished = 0;
  // One pass over the list: each session is filtered once and dropped into its lane, never refiltered per lane.
  for (const group of groups) {
    for (const session of group.sessions) {
      if (session.archived) continue;
      if (session.parentId) {
        const count = subagents.get(session.parentId) ?? { total: 0, active: 0 };
        subagents.set(session.parentId, { total: count.total + 1, active: count.active + (session.status === "idle" ? 0 : 1) });
        continue;
      }
      if (isFinished(session)) {
        finished += 1;
        continue;
      }
      total += 1;
      if (!matches(session, filters, query)) continue;
      matched += 1;
      statuses[session.status] += 1;
      if (isSessionStage(session.stage)) stages[session.stage] += 1;
      buckets[laneOf(session)].push(session);
    }
  }
  return {
    total,
    matched,
    finished,
    statuses,
    stages,
    lanes: LANES.map(({ key, label }) => ({
      key,
      label,
      sessions: buckets[key].sort(key === "flight" ? newestFirst : longestWaitFirst),
    })),
    subagents,
  };
}

const byCountThenLabel = (a: FilterOption, b: FilterOption) => b.count - a.count || a.label.localeCompare(b.label);

/** The values the operator can filter by, counted over every session in flight so a choice never disappears while
 * another filter is active. A choice is only offered when it can narrow: an ungrouped session has no group option
 * because the empty value already means every group. */
export function filterOptions(groups: readonly SessionGroup[]): FilterOptions {
  const groupCounts = new Map<string, number>();
  const statusCounts = new Map<SessionStatus, number>();
  const stageCounts = new Map<SessionStage, number>();
  const workerCounts = new Map<string, { name: string; count: number }>();
  for (const group of groups) {
    for (const session of group.sessions) {
      if (!inFlight(session)) continue;
      if (session.group) groupCounts.set(session.group, (groupCounts.get(session.group) ?? 0) + 1);
      statusCounts.set(session.status, (statusCounts.get(session.status) ?? 0) + 1);
      if (isSessionStage(session.stage)) stageCounts.set(session.stage, (stageCounts.get(session.stage) ?? 0) + 1);
      const worker = session.worker?.id ?? LOCAL_WORKER;
      const known = workerCounts.get(worker);
      workerCounts.set(worker, { name: known?.name ?? session.worker?.name ?? "This gateway", count: (known?.count ?? 0) + 1 });
    }
  }
  return {
    groups: [...groupCounts].map(([value, count]) => ({ value, label: sessionGroupLabel(value), count })).sort(byCountThenLabel),
    statuses: [...statusCounts].map(([value, count]) => ({ value, label: DASHBOARD_STATUS_LABELS[value], count })).sort(byCountThenLabel),
    workers: [...workerCounts].map(([value, { name, count }]) => ({ value, label: name, count })).sort(byCountThenLabel),
    stages: [...stageCounts].map(([value, count]) => ({ value, label: SESSION_STAGE_LABELS[value], count })).sort(byCountThenLabel),
  };
}
