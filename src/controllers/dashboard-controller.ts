/**
 * Owns the Dashboard page's host metrics: the poll that runs while the page shows and the document is visible (it
 * stops itself once the page is gone, however the app left it), the last read or its error, and the recent samples
 * the sparklines draw, and which session lists show every row instead of the first three. A list folds again when the
 * page is left or the list shrinks to three rows. The session counts come from the session list the app already holds.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadHostMetrics } from "../api/control-surfaces.ts";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup } from "../api/schema/sessions.ts";
import { DASHBOARD_ROWS, NEEDS_YOU_LIST, summarizeSessions } from "../lib/dashboard.ts";

export const DASHBOARD_POLL_MS = 5_000;
export const DASHBOARD_HISTORY = 60;

export class DashboardController implements ReactiveController {
  metrics: HostMetrics | undefined;
  history: readonly HostMetrics[] = [];
  error = "";
  expandedLists: ReadonlySet<string> = new Set();
  readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;
  readonly #shown: () => boolean;
  readonly #groups: () => readonly SessionGroup[];
  readonly #load: () => Promise<HostMetrics>;
  #foldedFor: readonly SessionGroup[] | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #pending: Promise<void> | undefined;

  constructor(host: Pick<ReactiveControllerHost, "requestUpdate" | "addController">, shown: () => boolean, groups: () => readonly SessionGroup[], load = loadHostMetrics) {
    this.#host = host;
    this.#shown = shown;
    this.#groups = groups;
    this.#load = load;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stop();
  }

  hostUpdate(): void {
    if (!this.expandedLists.size) return;
    if (!this.#shown()) {
      this.expandedLists = new Set();
      return;
    }
    const listed = this.#groups();
    if (listed === this.#foldedFor) return;
    this.#foldedFor = listed;
    const { needsYou, groups } = summarizeSessions(listed);
    const sizes = new Map([[NEEDS_YOU_LIST, needsYou.length], ...groups.map((group) => [group.key, group.sessions.length] as const)]);
    const kept = [...this.expandedLists].filter((key) => (sizes.get(key) ?? 0) > DASHBOARD_ROWS);
    if (kept.length < this.expandedLists.size) this.expandedLists = new Set(kept);
  }

  toggleList = (key: string): void => {
    const next = new Set(this.expandedLists);
    if (!next.delete(key)) next.add(key);
    this.expandedLists = next;
    this.#host.requestUpdate();
  };

  start(): void {
    if (this.#timer !== undefined) return;
    this.refresh();
    this.#timer = setInterval(() => {
      if (!this.#shown()) this.stop();
      else if (!document.hidden) this.refresh();
    }, DASHBOARD_POLL_MS);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  refresh = (): void => {
    this.#pending ??= this.#read().finally(() => { this.#pending = undefined; });
  };

  async #read(): Promise<void> {
    try {
      const metrics = await this.#load();
      if (!this.error && metrics.sampledAt === this.metrics?.sampledAt) return;
      this.metrics = metrics;
      this.error = "";
      if (this.history.at(-1)?.sampledAt !== metrics.sampledAt) this.history = [...this.history, metrics].slice(-DASHBOARD_HISTORY);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === this.error) return;
      this.error = message;
    }
    this.#host.requestUpdate();
  }
}
