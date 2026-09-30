/** The sidebar's session list, pushed by the gateway as revisioned changes so
 * every screen shares one copy instead of re-downloading the whole list. */

export type SessionListGroup<S> = { label: string; cwd?: string; workspaceMode?: "branch" | "worktree"; baseRef?: string; sessions: S[] };
type Layout = (Omit<SessionListGroup<never>, "sessions"> & { ids: string[] })[];

/** `groups` (order and membership) is present only when it changed; `upserts`
 * holds every session whose view changed. */
export type SessionListUpdate<S> = { revision: number; groups?: Layout; upserts: S[] };

export function sessionListLayout<S extends { id: string }>(groups: readonly SessionListGroup<S>[]): Layout {
  return groups.map(({ sessions, ...meta }) => ({ ...meta, ids: sessions.map(({ id }) => id) }));
}

export function diffSessionList<S extends { id: string }>(
  previous: readonly SessionListGroup<S>[],
  next: readonly SessionListGroup<S>[],
): Omit<SessionListUpdate<S>, "revision"> | undefined {
  const layout = sessionListLayout(next);
  const layoutChanged = JSON.stringify(layout) !== JSON.stringify(sessionListLayout(previous));
  const before = new Map(previous.flatMap((group) => group.sessions).map((session) => [session.id, JSON.stringify(session)]));
  const upserts = next.flatMap((group) => group.sessions).filter((session) => before.get(session.id) !== JSON.stringify(session));
  if (!layoutChanged && !upserts.length) return undefined;
  return { ...(layoutChanged ? { groups: layout } : {}), upserts };
}

export function applySessionListUpdate<S extends { id: string }>(
  groups: readonly SessionListGroup<S>[],
  update: Pick<SessionListUpdate<S>, "groups" | "upserts">,
): SessionListGroup<S>[] {
  const byId = new Map(groups.flatMap((group) => group.sessions).map((session) => [session.id, session]));
  for (const session of update.upserts) byId.set(session.id, session);
  return (update.groups ?? sessionListLayout(groups)).map(({ ids, ...meta }) => ({
    ...meta,
    sessions: ids.flatMap((id) => byId.get(id) ?? []),
  }));
}
