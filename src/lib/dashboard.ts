/**
 * What the Dashboard page reads from the session list the app already holds: the top-level sessions in flight counted
 * by status and Kanban stage, the ones waiting for the operator (those that are not running, starting or reconnecting,
 * so nothing moves until the operator does) in the order that puts the longest wait first: a question, then a stopped
 * session, an unread answer and parked work, the ones still in flight grouped by status newest first, and each one's
 * subagents, each list under the key the page expands it by. A finished session (idle in Done) is only counted;
 * archived sessions and subagents are not sessions here.
 */
import type { SessionGroup, SessionStage, SessionStatus, SessionView } from "../api/schema/sessions.ts";
import { isSessionStage } from "./kanban.ts";

export const DASHBOARD_STATUSES = ["waiting", "error", "disconnected", "reconnecting", "running", "starting", "idle"] as const satisfies readonly SessionStatus[];

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
export const NEEDS_YOU_LIST = "needs-you";

const AWAITING_STATUSES: readonly SessionStatus[] = ["waiting", "error", "disconnected", "idle"];


type SubagentCount = { total: number; active: number };

export type SessionSummary = {
  total: number;
  finished: number;
  statuses: Record<SessionStatus, number>;
  stages: Record<SessionStage, number>;
  needsYou: SessionView[];
  groups: { key: string; label: string; sessions: SessionView[] }[];
  subagents: ReadonlyMap<string, SubagentCount>;
};

const updatedTime = (session: SessionView) => Date.parse(session.updatedAt) || 0;
const newestFirst = (a: SessionView, b: SessionView) => updatedTime(b) - updatedTime(a);

/** What stopped the session orders the list: a question, a crash, a disconnect, an unread answer, then parked work. */
const needsYouTier = (session: SessionView) =>
  session.status === "waiting" ? 0
    : session.status === "error" ? 1
      : session.status === "disconnected" ? 2
        : session.unread ? 3
          : 4;
/** Within a tier the longest wait since the last message comes first; a time HUI can't read sorts last. */
const waitedLongestFirst = (a: SessionView, b: SessionView) => (Date.parse(a.updatedAt) || Infinity) - (Date.parse(b.updatedAt) || Infinity);
const needsYouOrder = (a: SessionView, b: SessionView) => needsYouTier(a) - needsYouTier(b) || waitedLongestFirst(a, b);

export function summarizeSessions(groups: readonly SessionGroup[]): SessionSummary {
  const statuses: Record<SessionStatus, number> = { waiting: 0, error: 0, disconnected: 0, reconnecting: 0, running: 0, starting: 0, idle: 0 };
  const stages: Record<SessionStage, number> = { investigation: 0, implementation: 0, testing: 0, done: 0 };
  const subagents = new Map<string, SubagentCount>();
  const shown: SessionView[] = [];
  let finished = 0;
  for (const group of groups) {
    for (const session of group.sessions) {
      if (session.archived) continue;
      if (session.parentId) {
        const count = subagents.get(session.parentId) ?? { total: 0, active: 0 };
        subagents.set(session.parentId, { total: count.total + 1, active: count.active + (session.status === "idle" ? 0 : 1) });
      } else if (session.status === "idle" && session.stage === "done") {
        finished += 1;
      } else {
        shown.push(session);
        statuses[session.status] += 1;
        if (isSessionStage(session.stage)) stages[session.stage] += 1;
      }
    }
  }
  shown.sort(newestFirst);
  return {
    total: shown.length,
    finished,
    statuses,
    stages,
    needsYou: shown.filter((session) => AWAITING_STATUSES.includes(session.status)).sort(needsYouOrder),
    groups: DASHBOARD_STATUSES
      .filter((status) => !AWAITING_STATUSES.includes(status))
      .map((status) => ({ key: status, label: DASHBOARD_STATUS_LABELS[status], sessions: shown.filter((session) => session.status === status) }))
      .filter((group) => group.sessions.length),
    subagents,
  };
}
