import type { WorktreeInventory, WorktreeRemovalMode, WorktreeRemovalResult, WorktreeRisk, WorktreeRow } from "../../shared/worktrees.ts";
import { fetchJson } from "./settings-store.ts";

export type { WorktreeInventory, WorktreeRemovalResult, WorktreeRisk, WorktreeRow } from "../../shared/worktrees.ts";
export { isMergedCleanupCandidate } from "../../shared/worktrees.ts";

export function loadWorktrees(): Promise<WorktreeInventory> {
  return fetchJson<WorktreeInventory>("/__hui/worktrees", { signal: AbortSignal.timeout(30_000) });
}

export function removeWorktrees(
  paths: readonly string[],
  mode: WorktreeRemovalMode,
  acknowledged: readonly WorktreeRisk[] = [],
): Promise<{ results: WorktreeRemovalResult[]; inventory: WorktreeInventory }> {
  return fetchJson("/__hui/worktrees/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths, mode, acknowledged }),
    // Removing large checkouts can take a while; the server serializes removals.
    signal: AbortSignal.timeout(15 * 60_000),
  });
}

/** Binary units, one decimal from MiB up, matching `du -h` intuition. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit >= 2 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Worktrees whose every linked session is in `ids`, so removing them strands no other session. */
export function worktreesOnlyUsedBy(rows: readonly WorktreeRow[], ids: ReadonlySet<string>): string[] {
  return rows.filter((row) => row.sessions.length > 0 && row.sessions.every((session) => ids.has(session.id))).map((row) => row.path);
}
