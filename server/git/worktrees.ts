/** Git worktree cleanup eligibility and acknowledged removal risks. */
import type { WorktreeRow, WorktreeRisk } from "../api/worktrees.ts";

export function isMergedCleanupCandidate(row: WorktreeRow): boolean {
  return row.managed && row.merged && row.sessions.every((session) => session.archived) && row.dirty === false && row.risks.length === 0;
}

/** A risk the user acknowledged covers the risk the server now sees. */
export function riskAcknowledged(risk: WorktreeRisk, acknowledged: readonly WorktreeRisk[]): boolean {
  return acknowledged.includes(risk) || (risk === "dirty" && acknowledged.includes("unknown"));
}
