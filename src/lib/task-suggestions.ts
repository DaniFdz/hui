import type { TaskSuggestion, TaskSuggestionStartMode } from "../../shared/task-suggestions.ts";
import type { SessionView } from "./sessions-store.ts";
import { fetchJson } from "./settings-store.ts";

export type { TaskSuggestionStartMode } from "../../shared/task-suggestions.ts";
export { parseTaskSuggestions, taskSuggestionJiraDescription, taskSuggestionLocation, taskSuggestionPreview, taskSuggestionPrompt, type TaskSuggestion } from "../../shared/task-suggestions.ts";

function suggestionUrl(sessionId: string, suggestionId: string): string {
  return `/__hui/sessions/${encodeURIComponent(sessionId)}/suggestions/${encodeURIComponent(suggestionId)}`;
}

export async function dismissTaskSuggestion(sessionId: string, suggestionId: string): Promise<TaskSuggestion[]> {
  return (await fetchJson<{ suggestions: TaskSuggestion[] }>(suggestionUrl(sessionId, suggestionId), { method: "DELETE" })).suggestions;
}

/** The server creates the session (and worktree) and waits for its runtime
 * to accept the problem/fix prompt, so this can take as long as a cold PI
 * boot plus a checkout. `current` returns the recording session itself. */
export async function startTaskSuggestion(sessionId: string, suggestionId: string, mode: TaskSuggestionStartMode = "session"): Promise<SessionView> {
  return (await fetchJson<{ session: SessionView }>(`${suggestionUrl(sessionId, suggestionId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(mode === "worktree" ? 10 * 60_000 : 60_000),
  })).session;
}

/** Keeps a card index valid as suggestions arrive and leave. */
export function clampSuggestionIndex(index: number, count: number): number {
  return count ? Math.min(Math.max(0, index), count - 1) : 0;
}
