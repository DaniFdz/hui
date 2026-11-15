/**
 * The New session defaults a group lends to a session a Chief of Staff creates with `create_session`. A value the group
 * stores wins over the chief's argument and over the caller's context, so the group's directory, machine, Git mode and
 * base ref hold for every session it owns. An argument fills in only what the group leaves unset.
 */
import type { SessionGroupConfig } from "./sessions.ts";

/** A chief named `local` explicitly, or a worker to place the session on. */
export type RequestedWorker = { kind: "local" } | { kind: "worker"; worker: string };

export type GroupSessionDefaults = {
  cwd: string;
  worker?: string;
  worktree: boolean;
  baseRef?: string;
};

export function groupSessionDefaults(options: {
  group?: Pick<SessionGroupConfig, "cwd" | "workspaceMode" | "baseRef" | "worker">;
  caller: { cwd: string; worker?: string };
  requested?: { cwd?: string; worker?: RequestedWorker; worktree?: boolean; baseRef?: string };
}): GroupSessionDefaults {
  const { group, caller, requested = {} } = options;
  const cwd = group?.cwd ?? requested.cwd ?? caller.cwd;
  const worker = group?.worker
    ?? (requested.worker?.kind === "local" ? undefined
      : requested.worker ? requested.worker.worker : caller.worker);
  // A group's Git choices describe its own directory; without one they cannot apply to another checkout.
  const groupGit = group?.cwd ? group : undefined;
  const worktree = groupGit?.workspaceMode
    ? groupGit.workspaceMode === "worktree"
    : requested.worktree === true;
  const baseRef = (groupGit?.baseRef ?? requested.baseRef) || undefined;
  return { cwd, ...(worker ? { worker } : {}), worktree, ...(baseRef ? { baseRef } : {}) };
}
