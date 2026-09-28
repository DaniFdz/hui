/** Git worktree inventory and cleanup, as reported to the browser.
 *
 * Git facts (path, branch, HEAD) are read on every request. Slower facts —
 * local changes, disk usage and GitHub pull requests — are computed in the
 * background and stay absent until confirmed, so the page never waits on a
 * large checkout or the network and never invents a state. */
import type { SessionPullRequest } from "./pull-requests.ts";

export type WorktreeSessionRef = {
  id: string;
  title: string;
  archived: boolean;
};

export type WorktreeRow = {
  /** Canonical path of the repository's main checkout. */
  repository: string;
  /** Canonical worktree path. */
  path: string;
  /** `path` with the home directory shortened to `~`, for display only. */
  displayPath: string;
  /** Short branch name; empty when detached. */
  branch: string;
  head: string;
  detached: boolean;
  /** Created by HUI's New Session under `~/.config/hui/worktrees/`. Other
   * worktrees (created by hand or another tool) are removable one at a time
   * but never by the bulk merged cleanup. */
  managed: boolean;
  /** Registered HUI sessions whose working directory is inside this worktree. */
  sessions: readonly WorktreeSessionRef[];
  /** Pull requests whose head is this branch. Absent until GitHub answered. */
  pullRequests?: readonly SessionPullRequest[];
  /** Uncommitted or untracked changes. Absent until `git status` answered. */
  dirty?: boolean;
  /** Disk usage in bytes. Absent until measured. */
  bytes?: number;
  /** At least one confirmed merged pull request and none open or draft. */
  merged: boolean;
  /** What a manual removal would discard or interrupt. The confirmation lists
   * each one; the server forces only risks the user acknowledged. */
  risks: readonly WorktreeRisk[];
  /** Background facts whose last lookup failed (for example `gh` missing or
   * offline). They stay absent rather than being guessed. */
  unavailable?: readonly ("pullRequests" | "dirty" | "bytes")[];
};

/** `dirty`: local changes will be deleted. `unknown`: they could not be read.
 * `locked`: Git lock will be overridden. `running`: a linked session is stopped.
 * `missing`: only Git's record is removed. `external`: not created by HUI. */
export type WorktreeRisk = "dirty" | "unknown" | "locked" | "running" | "missing" | "external";

export type WorktreeInventory = {
  worktrees: readonly WorktreeRow[];
  diagnostics: readonly string[];
  /** A background fact is still being computed; poll again. */
  pending: boolean;
};

export type WorktreeRemovalMode = "single" | "merged";

export type WorktreeRemovalResult = {
  path: string;
  /** Branch name, or the directory name when detached, for messages. */
  label: string;
  removed: boolean;
  /** The local branch was deleted too, which happens only after a merged PR. */
  branchDeleted: boolean;
  error?: string;
};

/** Worktrees the "Clean up merged" action may remove. */
export function isMergedCleanupCandidate(row: WorktreeRow): boolean {
  return row.managed && row.merged && row.sessions.length === 0 && row.dirty === false && row.risks.length === 0;
}

/** A risk the user acknowledged covers the risk the server now sees. */
export function riskAcknowledged(risk: WorktreeRisk, acknowledged: readonly WorktreeRisk[]): boolean {
  return acknowledged.includes(risk) || (risk === "dirty" && acknowledged.includes("unknown"));
}
