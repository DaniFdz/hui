/**
 * The words a session is announced with, shared by the web and the iOS core (`ios/core/entry.ts`): its status
 * label, and the accessible name of its sidebar row.
 */
import type { SessionStatus, SessionView } from "../../api/sessions.ts";
import { isSessionStage, SESSION_STAGE_LABELS } from "../kanban.ts";
import { worktreeProgressLabel } from "../worktree-progress.ts";

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Waiting for your answer",
  starting: "Starting",
  error: "Error",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

export function sessionStatusText(status: SessionStatus): string {
  return STATUS_TEXT[status];
}

export function sessionAccessibleName(session: SessionView): string {
  return [
    session.title,
    session.creating ? worktreeProgressLabel(session.creating) : `status ${session.status}`,
    ...(session.background && session.status !== "running" ? ["watcher or subagent running"] : []),
    `tool ${session.tool}`,
    ...(isSessionStage(session.stage) ? [`stage ${SESSION_STAGE_LABELS[session.stage].toLocaleLowerCase()}`] : []),
    ...(session.pinned ? ["pinned"] : []),
    ...(session.unread ? ["unread"] : []),
    ...(session.archived ? ["archived"] : []),
  ].join(", ");
}
