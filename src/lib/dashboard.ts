/**
 * What the Dashboard page reads from the session list the app already holds: counts by status and Kanban stage, the
 * sessions waiting for the operator, and the other sessions that are not idle, grouped by status. Archived sessions
 * are left out.
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

export type SessionSummary = {
  total: number;
  statuses: Record<SessionStatus, number>;
  stages: Record<SessionStage, number>;
  waiting: SessionView[];
  groups: { label: string; mixed: boolean; sessions: SessionView[] }[];
  titles: ReadonlyMap<string, string>;
};

const newestFirst = (a: SessionView, b: SessionView) => b.updatedAt.localeCompare(a.updatedAt);

export function summarizeSessions(groups: readonly SessionGroup[]): SessionSummary {
  const statuses: Record<SessionStatus, number> = { waiting: 0, error: 0, disconnected: 0, reconnecting: 0, running: 0, starting: 0, idle: 0 };
  const stages: Record<SessionStage, number> = { investigation: 0, implementation: 0, testing: 0, done: 0 };
  const titles = new Map<string, string>();
  const shown: SessionView[] = [];
  for (const group of groups) {
    for (const session of group.sessions) {
      titles.set(session.id, session.title);
      if (session.archived) continue;
      shown.push(session);
      statuses[session.status] += 1;
      if (isSessionStage(session.stage)) stages[session.stage] += 1;
    }
  }
  shown.sort(newestFirst);
  const inStatuses = (list: readonly SessionStatus[]) => shown.filter((session) => list.includes(session.status));
  return {
    total: shown.length,
    statuses,
    stages,
    waiting: inStatuses(["waiting"]),
    groups: ACTIVE_GROUPS
      .map(({ label, statuses: list }) => ({ label, mixed: list.length > 1, sessions: inStatuses(list) }))
      .filter((group) => group.sessions.length),
    titles,
  };
}
