/**
 * `BacklogController` owns the Kanban board's Backlog column outside `hui-app.ts`: the server's merged view of local
 * tasks and the Jira feed (the only source of the column; nothing moves optimistically), moving a task to a group,
 * the start dialog's task and drop target, and removing a task after its confirmation. The shell renders the column
 * and the dialogs from these fields.
 */
import type { ReactiveControllerHost } from "lit";
import { loadBacklog, removeBacklogItem, setBacklogItemGroup, type BacklogItem, type BacklogJiraState } from "../api/backlog.ts";
import type { BacklogStartTarget } from "../components/backlog-start-dialog.ts";
import type { SessionView } from "../api/sessions.ts";
import { sessionGroupLabel } from "../lib/session/sessions.ts";
import { DEFAULT_SESSION_STAGE, SESSION_STAGE_LABELS } from "../../shared/session-stages.ts";

type BacklogDeps = {
  notify: (message: string, failed?: boolean) => void;
  refreshSessions: () => void;
};

export class BacklogController {
  items: readonly BacklogItem[] = [];
  loading = false;
  error = "";
  jira: BacklogJiraState = { status: "unconfigured" };
  pendingId = "";
  /** Backlog item whose start dialog is open, with the drop target. */
  starting: { item: BacklogItem; target: BacklogStartTarget } | undefined;
  /** Local task awaiting removal confirmation. */
  removing: BacklogItem | undefined;
  readonly #host: ReactiveControllerHost;
  readonly #deps: BacklogDeps;
  #request = 0;

  constructor(host: ReactiveControllerHost, deps: BacklogDeps) {
    this.#host = host;
    this.#deps = deps;
  }

  async refresh(refresh = false): Promise<void> {
    const request = ++this.#request;
    this.loading = true;
    this.#host.requestUpdate();
    try {
      const view = await loadBacklog(refresh);
      if (request !== this.#request) return;
      this.items = view.items;
      this.jira = view.jira;
      this.error = "";
    } catch (error) {
      if (request === this.#request) this.error = error instanceof Error ? error.message : "The backlog could not be loaded.";
    } finally {
      if (request === this.#request) this.loading = false;
      this.#host.requestUpdate();
    }
  }

  setGroup = (item: BacklogItem, group: string) => {
    const current = !item.group || item.group === "ungrouped" ? "" : item.group;
    if (this.pendingId || current === group) return;
    this.#setPending(item.id);
    this.#deps.notify(`Moving ${item.title} to ${sessionGroupLabel(group)}…`);
    void setBacklogItemGroup(item.id, group)
      .then((view) => {
        this.#adopt(view);
        this.#deps.notify(`Moved ${item.title} to ${sessionGroupLabel(group)}.`);
      })
      .catch((error: unknown) => {
        this.#deps.notify(error instanceof Error ? error.message : "Could not move that backlog item.", true);
      })
      .finally(() => this.#setPending(""));
  };

  openStart = (item: BacklogItem, target: BacklogStartTarget) => {
    if (this.pendingId) return;
    void import("../components/backlog-start-dialog.ts").then(() => {
      this.starting = { item, target };
      this.#host.requestUpdate();
    });
  };

  closeStart = () => {
    this.starting = undefined;
    this.#host.requestUpdate();
  };

  started = (session: SessionView, item: BacklogItem) => {
    this.starting = undefined;
    this.#deps.notify(`Started “${session.title}” from the backlog in ${SESSION_STAGE_LABELS[session.stage ?? DEFAULT_SESSION_STAGE]}.`);
    this.items = this.items.filter(({ id }) => id !== item.id);
    this.#host.requestUpdate();
    this.#deps.refreshSessions();
    void this.refresh();
  };

  askRemove(item: BacklogItem): void {
    this.removing = item;
    this.#host.requestUpdate();
  }

  cancelRemove = () => {
    if (this.pendingId) return;
    this.removing = undefined;
    this.#host.requestUpdate();
  };

  confirmRemove = (event: Event) => {
    event.preventDefault();
    const item = this.removing;
    if (!item || this.pendingId) return;
    this.#setPending(item.id);
    void removeBacklogItem(item.id)
      .then((view) => {
        this.#adopt(view);
        this.#deps.notify(`Removed “${item.title}” from the backlog.`);
        this.removing = undefined;
      })
      .catch((error: unknown) => {
        this.#deps.notify(error instanceof Error ? error.message : "Could not remove that task.", true);
        this.removing = undefined;
      })
      .finally(() => this.#setPending(""));
  };

  #adopt(view: { items: readonly BacklogItem[]; jira: BacklogJiraState }): void {
    this.items = view.items;
    this.jira = view.jira;
    this.#host.requestUpdate();
  }

  #setPending(id: string): void {
    this.pendingId = id;
    this.#host.requestUpdate();
  }
}
