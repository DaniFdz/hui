import type { WorktreeProgress } from "./sessions-store.ts";

/** Whether a launch leaves the branch name to HUI, which names it from the
 * prompt before any Git work starts. */
export function launchNamesWorktree(input: { worktree?: boolean; branchName?: string; prompt?: string }): boolean {
  return input.worktree === true && !input.branchName?.trim() && Boolean(input.prompt?.trim());
}

/** The status line shown while New Session creates a worktree. */
export function worktreeProgressLabel(progress: WorktreeProgress | undefined): string {
  switch (progress?.phase) {
    case "naming": return "Naming worktree";
    case "checkout": return "Checking out files";
    case "filtering": return "Running checkout filters";
    case "finalizing": return "Finalizing Git worktree";
    default: return "Preparing Git worktree";
  }
}
