/**
 * `SessionsController` owns the session registry and the sidebar's reading state outside `hui-app.ts`: the gateway's
 * session list with its revision, loading and error, the one status stream that keeps every session's status and
 * unread mark current, the collapsed groups (`COLLAPSED_KEY`), the subagent trees toggled open and the open group
 * menu, and the shell's action toast and session archive toast with their timers. The shell decides when the stream
 * starts and follows each list into its layout and selection.
 */
import type { ReactiveControllerHost } from "lit";
import { applySessionListUpdate, type SessionListUpdate } from "../../shared/session-list.ts";
import { loadSessions, renameSession, subscribeSessionStatuses, type SessionGroup, type SessionStatus, type SessionStatusUpdate, type SessionView } from "../api/sessions.ts";
import { mergeSessionStatuses } from "../lib/session/ui-state.ts";

const COLLAPSED_KEY = "hui.collapsed-groups";

/** Collapsed groups are a reading preference, so they stay in the browser. */
function readCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

type SessionsHost = ReactiveControllerHost & Pick<HTMLElement, "querySelector">;

type SessionsDeps = {
  presented: (id: string) => boolean;
  listReceived: (ids: ReadonlySet<string>) => void;
  listSettled: () => void;
  statusesApplied: () => void;
  statusApplied: (update: SessionStatusUpdate) => void;
  reportError: (error: unknown, message: string) => void;
  refreshSessions: () => Promise<void>;
};

export class SessionsController {
  groups: readonly SessionGroup[] = [];
  loading = true;
  error = "";
  /** Revision of the gateway session list in `groups`; older lists lose. */
  revision = 0;
  statuses = new Map<string, SessionStatus>();
  unread = new Map<string, boolean>();
  collapsed: ReadonlySet<string> = readCollapsed();
  toggledSessionTrees: ReadonlySet<string> = new Set();
  groupMenuFor = "";
  /** Outcome of a sidebar, Kanban, Sessions or bot action, shown as the shell toast. */
  actionToast: { message: string; failed: boolean } | undefined;
  archiveToast: { session: SessionView; restoring: boolean; error?: string } | undefined;
  readonly #host: SessionsHost;
  readonly #deps: SessionsDeps;
  #hasStatusSnapshot = false;
  /** One lightweight connection keeps background session lifecycle visible. */
  #statusStreamStop: (() => void) | undefined;
  #archiveToastTimer: ReturnType<typeof setTimeout> | undefined;
  #actionToastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: SessionsHost, deps: SessionsDeps) {
    this.#host = host;
    this.#deps = deps;
  }

  start(): void {
    this.#statusStreamStop ??= subscribeSessionStatuses({
      onSnapshot: this.#applyStatusSnapshot,
      onStatus: this.#applyStatusUpdate,
      onSessions: this.#applyListChange,
    });
  }

  stop(): void {
    clearTimeout(this.#actionToastTimer);
    this.#statusStreamStop?.();
    this.#statusStreamStop = undefined;
  }

  listed(id: string): SessionView | undefined {
    return this.groups.flatMap((group) => group.sessions).find((session) => session.id === id);
  }

  async refresh(background = false): Promise<void> {
    if (!background) {
      this.loading = true;
      this.#host.requestUpdate();
    }
    try {
      const { revision, groups } = await loadSessions();
      // The status stream may have delivered newer changes while this loaded.
      this.receive(revision, this.#hasStatusSnapshot ? mergeSessionStatuses(groups, this.statuses) : groups);
      this.error = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read sessions.";
      if (this.groups.length === 0) {
        this.error = message;
      } else {
        // A refresh failure must not replace a usable registry with a full
        // sidebar error. Preserve the last confirmed list and report inline.
        this.#deps.reportError(error, message);
      }
    } finally {
      if (!background) this.loading = false;
      this.#host.requestUpdate();
      this.#deps.listSettled();
    }
  }

  /** Full lists and stream changes both land here, in revision order. */
  receive(revision: number, groups: readonly SessionGroup[]): void {
    if (revision < this.revision) return;
    this.revision = revision;
    this.groups = groups;
    this.#host.requestUpdate();
    this.#deps.listReceived(new Set(groups.flatMap((group) => group.sessions.map(({ id }) => id))));
  }

  toggleSessionTree = (id: string) => {
    const next = new Set(this.toggledSessionTrees);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.toggledSessionTrees = next;
    this.#host.requestUpdate();
  };

  toggleGroup = (label: string) => {
    const next = new Set(this.collapsed);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    this.collapsed = next;
    this.#host.requestUpdate();
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  expandGroup(label: string): void {
    const collapsed = new Set(this.collapsed);
    collapsed.delete(label);
    this.collapsed = collapsed;
    this.#host.requestUpdate();
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* Keep the group visible when storage is unavailable. */ }
  }

  toggleGroupMenu(group: string): void {
    this.groupMenuFor = this.groupMenuFor === group ? "" : group;
    this.#host.requestUpdate();
  }

  closeGroupMenu(): void {
    this.groupMenuFor = "";
    this.#host.requestUpdate();
  }

  /** Replaces the action toast; an empty message clears it. Successes clear
   * after 6 s, while failures and progress ("…") stay until replaced or dismissed. */
  notify(message: string, failed = false): void {
    clearTimeout(this.#actionToastTimer);
    this.actionToast = message ? { message, failed } : undefined;
    this.#host.requestUpdate();
    if (message && !failed && !message.endsWith("…")) this.#actionToastTimer = setTimeout(() => this.notify(""), 6_000);
  }

  showArchived(session: SessionView): void {
    this.archiveToast = { session, restoring: false };
    this.#host.requestUpdate();
    this.scheduleArchiveToast();
  }

  pauseArchiveToast = () => {
    if (this.#archiveToastTimer) clearTimeout(this.#archiveToastTimer);
    this.#archiveToastTimer = undefined;
  };

  dismissArchiveToast = () => {
    this.pauseArchiveToast();
    this.archiveToast = undefined;
    this.#host.requestUpdate();
  };

  scheduleArchiveToast = () => {
    this.pauseArchiveToast();
    if (!this.archiveToast || this.archiveToast.restoring || this.archiveToast.error) return;
    const element = this.#host.querySelector(".session-archive-toast");
    if (element?.matches(":hover") || element?.contains(document.activeElement)) return;
    this.#archiveToastTimer = setTimeout(this.dismissArchiveToast, 15_000);
  };

  restoreArchivedSession = async () => {
    const toast = this.archiveToast;
    if (!toast || toast.restoring) return;
    this.pauseArchiveToast();
    this.archiveToast = { session: toast.session, restoring: true };
    this.#host.requestUpdate();
    try {
      await renameSession(toast.session.id, { archived: false });
      if (this.archiveToast?.session.id === toast.session.id) this.dismissArchiveToast();
      this.notify("Session restored.");
      await this.#deps.refreshSessions();
    } catch (error) {
      if (this.archiveToast?.session.id === toast.session.id) {
        this.archiveToast = { session: toast.session, restoring: false,
          error: error instanceof Error ? error.message : "Could not restore that session." };
        this.#host.requestUpdate();
      }
    }
  };

  #applyStatusSnapshot = (updates: readonly SessionStatusUpdate[]) => {
    // The status stream has just (re)connected, so the gateway is reachable
    // again: a list that failed to load earlier is worth asking for once more.
    if (this.error && !this.loading) void this.refresh();
    this.statuses = new Map(updates.map(({ id, status }) => [id, status]));
    const unread = new Map(updates.flatMap((update) =>
      update.unread === undefined ? [] : [[update.id, update.unread] as const]));
    this.unread = new Map(updates.map((update) => [update.id, update.unread === true]));
    this.#hasStatusSnapshot = true;
    const merged = mergeSessionStatuses(this.groups, this.statuses);
    this.groups = merged.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => {
        const isUnread = unread.has(session.id) ? unread.get(session.id) === true : session.unread === true;
        return { ...session, unread: isUnread || undefined };
      }),
    }));
    this.#host.requestUpdate();
    this.#deps.statusesApplied();
  };

  #applyStatusUpdate = (update: SessionStatusUpdate) => {
    const { id, status, unread, creating, creationError, title } = update;
    const presented = this.#deps.presented(id);
    this.statuses.set(id, status);
    if (unread !== undefined) this.unread.set(id, unread);
    // A settled worktree session now has its real title and directory, or its error.
    const created = Boolean(this.listed(id)?.creating) && !creating;
    this.groups = this.groups.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => session.id === id
        ? {
            ...session,
            status,
            unread: presented
              ? undefined
              : unread === undefined ? session.unread : unread || undefined,
            creating,
            creationError,
            ...(title ? { title } : {}),
          }
        : session),
    }));
    this.#host.requestUpdate();
    if (created) void this.refresh(true);
    this.#deps.statusApplied(update);
  };

  #applyListChange = (update: SessionListUpdate<SessionView>) => {
    if (update.revision <= this.revision) return;
    // Status events can overtake a list built a moment earlier.
    this.receive(update.revision, mergeSessionStatuses(applySessionListUpdate(this.groups, update), this.statuses));
    this.loading = false;
    this.error = "";
    this.#deps.listSettled();
  };
}
