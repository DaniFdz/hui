/**
 * Step logic of the Kanban "Start session" dialog, kept pure so the rules the
 * form grows by are testable without Lit.
 *
 * 1. `folder`: only the folder picker; nothing is known about the folder yet.
 * 2. `plain`: the folder is not a Git checkout; the form ends there.
 * 3. `branch`: a Git checkout defaults to Branch with a shared ref picker.
 *    `worktree`: keeps that ref and additionally asks for a branch suffix.
 */
import type { BacklogStartInput } from "../../shared/backlog.ts";
import type { GitCheckoutInfo } from "./sessions-store.ts";

export type BacklogStartMode = "branch" | "worktree";
export type BacklogStartStep = "folder" | "plain" | "branch" | "worktree";

export type BacklogStartState = {
  cwd: string;
  /** The inspection answer for `cwd`; absent while unknown or loading. */
  checkout?: GitCheckoutInfo;
  loading: boolean;
  mode: BacklogStartMode;
  /** Worktree mode: the name after the branch prefix, as typed or suggested. */
  name: string;
  /** Worktree mode: the latest suggestion, used when `name` was cleared. */
  suggestedName: string;
  /** Shared branch or commit; defaults to the repository default in both modes. */
  baseRef: string;
};

export function backlogStartStep(state: Pick<BacklogStartState, "cwd" | "checkout" | "loading" | "mode">): BacklogStartStep {
  if (!state.cwd.trim() || state.loading || !state.checkout) return "folder";
  if (!state.checkout.available) return "plain";
  return state.mode;
}

/** The worktree name Start sends: what the operator typed, else the suggestion. */
export function backlogWorktreeName(state: Pick<BacklogStartState, "name" | "suggestedName">): string {
  return state.name.trim() || state.suggestedName.trim();
}

export function canStartBacklog(state: BacklogStartState): boolean {
  const step = backlogStartStep(state);
  if (step === "plain" || step === "branch") return true;
  return step === "worktree" && Boolean(backlogWorktreeName(state));
}

/** The shared picker handles searching; keep every bounded server suggestion. */
export function backlogBranchOptions(checkout: GitCheckoutInfo): string[] {
  return [...new Set([checkout.defaultBranch, ...checkout.branches].filter(Boolean))];
}

/** The checkout/worktree half of `startBacklogItem`, or undefined when Start
 * is not allowed yet. A branch other than the current head switches the
 * checkout; a worktree always starts from its base ref. */
export function backlogStartRequest(state: BacklogStartState): Pick<BacklogStartInput, "cwd" | "worktree" | "branchName" | "baseRef"> | undefined {
  if (!canStartBacklog(state)) return undefined;
  const cwd = state.cwd.trim();
  const checkout = state.checkout;
  if (!checkout?.available) return { cwd, worktree: false };
  const baseRef = state.baseRef.trim() || checkout.defaultBranch || checkout.headBranch;
  if (state.mode === "branch") {
    return { cwd, worktree: false, ...(baseRef && baseRef !== checkout.headBranch ? { baseRef } : {}) };
  }
  return { cwd, worktree: true, branchName: backlogWorktreeName(state), ...(baseRef ? { baseRef } : {}) };
}
