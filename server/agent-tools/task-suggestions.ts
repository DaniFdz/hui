/** Task suggestion limits, start modes and the prompt text sent to sessions and Jira. */
import type { TaskSuggestion, TaskSuggestionStartMode } from "../api/task-suggestions.ts";
export type { TaskSuggestionStartMode } from "../api/task-suggestions.ts";

export const TASK_SUGGESTION_START_MODES: readonly TaskSuggestionStartMode[] = ["session", "worktree", "current"];

export const TASK_SUGGESTION_LIMITS = {
  title: 120,
  problem: 12_000,
  fix: 8_000,
  cwd: 4_096,
  perSession: 20,
} as const;

export function taskSuggestionJiraDescription(suggestion: Pick<TaskSuggestion, "problem" | "fix">): string {
  return [
    "## Problem", suggestion.problem,
    ...(suggestion.fix ? ["## Proposed fix", suggestion.fix] : []),
  ].join("\n\n");
}

/** First turn of a session started from the card. Without a known fix the
 * session is asked to find the cause before changing code. */
export function taskSuggestionPrompt(suggestion: Pick<TaskSuggestion, "title" | "problem" | "fix">): string {
  return [
    `# ${suggestion.title}`,
    "## Problem", suggestion.problem,
    "## Proposed fix",
    suggestion.fix || "Not known yet. Investigate and confirm the root cause before changing code.",
  ].join("\n\n");
}
