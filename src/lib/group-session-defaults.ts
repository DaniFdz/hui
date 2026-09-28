import type { GitCheckoutInfo, SessionGroup } from "./sessions-store.ts";

/** Apply group defaults only to its original directory and an actual checkout. */
export function groupCheckoutDefaults(directory: string, checkout: GitCheckoutInfo,
  group?: Pick<SessionGroup, "cwd" | "workspaceMode" | "baseRef">) {
  if (!checkout.available) return { worktree: false, baseRef: "" };
  const matching = group?.cwd?.trim() === directory.trim();
  return {
    worktree: matching && group?.workspaceMode === "worktree",
    baseRef: (matching ? group?.baseRef : "") || checkout.defaultBranch || checkout.headBranch || "HEAD",
  };
}
