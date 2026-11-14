/**
 * Owns the Dashboard page's activity monitor: the poll that runs while the page shows and the document is visible (it
 * stops itself once the page is gone, however the app left it), each machine's last read or error, the samples its
 * chart draws for this gateway's host and every worker (`history` on open and when the chart changes, then one sample
 * per poll), which machines the chart and cards show, the metric and window it draws, and which session lanes show
 * every row instead of the first three. A lane folds again when the page is left or it shrinks to three rows.
 * The session counts and lanes come from the session list the app already holds, narrowed by the filters the operator
 * sets, which survive leaving the page and back. It also answers a waiting session and resumes a stopped one, one
 * action at a time per session, keeping the last action's error until the operator dismisses it or the next action
 * starts. A successful action keeps its session blocked until the session list shows the change it asked for, because
 * the row that was clicked lives until the next list frame; a failure frees it at once. The session list itself still
 * arrives on the app's own stream.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadHostMetrics, loadHostMetricsHistory } from "../api/control-surfaces.ts";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import { answerQuestion, resumeSession } from "../api/sessions.ts";
import { loadWorkerMetrics, loadWorkerMetricsHistory, type WorkerMetrics } from "../api/workers.ts";
import { DASHBOARD_ROWS, EMPTY_FILTERS, summarizeSessions, type SessionFilters } from "../lib/dashboard.ts";
import { CHART_WINDOWS, type ChartMetric, type ChartWindow } from "../lib/metric-chart.ts";

export const DASHBOARD_POLL_MS = 5_000;
export const DASHBOARD_HISTORY_MS = 30 * 60_000;
/** This gateway's machine, named the way a session's worker is. */
export const GATEWAY_MACHINE = "gateway";
/** A read further apart than this from the last one left a gap the chart cannot fill from its samples. */
const GAP_MS = 30_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What answering a waiting session sends: a chosen value or a confirmation. */
type AnswerChoice = { value: string } | { confirmed: boolean };

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
  /** Expanded lane keys; a lane stays open only while it has more than `DASHBOARD_ROWS` sessions. */
  expandedLists: ReadonlySet<string> = new Set();
  /** What narrows the lanes; it survives leaving the page and back, and a reload clears it. */
  filters: SessionFilters = EMPTY_FILTERS;
  /** Sessions with an action in flight, so a second click asks the gateway nothing. A session stays here after a
   * successful request until the list shows its outcome. */
  busy: ReadonlySet<string> = new Set();
  /** The last action's failure, shown until the operator dismisses it or the next action starts. */
  actionError = "";
  readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;
  readonly #shown: () => boolean;
  readonly #groups: () => readonly SessionGroup[];
  readonly #load: () => Promise<HostMetrics>;
  readonly #loadWorkers: () => Promise<readonly WorkerMetrics[]>;
  readonly #loadHistory: (minutes: number) => Promise<readonly HostMetrics[]>;
  readonly #loadWorkerHistory: (minutes: number, ids: readonly string[]) => Promise<ReadonlyMap<string, readonly HostMetrics[]>>;
  readonly #answer: (id: string, questionId: string, answer: AnswerChoice) => Promise<void>;
  readonly #resume: (id: string) => Promise<void>;
  /** The session list and filters the lanes were last folded against. */
  #folded: { groups: readonly SessionGroup[]; filters: SessionFilters } | undefined;
  /** What each successfully acted-on session must no longer show before it is free again: the question it answered,
   * or the status and failed run its resume started from. A session missing from the list is freed too. */
  #awaiting = new Map<string, (session: SessionView | undefined) => boolean>();
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
    answer: (id: string, questionId: string, answer: AnswerChoice) => Promise<void> = answerQuestion,
    resume: (id: string) => Promise<void> = resumeSession,
  ) {
    this.#host = host;
    this.#shown = shown;
    this.#groups = groups;
    this.#load = load;
    this.#loadWorkers = loadWorkers;
    this.#loadHistory = loadHistory;
    this.#loadWorkerHistory = loadWorkerHistory;
    this.#answer = answer;
    this.#resume = resume;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stop();
  }

  hostUpdate(): void {
    this.#release();
    if (!this.expandedLists.size) return;
    if (!this.#shown()) {
      this.expandedLists = new Set();
      this.#folded = undefined;
      return;
    }
    const groups = this.#groups();
    const filters = this.filters;
    if (this.#folded?.groups === groups && this.#folded.filters === filters) return;
    this.#folded = { groups, filters };
    const sizes = new Map<string, number>(summarizeSessions(groups, filters).lanes.map((lane) => [lane.key, lane.sessions.length]));
    const kept = [...this.expandedLists].filter((key) => (sizes.get(key) ?? 0) > DASHBOARD_ROWS);
    if (kept.length < this.expandedLists.size) this.expandedLists = new Set(kept);
  }

  toggleList = (key: string): void => {
    const next = new Set(this.expandedLists);
    if (!next.delete(key)) next.add(key);
    this.expandedLists = next;
    this.#host.requestUpdate();
  };

  /** Narrows the lanes by a patch of the filters; a choice that no longer exists stays set and matches nothing. */
  setFilters = (patch: Partial<SessionFilters>): void => {
    this.filters = { ...this.filters, ...patch };
    this.#host.requestUpdate();
  };

  clearFilters = (): void => {
    this.filters = EMPTY_FILTERS;
    this.#host.requestUpdate();
  };

  dismissActionError = (): void => {
    if (!this.actionError) return;
    this.actionError = "";
    this.#host.requestUpdate();
  };

  /** Answers a waiting session; another click asks nothing while its answer is in flight and until the list shows the
   * question gone, so the row still on screen cannot answer twice. */
  answer = (session: SessionView, question: NonNullable<SessionView["question"]>, answer: AnswerChoice): void => {
    const id = session.id;
    const questionId = question.id;
    void this.#act(id, () => this.#answer(id, questionId, answer), (current) => current?.question?.id !== questionId);
  };

  /** Resumes a stopped session; another click asks nothing until the list shows its status or failed run changed, so
   * the row still on screen cannot resume twice. */
  resume = (session: SessionView): void => {
    const { id, status, runFailed } = session;
    void this.#act(id, () => this.#resume(id), (current) =>
      current === undefined || current.status !== status || current.runFailed !== runFailed);
  };

  /** Runs one action for a session: marks it busy, then settles it with the request's answer or its error. A request
   * that succeeded keeps the session busy until `changed` sees the list catch up; a failure frees it at once, so the
   * operator can try again. */
  async #act(id: string, request: () => Promise<void>, changed: (session: SessionView | undefined) => boolean): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy = new Set(this.busy).add(id);
    this.actionError = "";
    this.#host.requestUpdate();
    try {
      await request();
    } catch (error) {
      this.actionError = message(error);
      this.#free(id);
      this.#host.requestUpdate();
      return;
    }
    this.#awaiting.set(id, changed);
    this.#host.requestUpdate();
  }

  /** Frees a session now: its request failed, so there is nothing to wait for. */
  #free(id: string): void {
    this.#awaiting.delete(id);
    if (!this.busy.has(id)) return;
    const busy = new Set(this.busy);
    busy.delete(id);
    this.busy = busy;
  }

  /** Frees every session a successful action left blocked once the list shows the change it asked for, including one
   * that left the list. No timer guesses: the list itself says whether the row still shows the action's subject. */
  #release(): void {
    if (!this.#awaiting.size) return;
    const sessions = new Map<string, SessionView>();
    for (const group of this.#groups()) for (const session of group.sessions) sessions.set(session.id, session);
    const busy = new Set(this.busy);
    let freed = false;
    for (const [id, changed] of this.#awaiting) {
      if (!changed(sessions.get(id))) continue;
      this.#awaiting.delete(id);
      freed = busy.delete(id) || freed;
    }
    if (freed) this.busy = busy;
  }

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
