import type { TranscriptItem } from "./sessions-store.ts";

export type RunErrorNotice = {
  /** Stable across PI's post-settle history refresh, unlike transcript row ids. */
  key: string;
  summary: string;
  detail: string;
  multiline: boolean;
};

/** The prompt HUI sends when the operator resumes a run that ended in an error. */
export const CONTINUE_AFTER_ERROR_PROMPT = "Continue from where you left off.";

const SUMMARY_LIMIT = 160;

/**
 * A run that stops on a runtime/provider error ends with that error as the
 * latest transcript row. The inline row sits inside the collapsed activity
 * disclosure, so the composer surfaces it separately until the next turn.
 */
export function latestRunError(
  items: readonly TranscriptItem[],
  streaming: boolean,
): RunErrorNotice | undefined {
  if (streaming) return undefined;
  const last = items.at(-1);
  if (last?.kind !== "error") return undefined;
  const detail = last.text.trim();
  if (!detail) return undefined;
  const lines = detail.split(/\r?\n/u).map((line) => line.replace(/\s+/gu, " ").trim()).filter(Boolean);
  const first = lines[0] ?? detail;
  const summary = first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : first;
  const userTurns = items.filter((item) => item.kind === "message" && item.role === "user").length;
  return {
    key: `${userTurns}:${detail}`,
    summary,
    detail,
    multiline: lines.length > 1 || summary !== first,
  };
}
