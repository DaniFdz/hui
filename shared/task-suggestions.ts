/** A follow-up the agent flagged with `suggest_task`. Suggestions are
 * gateway-memory presentation state: nothing runs until the operator starts
 * one, and none survive a gateway restart.
 *
 * Unlike OpenClaw's instruction prompt, a HUI suggestion records what was
 * found: the problem, and a proposed fix only when one is actually known. */
export type TaskSuggestion = {
  id: string;
  /** Short imperative card title. */
  title: string;
  /** Markdown description of the bug or problem: what happens, where, the
   * evidence and why it matters. */
  problem: string;
  /** Markdown description of how we think it could be fixed; empty when the
   * fix is not known yet. */
  fix: string;
  /** Absolute working directory for the session that would do the work. */
  cwd: string;
  createdAt: string;
};

/** Where a started suggestion runs, mirroring OpenClaw's start menu:
 * a new session in its directory, a new session in a fresh Git worktree of
 * that directory, or the conversation that recorded it. */
export type TaskSuggestionStartMode = "session" | "worktree" | "current";
export const TASK_SUGGESTION_START_MODES: readonly TaskSuggestionStartMode[] = ["session", "worktree", "current"];

export const TASK_SUGGESTION_LIMITS = {
  title: 120,
  problem: 12_000,
  fix: 8_000,
  cwd: 4_096,
  perSession: 20,
} as const;

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** Browser-side normalization of the snapshot field; drops malformed rows. */
export function parseTaskSuggestions(value: unknown): TaskSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, TASK_SUGGESTION_LIMITS.perSession).flatMap((item): TaskSuggestion[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const suggestion = {
      id: text(row["id"], 100),
      title: text(row["title"], TASK_SUGGESTION_LIMITS.title),
      problem: text(row["problem"], TASK_SUGGESTION_LIMITS.problem),
      fix: text(row["fix"], TASK_SUGGESTION_LIMITS.fix),
      cwd: text(row["cwd"], TASK_SUGGESTION_LIMITS.cwd),
      createdAt: text(row["createdAt"], 40),
    };
    return suggestion.id && suggestion.title && suggestion.problem && suggestion.cwd ? [suggestion] : [];
  });
}

/** The last path segment, which is how the card names where work would run. */
export function taskSuggestionLocation(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/u, "");
  return trimmed.split(/[\\/]/u).at(-1) || cwd;
}

/** Plain one-paragraph preview of the problem for the clamped card summary. */
export function taskSuggestionPreview(problem: string): string {
  return problem
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?|\d+[.)]\s+)/gmu, "")
    .replace(/[`*_]/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Problem and, when known, the proposed fix as Markdown sections. This is
 * the Jira description; the local working directory is left out. */
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
