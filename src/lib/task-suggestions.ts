/**
 * Task suggestions recorded in a session: the shared parser and prompt wording, and keeping a card index valid.
 * Dismissing and starting one live in src/api/task-suggestions.ts.
 */
export type { TaskSuggestionStartMode } from "../../shared/task-suggestions.ts";
export { parseTaskSuggestions, taskSuggestionJiraDescription, taskSuggestionLocation, taskSuggestionPreview, taskSuggestionPrompt, type TaskSuggestion } from "../../shared/task-suggestions.ts";

/** Keeps a card index valid as suggestions arrive and leave. */
export function clampSuggestionIndex(index: number, count: number): number {
  return count ? Math.min(Math.max(0, index), count - 1) : 0;
}
