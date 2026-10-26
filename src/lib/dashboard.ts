/**
 * What the Dashboard page reads from the session list the app already holds: counts by status and Kanban stage, and
 * the sessions that are not idle, the ones needing the operator first. Archived sessions are left out.
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

export type SessionSummary = {
  statuses: Record<SessionStatus, number>;
  stages: Record<SessionStage, number>;
  active: SessionView[];
};

export function summarizeSessions(groups: readonly SessionGroup[]): SessionSummary {
  const statuses: Record<SessionStatus, number> = { waiting: 0, error: 0, disconnected: 0, reconnecting: 0, running: 0, starting: 0, idle: 0 };
  const stages: Record<SessionStage, number> = { investigation: 0, implementation: 0, testing: 0, done: 0 };
  const active: SessionView[] = [];
  for (const group of groups) {
    for (const session of group.sessions) {
      if (session.archived) continue;
      statuses[session.status] += 1;
      if (isSessionStage(session.stage)) stages[session.stage] += 1;
      if (session.status !== "idle") active.push(session);
    }
  }
  const urgency = (session: SessionView) => DASHBOARD_STATUSES.indexOf(session.status);
  active.sort((a, b) => urgency(a) - urgency(b) || b.updatedAt.localeCompare(a.updatedAt));
  return { statuses, stages, active };
}
