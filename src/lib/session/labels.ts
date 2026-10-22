/**
 * The words a session is announced with, shared by the web and the iOS core (`ios/core/entry.ts`): its status
 * label as the chat header shows it, the accessible name of its sidebar row, and what the row's status glyph shows.
 */
import type { SessionStatus, SessionView } from "../../api/sessions.ts";
import { jiraIssueAccessibleLabel } from "../jira.ts";
import { isSessionStage, SESSION_STAGE_LABELS } from "../kanban.ts";
import { unreachableHost } from "./sessions.ts";
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

export function sessionStatusLabel(session: Pick<SessionView, "status" | "worker">): string {
  return unreachableHost(session)?.status ?? sessionStatusText(session.status);
}

export function sessionAccessibleName(session: SessionView, marks: readonly string[] = []): string {
  return [
    session.title,
    session.creating ? worktreeProgressLabel(session.creating) : `status ${session.status}`,
    ...(session.background && session.status !== "running" ? ["watcher or subagent running"] : []),
    `tool ${session.tool}`,
    ...(isSessionStage(session.stage) ? [`stage ${SESSION_STAGE_LABELS[session.stage].toLocaleLowerCase()}`] : []),
    ...(session.pinned ? ["pinned"] : []),
    ...(session.unread ? ["unread"] : []),
    ...(session.archived ? ["archived"] : []),
    ...marks,
    ...(session.jiraIssues?.length ? [jiraIssueAccessibleLabel(session.jiraIssues.at(-1)!, session.jiraIssues.length)] : []),
  ].join(", ");
}

export type SessionGlyph = {
  attention?: { label: string; tone: "question" | "error" | "away" };
  background: boolean;
  busy: boolean;
  unread: boolean;
  label: string;
};

/** The sidebar row's leading glyph: attention outranks the busy ring (a turn, or a watcher or subagent below it), which outranks the unread dot. */
export function sessionGlyph(session: SessionView): SessionGlyph {
  const away = unreachableHost(session);
  const attention = session.status === "waiting"
    ? { label: "Waiting for your answer", tone: "question" as const }
    : session.status === "error"
      ? { label: "Session failed", tone: "error" as const }
      : away ? { label: away.status, tone: "away" as const } : undefined;
  const background = session.status !== "running" && session.background === true && !attention;
  const busy = session.status === "running" || background;
  const unread = session.unread === true && !attention && !session.icon && !busy;
  const label = attention?.label ?? (background ? "Watcher or subagent running" : session.creating ? worktreeProgressLabel(session.creating) : unread ? "Unread activity" : "");
  return { ...(attention ? { attention } : {}), background, busy, unread, label };
}
