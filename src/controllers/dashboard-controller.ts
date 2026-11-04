/**
 * Owns the Dashboard page's host metrics: the poll that runs while the page shows and the document is visible (it
 * stops itself once the page is gone, however the app left it), the last read or its error, and the recent samples
 * the sparklines draw, for this gateway's host and every worker it holds a connection to, and which session lists
 * show every row instead of the first three. A list folds again when the page is left or the list shrinks to three
 * rows. The session counts come from the session list the app already holds.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadHostMetrics } from "../api/control-surfaces.ts";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup } from "../api/schema/sessions.ts";
import { loadWorkerMetrics, type WorkerMetrics } from "../api/workers.ts";
import { DASHBOARD_ROWS, NEEDS_YOU_LIST, summarizeSessions } from "../lib/dashboard.ts";

export const DASHBOARD_POLL_MS = 5_000;
export const DASHBOARD_HISTORY = 60;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The same samples for a worker: appended only when its `sampledAt` moves, like the host's. */
function sampled(history: readonly HostMetrics[] | undefined, metrics: HostMetrics): readonly HostMetrics[] {
  return history?.at(-1)?.sampledAt === metrics.sampledAt ? history : [...(history ?? []), metrics].slice(-DASHBOARD_HISTORY);
}

const unchanged = (previous: readonly WorkerMetrics[], next: readonly WorkerMetrics[]) =>
  previous.length === next.length && previous.every((worker, index) => {
    const other = next[index];
    return other !== undefined && worker.id === other.id && worker.name === other.name && worker.state === other.state
      && worker.error === other.error && worker.metrics?.sampledAt === other.metrics?.sampledAt;
  });

export class DashboardController implements ReactiveController {
  metrics: HostMetrics | undefined;
  history: readonly HostMetrics[] = [];
  error = "";
  workers: readonly WorkerMetrics[] = [];
  workerHistory: ReadonlyMap<string, readonly HostMetrics[]> = new Map();
  workersError = "";
  expandedLists: ReadonlySet<string> = new Set();
  readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;
  readonly #shown: () => boolean;
  readonly #groups: () => readonly SessionGroup[];
  readonly #load: () => Promise<HostMetrics>;
  readonly #loadWorkers: () => Promise<readonly WorkerMetrics[]>;
  #foldedFor: readonly SessionGroup[] | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  /** One read in flight per machine list, so a worker that is slow to answer never holds back this gateway's own
   * cards or the next poll of them. */
  #pendingHost: Promise<void> | undefined;
  #pendingWorkers: Promise<void> | undefined;

  constructor(host: Pick<ReactiveControllerHost, "requestUpdate" | "addController">, shown: () => boolean, groups: () => readonly SessionGroup[], load: () => Promise<HostMetrics> = loadHostMetrics, loadWorkers: () => Promise<readonly WorkerMetrics[]> = loadWorkerMetrics) {
    this.#host = host;
    this.#shown = shown;
    this.#groups = groups;
    this.#load = load;
    this.#loadWorkers = loadWorkers;
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
    this.#pendingHost ??= this.#readHost().finally(() => { this.#pendingHost = undefined; });
    this.#pendingWorkers ??= this.#readWorkers().finally(() => { this.#pendingWorkers = undefined; });
  };

  async #readHost(): Promise<void> {
    const changed = await this.#load().then((metrics) => this.#applyHost(metrics), (error: unknown) => this.#failHost(message(error)));
    if (changed) this.#host.requestUpdate();
  }

  async #readWorkers(): Promise<void> {
    const changed = await this.#loadWorkers().then((workers) => this.#applyWorkers(workers), (error: unknown) => this.#failWorkers(message(error)));
    if (changed) this.#host.requestUpdate();
  }

  #failHost(failure: string): boolean {
    if (failure === this.error) return false;
    this.error = failure;
    return true;
  }

  #failWorkers(failure: string): boolean {
    if (failure === this.workersError) return false;
    this.workersError = failure;
    return true;
  }

  #applyHost(metrics: HostMetrics): boolean {
    if (!this.error && metrics.sampledAt === this.metrics?.sampledAt) return false;
    this.metrics = metrics;
    this.error = "";
    this.history = sampled(this.history, metrics);
    return true;
  }

  #applyWorkers(workers: readonly WorkerMetrics[]): boolean {
    const changed = Boolean(this.workersError) || !unchanged(this.workers, workers);
    this.workersError = "";
    if (!changed) return false;
    // A worker that cannot report right now keeps the samples it had; one that is gone leaves the map.
    const history = new Map<string, readonly HostMetrics[]>();
    for (const worker of workers) {
      const samples = worker.metrics ? sampled(this.workerHistory.get(worker.id), worker.metrics) : this.workerHistory.get(worker.id);
      if (samples) history.set(worker.id, samples);
    }
    this.workers = workers;
    this.workerHistory = history;
    return true;
  }
}
