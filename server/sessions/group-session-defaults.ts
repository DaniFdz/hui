/**
 * The New session defaults a group lends to a session a Chief of Staff creates with `create_session`. A value the group
 * stores wins over the chief's argument and over the caller's context, so the group's directory, machine, Git mode and
 * base ref hold for every session it owns. An argument fills in only what the group leaves unset.
 *
 * A chief works in its own bot folder, which belongs to no project: a grouped session never falls back to it, and a
 * group that names no directory refuses with one sentence rather than place work in the bot's home.
 */
import type { SessionGroupConfig } from "./sessions.ts";

/** A chief named `local` explicitly, or a worker to place the session on. */
export type RequestedWorker = { kind: "local" } | { kind: "worker"; worker: string };

/** What a grouped chief reads when neither its group nor its call names the project its sessions belong to. */
export const GROUP_PROJECT_MISSING = "This group has no project directory. Set it in the group's New session defaults.";

/** The stored group a chief's call names, by its label: a label no group of the registry carries is refused, naming it,
 * rather than placed anywhere as a group that lists no defaults. */
export function groupNamed<Group extends { label: string }>(label: string, groups: readonly Group[]): Group {
  const found = groups.find((group) => group.label === label);
  if (!found) throw new Error(`No session group named ${label}.`);
  return found;
}

/**
 * Where a session a chief starts works: its group's directory, or the one the call named. It is never the chief's own
 * folder, which belongs to the bot rather than to a project: a group that names neither refuses with
 * `GROUP_PROJECT_MISSING`. Without a group there is no project, and the caller's own directory stands.
 */
export function projectDirectory(group: { cwd?: string } | undefined, requestedCwd: string | undefined, callerCwd: string): string {
  const named = group?.cwd ?? requestedCwd;
  if (named) return named;
  if (group) throw new Error(GROUP_PROJECT_MISSING);
  return callerCwd;
}

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
  const cwd = projectDirectory(group, requested.cwd, caller.cwd);
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
