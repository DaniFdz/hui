/**
 * What the Dashboard page reads from the session list the app already holds: the top-level sessions in flight counted
 * by status and Kanban stage, the ones waiting for the operator, the other ones that are not idle grouped by status,
 * and each one's subagents. A finished session (idle in Done) is only counted; archived sessions and subagents are
 * not sessions here.
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

const ACTIVE_GROUPS: readonly { label: string; statuses: readonly SessionStatus[] }[] = [
  { label: "Errors", statuses: ["error", "disconnected"] },
  { label: "Reconnecting", statuses: ["reconnecting"] },
  { label: "Running", statuses: ["running"] },
  { label: "Starting", statuses: ["starting"] },
];

type SubagentCount = { total: number; active: number };

export type SessionSummary = {
  total: number;
  finished: number;
  statuses: Record<SessionStatus, number>;
  stages: Record<SessionStage, number>;
  waiting: SessionView[];
  groups: { label: string; mixed: boolean; sessions: SessionView[] }[];
  subagents: ReadonlyMap<string, SubagentCount>;
};

const newestFirst = (a: SessionView, b: SessionView) => b.updatedAt.localeCompare(a.updatedAt);

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
  const inStatuses = (list: readonly SessionStatus[]) => shown.filter((session) => list.includes(session.status));
  return {
    total: shown.length,
    finished,
    statuses,
    stages,
    waiting: inStatuses(["waiting"]),
    groups: ACTIVE_GROUPS
      .map(({ label, statuses: list }) => ({ label, mixed: list.length > 1, sessions: inStatuses(list) }))
      .filter((group) => group.sessions.length),
    subagents,
  };
}
