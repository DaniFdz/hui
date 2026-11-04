/**
 * Owns the Dashboard page's activity monitor: the poll that runs while the page shows and the document is visible (it
 * stops itself once the page is gone, however the app left it), each machine's last read or error, the samples its
 * chart draws for this gateway's host and every worker (`history` on open and when the chart changes, then one sample
 * per poll), which machines the chart and cards show, the metric and window it draws, and which session lists show
 * every row instead of the first three. A list folds again when the page is left or the list shrinks to three rows.
 * The session counts come from the session list the app already holds.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadHostMetrics, loadHostMetricsHistory } from "../api/control-surfaces.ts";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup } from "../api/schema/sessions.ts";
import { loadWorkerMetrics, loadWorkerMetricsHistory, type WorkerMetrics } from "../api/workers.ts";
import { DASHBOARD_ROWS, NEEDS_YOU_LIST, summarizeSessions } from "../lib/dashboard.ts";
import { CHART_WINDOWS, type ChartMetric, type ChartWindow } from "../lib/metric-chart.ts";

export const DASHBOARD_POLL_MS = 5_000;
export const DASHBOARD_HISTORY_MS = 30 * 60_000;
/** This gateway's machine, named the way a session's worker is. */
export const GATEWAY_MACHINE = "gateway";
/** A read further apart than this from the last one left a gap the chart cannot fill from its samples. */
const GAP_MS = 30_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A host's samples, plus any this browser read after the one it reported. */
function joined(history: readonly HostMetrics[], known: readonly HostMetrics[]): readonly HostMetrics[] {
  const byTime = new Map(history.map((sample) => [sample.sampledAt, sample] as const));
  for (const sample of known) if (!byTime.has(sample.sampledAt)) byTime.set(sample.sampledAt, sample);
  return [...byTime.values()].sort((one, other) => Date.parse(one.sampledAt) - Date.parse(other.sampledAt));
}

const unchanged = (previous: readonly WorkerMetrics[], next: readonly WorkerMetrics[]) =>
  previous.length === next.length && previous.every((worker, index) => {
    const other = next[index];
    return other !== undefined && worker.id === other.id && worker.name === other.name && worker.state === other.state
      && worker.error === other.error && worker.metrics?.sampledAt === other.metrics?.sampledAt;
  });

export class DashboardController implements ReactiveController {
  metrics: HostMetrics | undefined;
  error = "";
  workers: readonly WorkerMetrics[] = [];
  workersError = "";
  chartMetric: ChartMetric = "cpu";
  chartWindow: ChartWindow = CHART_WINDOWS[0];
  /** Machines whose cards and line the operator hid; a new worker shows until it is hidden too. */
  hiddenMachines: ReadonlySet<string> = new Set();
  /** Each machine's samples, this gateway's under `GATEWAY_MACHINE`. */
  samples: ReadonlyMap<string, readonly HostMetrics[]> = new Map();
  /** The instant the pointer (or the keyboard) is on in the chart, or none. */
  chartHover: number | null = null;
  expandedLists: ReadonlySet<string> = new Set();
  readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;
  readonly #shown: () => boolean;
  readonly #groups: () => readonly SessionGroup[];
  readonly #load: () => Promise<HostMetrics>;
  readonly #loadWorkers: () => Promise<readonly WorkerMetrics[]>;
  readonly #loadHistory: (minutes: number) => Promise<readonly HostMetrics[]>;
  readonly #loadWorkerHistory: (minutes: number, ids: readonly string[]) => Promise<ReadonlyMap<string, readonly HostMetrics[]>>;
  #foldedFor: readonly SessionGroup[] | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  /** One read in flight per machine list, so a worker that is slow to answer never holds back this gateway's own
   * cards or the next poll of them. */
  #pendingHost: Promise<void> | undefined;
  #pendingWorkers: Promise<void> | undefined;
  #pendingHistory: Promise<void> | undefined;

  constructor(
    host: Pick<ReactiveControllerHost, "requestUpdate" | "addController">, shown: () => boolean, groups: () => readonly SessionGroup[],
    load: () => Promise<HostMetrics> = loadHostMetrics, loadWorkers: () => Promise<readonly WorkerMetrics[]> = loadWorkerMetrics,
    loadHistory: (minutes: number) => Promise<readonly HostMetrics[]> = loadHostMetricsHistory,
    loadWorkerHistory: (minutes: number, ids: readonly string[]) => Promise<ReadonlyMap<string, readonly HostMetrics[]>> = loadWorkerMetricsHistory,
  ) {
    this.#host = host;
    this.#shown = shown;
    this.#groups = groups;
    this.#load = load;
    this.#loadWorkers = loadWorkers;
    this.#loadHistory = loadHistory;
    this.#loadWorkerHistory = loadWorkerHistory;
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

  /** Whether the machine's cards and line show: this gateway's, a worker's, or one the operator can chart. */
  shows(machine: string): boolean {
    return !this.hiddenMachines.has(machine);
  }

  toggleMachine = (machine: string): void => {
    const next = new Set(this.hiddenMachines);
    if (!next.delete(machine)) next.add(machine);
    this.hiddenMachines = next;
    this.#host.requestUpdate();
    void this.#readHistory();
  };

  setChartHover = (at: number | null): void => {
    if (at === this.chartHover) return;
    this.chartHover = at;
    this.#host.requestUpdate();
  };

  setChartMetric = (metric: ChartMetric): void => {
    if (metric === this.chartMetric) return;
    this.chartMetric = metric;
    this.#host.requestUpdate();
  };

  setChartWindow = (minutes: ChartWindow): void => {
    if (minutes === this.chartWindow) return;
    this.chartWindow = minutes;
    this.#host.requestUpdate();
    void this.#readHistory();
  };

  start(): void {
    if (this.#timer !== undefined) return;
    this.refresh();
    void this.#readHistory();
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
    await this.#load().then((metrics) => {
      const gap = this.#keep(GATEWAY_MACHINE, metrics);
      if (this.#applyHost(metrics)) this.#host.requestUpdate();
      if (gap) void this.#readHistory();
    }, (error: unknown) => {
      if (this.#failHost(message(error))) this.#host.requestUpdate();
    });
  }

  async #readWorkers(): Promise<void> {
    await this.#loadWorkers().then((workers) => {
      const known = new Set(this.workers.map((worker) => worker.id));
      const gap = workers.reduce((seen, worker) => this.#keep(worker.id, worker.metrics) || seen, false);
      // A worker that reported for the first time has a line to fill from its host.
      const arrived = workers.some((worker) => worker.metrics && this.shows(worker.id) && !known.has(worker.id));
      if (this.#applyWorkers(workers)) this.#host.requestUpdate();
      if (gap || arrived) void this.#readHistory();
    }, (error: unknown) => {
      if (this.#failWorkers(message(error))) this.#host.requestUpdate();
    });
  }

  /** Reads the visible machines' samples again, after the page opens, a window or a machine changes, or a poll found
   * a gap. A call while one is in flight waits for it and reads once more, so a machine that just appeared is asked
   * for its own samples too. */
  #readHistory(): Promise<void> {
    const queued = (this.#pendingHistory ?? Promise.resolve()).then(() => this.#fetchHistory());
    const tracked = queued.finally(() => { if (this.#pendingHistory === tracked) this.#pendingHistory = undefined; });
    this.#pendingHistory = tracked;
    return tracked;
  }

  async #fetchHistory(): Promise<void> {
    const minutes = this.chartWindow;
    const host = this.shows(GATEWAY_MACHINE) ? this.#loadHistory(minutes).catch(() => undefined) : undefined;
    const ids = this.workers.filter((worker) => worker.metrics && this.shows(worker.id)).map((worker) => worker.id);
    const workers = ids.length ? this.#loadWorkerHistory(minutes, ids).catch(() => undefined) : undefined;
    const [hostSamples, workerSamples] = await Promise.all([host, workers]);
    // A slower answer for another window is dropped: the chart shows what it asked for.
    if (minutes !== this.chartWindow) return;
    const samples = new Map(this.samples);
    if (hostSamples) samples.set(GATEWAY_MACHINE, joined(hostSamples, this.samples.get(GATEWAY_MACHINE) ?? []));
    for (const [id, history] of workerSamples ?? []) samples.set(id, joined(history, this.samples.get(id) ?? []));
    for (const id of samples.keys()) {
      if (id !== GATEWAY_MACHINE && !this.workers.some((worker) => worker.id === id)) samples.delete(id);
    }
    this.samples = samples;
    this.#host.requestUpdate();
  }

  /** Adds a poll's sample to its machine's line, and says whether it left a gap. */
  #keep(machine: string, metrics: HostMetrics | undefined): boolean {
    if (!metrics || !this.shows(machine)) return false;
    const known = this.samples.get(machine) ?? [];
    if (known.at(-1)?.sampledAt === metrics.sampledAt) return false;
    const last = known.at(-1);
    const gap = last === undefined ? false : Date.parse(metrics.sampledAt) - Date.parse(last.sampledAt) > GAP_MS;
    const cutoff = Date.parse(metrics.sampledAt) - DASHBOARD_HISTORY_MS;
    const samples = new Map(this.samples);
    samples.set(machine, [...known, metrics].filter((sample) => Date.parse(sample.sampledAt) >= cutoff));
    this.samples = samples;
    return gap;
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
    return true;
  }

  #applyWorkers(workers: readonly WorkerMetrics[]): boolean {
    const changed = Boolean(this.workersError) || !unchanged(this.workers, workers);
    this.workersError = "";
    if (!changed) return false;
    this.workers = workers;
    return true;
  }
}
