/**
 * The Dashboard page (Labs → Dashboard): a summary of the sessions in flight by status with a count of the finished
 * ones, their Kanban stages, the sessions waiting for the operator in priority order with the longest wait first, the
 * ones still in flight grouped by status with their subagents (three rows per list until its Show all button opens
 * it), and the activity monitor: one chart with a line per selected machine over the last 5, 15 or 30 minutes, a
 * switch for the metric it draws, chips that choose the machines it and the cards show, and a card per host metric for
 * each of them with its value and a bar. A metric that reads above 85% is marked; one the host can't report says so.
 * A value too long for its card wraps between its parts, and the disk path keeps its end on one line.
 */
import { html, nothing, svg, type TemplateResult } from "lit";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import type { WorkerMetrics } from "../api/workers.ts";
import { DASHBOARD_ROWS, DASHBOARD_STATUSES, DASHBOARD_STATUS_LABELS, NEEDS_YOU_LIST, summarizeSessions, type SessionSummary } from "../lib/dashboard.ts";
import { SESSION_STAGES, SESSION_STAGE_LABELS, isSessionStage } from "../lib/kanban.ts";
import { relativeTime } from "../lib/message-metadata.ts";
import { CHART_METRICS, CHART_METRIC_KEYS, CHART_WINDOWS, chartSeries, snapTime, valueAt, type ChartMetric, type ChartWindow } from "../lib/metric-chart.ts";
import { navigationPath } from "../lib/navigation.ts";
import { pullRequestAccessibleLabel, pullRequestStateLabel } from "../lib/pull-requests.ts";
import { loadViewAssets } from "../lib/view-assets.ts";
import { formatBytes } from "../lib/worktrees.ts";

loadViewAssets(() => import("../styles/dashboard.css"));

const HIGH_PERCENT = 85;
/** One colour per machine, in the order its chip appears. */
const SERIES_COLORS = ["var(--session-color-blue)", "var(--session-color-green)", "var(--session-color-purple)", "var(--session-color-orange)", "var(--session-color-pink)", "var(--session-color-cyan)", "var(--session-color-yellow)", "var(--session-color-red)"];

export type DashboardChartProps = {
  /** The machine this gateway runs on, which the controller keys its samples by. */
  gateway: string;
  metric: ChartMetric;
  window: ChartWindow;
  hidden: ReadonlySet<string>;
  samples: ReadonlyMap<string, readonly HostMetrics[]>;
  /** The instant the pointer or the keyboard is on, or none. */
  hover: number | null;
  onMetric: (metric: ChartMetric) => void;
  onWindow: (minutes: ChartWindow) => void;
  onToggleMachine: (machine: string) => void;
  onHover: (at: number | null) => void;
};

export type DashboardProps = {
  groups: readonly SessionGroup[];
  sessionsLoading: boolean;
  sessionsError: string;
  metrics: HostMetrics | undefined;
  metricsError: string;
  workers: readonly WorkerMetrics[];
  workersError: string;
  chart: DashboardChartProps;
  expandedLists: ReadonlySet<string>;
  now: number;
  onRetry: () => void;
  onToggleList: (key: string) => void;
  onOpenSession: (session: SessionView) => void;
};

type Metric = { value: string; detail: string; path?: string; percent?: number };

const percentLabel = (value: number) => `${Math.round(value)}%`;
const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
const rate = (arrow: string, bytes: number) => `${arrow} ${formatBytes(bytes)}/s`.replaceAll(" ", "\u00a0");
const updatedAgo = (updatedAt: string, now: number) => {
  const updated = Date.parse(updatedAt);
  return Number.isNaN(updated) ? nothing : html`<time class="dashboard-session__time" datetime=${updatedAt}>${relativeTime(updated, now)}</time>`;
};

/** What a machine is called here, and what this page knows about it. */
type Machine = { id: string; name: string; metrics?: HostMetrics; note?: string };

const WORKER_STATE_NOTES: Record<WorkerMetrics["state"], string> = {
  connected: "Reading this machine's metrics…",
  connecting: "Connecting…",
  disconnected: "HUI is not connected to this worker, so its activity is not read here.",
  error: "HUI cannot reach this worker.",
};

const machines = (props: DashboardProps, gateway: string): Machine[] => [
  { id: gateway, name: "This gateway", metrics: props.metrics, note: props.metricsError ? `Could not read this machine: ${props.metricsError}` : props.metrics ? undefined : "Reading this machine's metrics…" },
  ...props.workers.map((worker) => ({ id: worker.id, name: worker.name, metrics: worker.metrics, note: worker.metrics ? undefined : worker.error ?? WORKER_STATE_NOTES[worker.state] })),
];

const valueLabel = (metric: ChartMetric, value: number | null) => value === null ? "—"
  : metric === "network" ? `${formatBytes(value)}/s` : percentLabel(value);

function card(id: string, title: string, metric: Metric | null) {
  if (!metric) {
    return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric"><div class="dashboard-metric__head"><span class="dashboard-metric__title">${title}</span></div><p class="dashboard-metric__unavailable">Not available on this host</p></article>`;
  }
  const high = metric.percent !== undefined && Math.round(metric.percent) > HIGH_PERCENT;
  return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric ${high ? "dashboard-metric--high" : ""}">
    <div class="dashboard-metric__head"><span class="dashboard-metric__title">${title}</span><strong class="dashboard-metric__value">${metric.value}</strong></div>
    ${metric.percent === undefined ? nothing : html`<div class="dashboard-metric__bar" role="meter" aria-label=${`${title} use`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(metric.percent)}><span style=${`width: ${Math.min(100, metric.percent)}%`}></span></div>`}
    <small class="dashboard-metric__detail">${metric.detail}${metric.path ? html`<span class="dashboard-metric__path" title=${metric.path}><span dir="ltr">${metric.path}</span></span>` : nothing}</small>
  </article>`;
}

function hostCards(metrics: HostMetrics, processTitle: string) {
  const { cpu, memory, disk, network, gpu, gateway } = metrics;
  const memoryPercent = share(memory.usedBytes, memory.totalBytes);
  return [
    card("cpu", "CPU", {
      value: percentLabel(cpu.percent), percent: cpu.percent,
      detail: `Load ${cpu.load.map((value) => value.toFixed(2)).join(" · ")} · ${metrics.host.cores} cores`,
    }),
    card("memory", "Memory", {
      value: percentLabel(memoryPercent), percent: memoryPercent,
      detail: `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}${memory.swapUsedBytes === undefined ? "" : ` · swap ${formatBytes(memory.swapUsedBytes)}`}`,
    }),
    card("disk", "Disk", disk && {
      value: percentLabel(share(disk.usedBytes, disk.totalBytes)), percent: share(disk.usedBytes, disk.totalBytes),
      detail: `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)}`, path: disk.path,
    }),
    card("gpu", "GPU", gpu && { value: percentLabel(gpu.percent), percent: gpu.percent, detail: "Busiest accelerator" }),
    card("network", "Network", network && {
      value: `${rate("↓", network.rxBytesPerSecond)} ${rate("↑", network.txBytesPerSecond)}`,
      detail: "Physical interfaces",
    }),
    card("gateway", processTitle, {
      value: percentLabel(gateway.cpuPercent),
      detail: `CPU of one core · ${formatBytes(gateway.rssBytes)} resident`,
    }),
  ];
}

/** Every point of one line, as the SVG path data the plot draws. */
const y = (share: number) => 35.5 - Math.min(1, Math.max(0, share)) * 35;

/** The instant a pointer at this x of the plot names. */
function timeFromPointer(event: PointerEvent, window: ChartWindow, now: number): number | null {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!rect.width) return null;
  const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return now - window * 60_000 + share * window * 60_000;
}

/** The plot's own key handling: the arrow keys step through the window, Home and End jump to its ends. */
function hoverKey(event: KeyboardEvent, state: DashboardChartProps, now: number): number | null | undefined {
  const step = (state.window * 60_000) / 50;
  if (event.key === "Escape") return null;
  if (event.key === "Home") return now - state.window * 60_000;
  if (event.key === "End") return now;
  if (event.key === "ArrowLeft") return (state.hover ?? now) - step;
  if (event.key === "ArrowRight") return Math.min(now, (state.hover ?? now) + step);
  return undefined;
}

/** The one chart: a line per shown machine over the window for the metric the switch picks, with the reading under the
 * pointer (or the keyboard) marked and listed. */
function chart(props: DashboardProps, shown: readonly Machine[]) {
  const { chart: state } = props;
  const start = props.now - state.window * 60_000;
  const sampled = shown.map((machine) => state.samples.get(machine.id) ?? []);
  const { top, series } = chartSeries(sampled, state.metric, state.window, props.now);
  const colored = shown.map((machine, index) => ({ machine, series: series[index]!, color: SERIES_COLORS[index % SERIES_COLORS.length]! }));
  const lines = colored.filter((line) => line.series.points.length > 1);
  const snapped = state.hover === null ? null : snapTime(series, state.hover);
  const picked = snapped === null ? [] : colored
    .map((line) => ({ ...line, point: valueAt(line.series, snapped) }))
    .sort((one, other) => (other.point?.y ?? -1) - (one.point?.y ?? -1));
  const crosshair = snapped === null ? null : ((snapped - start) / (props.now - start)) * 100;
  const shownValue = (value: number | null) => valueLabel(state.metric, value);
  const summary = picked.map((line) => `${line.machine.name} ${shownValue(line.point ? line.point.y * top : null)}`).join(", ");
  return html`<figure class="dashboard-chart" data-testid="dashboard-chart">
    <div class="dashboard-chart__plot" data-testid="dashboard-chart-plot" tabindex="0" role="img"
      aria-label=${`${CHART_METRICS[state.metric].label} over the last ${state.window} minutes: ${colored.map((line) => `${line.machine.name} ${shownValue(line.series.latest)}`).join(", ") || "no machine shown"}. Arrow keys read the values under a time.`}
      @pointermove=${(event: PointerEvent) => state.onHover(timeFromPointer(event, state.window, props.now))}
      @pointerdown=${(event: PointerEvent) => state.onHover(timeFromPointer(event, state.window, props.now))}
      @pointerleave=${(event: PointerEvent) => { if (event.pointerType === "mouse") state.onHover(null); }}
      @pointercancel=${() => state.onHover(null)}
      @keydown=${(event: KeyboardEvent) => {
        const at = hoverKey(event, state, props.now);
        if (at === undefined) return;
        event.preventDefault();
        state.onHover(at);
      }}
      @blur=${() => state.onHover(null)}>
      ${svg`<svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
        <line class="dashboard-chart__grid" x1="0" x2="100" y1=${y(0.5)} y2=${y(0.5)}></line>
        ${lines.map((line) => svg`<polyline class="dashboard-chart__line" points=${line.series.points.map((point) => `${(point.x * 100).toFixed(2)},${y(point.y).toFixed(2)}`).join(" ")} style=${`stroke: ${line.color}`}></polyline>`)}
        ${crosshair === null ? nothing : svg`<line class="dashboard-chart__crosshair" data-testid="dashboard-chart-crosshair" x1=${crosshair} x2=${crosshair} y1="0" y2="36"></line>`}
        ${picked.map((line) => line.point ? svg`<line class="dashboard-chart__dot-halo" x1=${line.point.x * 100} x2=${line.point.x * 100} y1=${y(line.point.y)} y2=${y(line.point.y)}></line><line class="dashboard-chart__dot" x1=${line.point.x * 100} x2=${line.point.x * 100} y1=${y(line.point.y)} y2=${y(line.point.y)} style=${`stroke: ${line.color}`}></line>` : nothing)}
      </svg>`}
      <span class="dashboard-chart__top">${shownValue(top)}</span>
      ${snapped === null ? nothing : html`<div class="dashboard-chart__tip" data-testid="dashboard-chart-tip" style=${`left: ${Math.min(88, Math.max(12, crosshair ?? 0))}%`}>
        <span class="dashboard-chart__tip-time">${new Date(snapped).toLocaleTimeString()}</span>
        <ul>${picked.map((line) => html`<li><span class="dashboard-chart__swatch" style=${`background: ${line.color}`}></span>${line.machine.name}<strong>${line.point ? shownValue(line.point.y * top) : "—"}</strong></li>`)}</ul>
      </div>`}
    </div>
    <figcaption class="dashboard-legend dashboard-legend--chart">${colored.map((line) => html`<span class="dashboard-chart__key"><span class="dashboard-chart__swatch" style=${`background: ${line.color}`}></span>${line.machine.name}<strong>${shownValue(line.series.latest)}</strong></span>`)}</figcaption>
    <p class="sr-only" aria-live="polite">${crosshair === null ? "" : `${new Date(snapped!).toLocaleTimeString()}: ${summary}`}</p>
  </figure>`;
}

function machineChip(props: DashboardProps, machine: Machine, index: number) {
  const shown = !props.chart.hidden.has(machine.id);
  return html`<button type="button" class="dashboard-machine ${shown ? "dashboard-machine--on" : ""}" aria-pressed=${shown} @click=${() => props.chart.onToggleMachine(machine.id)}><span class="dashboard-chart__swatch" style=${`background: ${shown ? SERIES_COLORS[index % SERIES_COLORS.length] : "transparent"}`}></span>${machine.name}</button>`;
}

function machineBlock(machine: Machine, processTitle: string) {
  return html`<article class="dashboard-host" data-testid="dashboard-machine">
    <header class="dashboard-host__head"><h3 class="dashboard-host__name">${machine.name}</h3><p class="dashboard-host__note">${machine.metrics ? `${machine.metrics.host.platform} · sampled ${new Date(machine.metrics.sampledAt).toLocaleTimeString()}` : machine.note}</p></header>
    ${machine.metrics ? html`<div class="dashboard-metrics">${hostCards(machine.metrics, processTitle)}</div>` : nothing}
  </article>`;
}

function activitySection(props: DashboardProps) {
  const { chart: state } = props;
  const all = machines(props, state.gateway);
  const shown = all.filter((machine) => !state.hidden.has(machine.id));
  const retry = html`<button class="btn btn--sm" type="button" @click=${props.onRetry}>Retry</button>`;
  return html`<section class="settings-section" data-testid="dashboard-activity"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Activity</h2><p class="settings-section__desc">This gateway's host and every worker's own machine, sampled every 15 seconds, and every 5 while this page is open. Opening this page never wakes a worker.</p></div></header>
    ${props.metricsError && props.metrics ? html`<div class="callout warning dashboard-callout" role="alert">The last read of this machine failed: ${props.metricsError}. Showing the one before.${retry}</div>` : nothing}
    ${props.workersError ? html`<div class="callout warning dashboard-callout" role="alert">Could not read the workers: ${props.workersError}</div>` : nothing}
    <div class="dashboard-machines" role="group" aria-label="Machines">${all.map((machine, index) => machineChip(props, machine, index))}</div>
    <div class="dashboard-chart-controls">
      <div class="settings-segmented" role="group" aria-label="Metric">${CHART_METRIC_KEYS.map((key) => html`<button type="button" class="settings-segmented__btn ${state.metric === key ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.metric === key} @click=${() => state.onMetric(key)}>${CHART_METRICS[key].label}</button>`)}</div>
      <div class="settings-segmented" role="group" aria-label="Window">${CHART_WINDOWS.map((minutes) => html`<button type="button" class="settings-segmented__btn ${state.window === minutes ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.window === minutes} @click=${() => state.onWindow(minutes)}>${minutes}m</button>`)}</div>
    </div>
    ${shown.length ? chart(props, shown) : html`<p class="dashboard-empty">Pick a machine to chart.</p>`}
    <div class="dashboard-hosts">${shown.map((machine) => machineBlock(machine, machine.id === state.gateway ? "Gateway process" : "Host process"))}</div>
  </section>`;
}

function chip(kind: string, label: string, tone?: string, title?: string) {
  return html`<span class="dashboard-chip dashboard-chip--${kind}" data-tone=${tone ?? nothing} title=${title ?? nothing}>${label}</span>`;
}

function sessionRow(session: SessionView, summary: SessionSummary, showStatus: boolean, props: DashboardProps) {
  const target = { kind: "session", id: session.id } as const;
  const subagents = summary.subagents.get(session.id);
  return html`<li><a class="dashboard-session" href=${navigationPath(target)} @click=${(event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpenSession(session);
  }}>
    <span class="dashboard-dot" data-status=${session.status} aria-hidden="true"></span>
    <span class="dashboard-session__name" title=${session.title}>${session.title}</span>
    ${updatedAgo(session.updatedAt, props.now)}
    <span class="dashboard-session__meta">
      ${showStatus ? chip("status", DASHBOARD_STATUS_LABELS[session.status], session.status) : nothing}
      ${session.unread ? chip("unread", "Unread") : nothing}
      ${isSessionStage(session.stage) ? chip("stage", SESSION_STAGE_LABELS[session.stage], session.stage) : nothing}
      ${session.worker ? chip("worker", session.worker.name, undefined, session.worker.name) : nothing}
      ${subagents ? chip("subagent", `${subagents.total} subagent${subagents.total === 1 ? "" : "s"}${subagents.active ? ` · ${subagents.active} running` : ""}`) : nothing}
      ${(session.pullRequests ?? []).map((pullRequest) => chip("pr", `#${pullRequest.number}${pullRequest.state ? ` ${pullRequestStateLabel(pullRequest.state)}` : ""}`,
        pullRequest.state ?? "unknown", pullRequestAccessibleLabel(pullRequest)))}
    </span>
  </a></li>`;
}

function summaryCard(summary: SessionSummary) {
  const present = DASHBOARD_STATUSES.filter((status) => summary.statuses[status]);
  const counts = present.map((status) => `${summary.statuses[status]} ${DASHBOARD_STATUS_LABELS[status]}`);
  const needsYou = summary.needsYou.length;
  return html`<div class="dashboard-summary" data-testid="dashboard-summary">
    <div class="dashboard-summary__head">
      <strong class="dashboard-summary__total">${summary.total || !summary.finished ? `${summary.total} session${summary.total === 1 ? "" : "s"}` : "No sessions in flight"}${summary.finished ? html` <span class="dashboard-summary__finished">· ${summary.finished} finished</span>` : nothing}</strong>
      <span class="dashboard-summary__state ${needsYou ? "dashboard-summary__state--attention" : ""}">${needsYou ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : "Nothing needs you"}</span>
    </div>
    ${present.length ? html`
      <div class="dashboard-summary__bar" role="img" aria-label=${`Sessions by status: ${counts.join(", ")}`}>${present.map((status) => html`<span class="dashboard-summary__segment" data-status=${status} style=${`flex-grow: ${summary.statuses[status]}`}></span>`)}</div>
      <ul class="dashboard-legend" aria-hidden="true">${present.map((status, index) => html`<li><span class="dashboard-dot" data-status=${status}></span>${counts[index]}</li>`)}</ul>` : nothing}
  </div>`;
}

function stagePipeline(summary: SessionSummary) {
  return html`<ol class="dashboard-stages" data-testid="dashboard-stage-counts" aria-label="Sessions by stage">${SESSION_STAGES.map((stage) => html`<li class="dashboard-stage ${summary.stages[stage] ? "" : "dashboard-stage--zero"}" data-stage=${stage}><strong>${summary.stages[stage]}</strong><span>${SESSION_STAGE_LABELS[stage]}</span></li>`)}</ol>`;
}

function sessionsSection(props: DashboardProps) {
  const summary = summarizeSessions(props.groups);
  const empty = !props.groups.length;
  const list = (key: string, sessions: readonly SessionView[], showStatus: boolean, className: string) => {
    const id = `dashboard-list-${key}`;
    const expanded = props.expandedLists.has(key);
    const shown = expanded ? sessions : sessions.slice(0, DASHBOARD_ROWS);
    return html`<ul id=${id} class=${className}>${shown.map((session) => sessionRow(session, summary, showStatus, props))}</ul>
      ${sessions.length > DASHBOARD_ROWS ? html`<button class="dashboard-more" type="button" aria-controls=${id} aria-expanded=${String(expanded)} @click=${() => props.onToggleList(key)}>${expanded ? "Show fewer" : `Show all ${sessions.length}`}</button>` : nothing}`;
  };
  return html`<section class="settings-section"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Sessions</h2><p class="settings-section__desc">A session idle in Done counts as finished and is not listed; one that stopped anywhere else needs you, a question first, then a stopped session, an unread answer and parked work, each longest wait first. Subagents show on their parent; archived sessions are left out.</p></div></header>
    ${props.sessionsError ? html`<div class="callout danger" role="alert">${props.sessionsError}</div>` : nothing}
    ${empty && props.sessionsLoading ? html`<div role="status">Reading sessions…</div>` : html`
      ${summaryCard(summary)}
      ${summary.needsYou.length ? html`<div class="dashboard-needs-you" data-testid="dashboard-needs-you">
        <h3 class="dashboard-subheading">Needs you <span class="dashboard-subheading__count">${summary.needsYou.length}</span></h3>
        ${list(NEEDS_YOU_LIST, summary.needsYou, true, "dashboard-sessions")}
      </div>` : nothing}
      ${stagePipeline(summary)}
      ${summary.groups.length
        ? html`<div class="dashboard-groups" data-testid="dashboard-active-sessions">${summary.groups.map((group) => html`
          <h3 class="dashboard-subheading">${group.label} <span class="dashboard-subheading__count">${group.sessions.length}</span></h3>
          ${list(group.key, group.sessions, false, "settings-group dashboard-sessions")}`)}</div>`
        : summary.total || summary.finished ? nothing : html`<p class="dashboard-empty">No sessions yet.</p>`}`}
  </section>`;
}

export function renderDashboard(props: DashboardProps): TemplateResult {
  return html`<header class="content-header content-header--settings"><div><div class="page-title">Dashboard</div><div class="page-subtitle">The sessions in flight and the resource use of the machines that run them.</div></div></header>
    <main class="settings-page settings-page--wide dashboard-page" data-testid="dashboard">${sessionsSection(props)}${activitySection(props)}</main>`;
}
