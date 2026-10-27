/**
 * The Dashboard page (Labs → Dashboard): a summary of the sessions in flight by status with a count of the finished
 * ones, their Kanban stages, the sessions waiting for the operator, the other sessions that are not idle grouped by
 * status with their subagents (three rows per list until its Show all button opens it), and a card per host metric
 * with its value, a bar and a sparkline of the samples the browser kept. A metric that reads above 85% is marked; one the host can't report
 * says so. A value too long for its card wraps between its parts, and the disk path keeps its end on one line.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import { DASHBOARD_ROWS, DASHBOARD_STATUSES, DASHBOARD_STATUS_LABELS, NEEDS_YOU_LIST, summarizeSessions, type SessionSummary } from "../lib/dashboard.ts";
import { SESSION_STAGES, SESSION_STAGE_LABELS, isSessionStage } from "../lib/kanban.ts";
import { relativeTime } from "../lib/message-metadata.ts";
import { navigationPath } from "../lib/navigation.ts";
import { pullRequestAccessibleLabel, pullRequestStateLabel } from "../lib/pull-requests.ts";
import { loadViewAssets } from "../lib/view-assets.ts";
import { formatBytes } from "../lib/worktrees.ts";

loadViewAssets(() => import("../styles/dashboard.css"));

const HIGH_PERCENT = 85;

export type DashboardProps = {
  groups: readonly SessionGroup[];
  sessionsLoading: boolean;
  sessionsError: string;
  metrics: HostMetrics | undefined;
  history: readonly HostMetrics[];
  metricsError: string;
  expandedLists: ReadonlySet<string>;
  now: number;
  onRetry: () => void;
  onToggleList: (key: string) => void;
  onOpenSession: (session: SessionView) => void;
};

type Metric = { value: string; detail: string; path?: string; percent?: number; series: number[] };

const percentLabel = (value: number) => `${Math.round(value)}%`;
const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
const rate = (arrow: string, bytes: number) => `${arrow} ${formatBytes(bytes)}/s`.replaceAll(" ", "\u00a0");
const updatedAgo = (updatedAt: string, now: number) => {
  const updated = Date.parse(updatedAt);
  return Number.isNaN(updated) ? nothing : html`<time class="dashboard-session__time" datetime=${updatedAt}>${relativeTime(updated, now)}</time>`;
};

function sparkline(series: readonly number[], max?: number) {
  if (series.length < 2) return nothing;
  const top = Math.max(max ?? 0, ...series) || 1;
  const points = series.map((value, index) => `${((index / (series.length - 1)) * 100).toFixed(1)},${(24 - (value / top) * 22).toFixed(1)}`).join(" ");
  return html`<svg class="dashboard-metric__spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points=${points}></polyline></svg>`;
}

function card(id: string, title: string, metric: Metric | null) {
  if (!metric) {
    return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric"><div class="dashboard-metric__head"><span class="dashboard-metric__title">${title}</span></div><p class="dashboard-metric__unavailable">Not available on this host</p></article>`;
  }
  const high = metric.percent !== undefined && Math.round(metric.percent) > HIGH_PERCENT;
  return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric ${high ? "dashboard-metric--high" : ""}">
    <div class="dashboard-metric__head"><span class="dashboard-metric__title">${title}</span><strong class="dashboard-metric__value">${metric.value}</strong></div>
    ${metric.percent === undefined ? nothing : html`<div class="dashboard-metric__bar" role="meter" aria-label=${`${title} use`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(metric.percent)}><span style=${`width: ${Math.min(100, metric.percent)}%`}></span></div>`}
    <small class="dashboard-metric__detail">${metric.detail}${metric.path ? html`<span class="dashboard-metric__path" title=${metric.path}><span dir="ltr">${metric.path}</span></span>` : nothing}</small>
    ${sparkline(metric.series, metric.percent === undefined ? undefined : 100)}
  </article>`;
}

function hostCards(metrics: HostMetrics, history: readonly HostMetrics[]) {
  const series = (read: (sample: HostMetrics) => number | null | undefined) =>
    history.map(read).filter((value): value is number => typeof value === "number");
  const { cpu, memory, disk, network, gpu, gateway } = metrics;
  const memoryPercent = share(memory.usedBytes, memory.totalBytes);
  return [
    card("cpu", "CPU", {
      value: percentLabel(cpu.percent), percent: cpu.percent, series: series((sample) => sample.cpu.percent),
      detail: `Load ${cpu.load.map((value) => value.toFixed(2)).join(" · ")} · ${metrics.host.cores} cores`,
    }),
    card("memory", "Memory", {
      value: percentLabel(memoryPercent), percent: memoryPercent, series: series((sample) => share(sample.memory.usedBytes, sample.memory.totalBytes)),
      detail: `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}${memory.swapUsedBytes === undefined ? "" : ` · swap ${formatBytes(memory.swapUsedBytes)}`}`,
    }),
    card("disk", "Disk", disk && {
      value: percentLabel(share(disk.usedBytes, disk.totalBytes)), percent: share(disk.usedBytes, disk.totalBytes),
      series: series((sample) => sample.disk && share(sample.disk.usedBytes, sample.disk.totalBytes)),
      detail: `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)}`, path: disk.path,
    }),
    card("gpu", "GPU", gpu && { value: percentLabel(gpu.percent), percent: gpu.percent, series: series((sample) => sample.gpu?.percent), detail: "Busiest accelerator" }),
    card("network", "Network", network && {
      value: `${rate("↓", network.rxBytesPerSecond)} ${rate("↑", network.txBytesPerSecond)}`,
      series: series((sample) => sample.network && sample.network.rxBytesPerSecond + sample.network.txBytesPerSecond),
      detail: "Physical interfaces",
    }),
    card("gateway", "Gateway process", {
      value: percentLabel(gateway.cpuPercent), series: series((sample) => sample.gateway.cpuPercent),
      detail: `CPU of one core · ${formatBytes(gateway.rssBytes)} resident`,
    }),
  ];
}

function hostSection(props: DashboardProps) {
  const { metrics, metricsError } = props;
  const retry = html`<button class="btn btn--sm" type="button" @click=${props.onRetry}>Retry</button>`;
  return html`<section class="settings-section"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Gateway host</h2><p class="settings-section__desc">${metrics ? `${metrics.host.platform} · sampled ${new Date(metrics.sampledAt).toLocaleTimeString()} · every 5 seconds while this page is open` : "Every 5 seconds while this page is open"}</p></div></header>
    ${metricsError ? html`<div class="callout ${metrics ? "warning" : "danger"} dashboard-callout" role="alert">${metrics ? `The last read failed: ${metricsError}. Showing the one before.` : `Could not read the host's metrics: ${metricsError}`}${retry}</div>` : nothing}
    ${metrics ? html`<div class="dashboard-metrics" data-testid="dashboard-metrics">${hostCards(metrics, props.history)}</div>`
      : metricsError ? nothing : html`<div role="status">Reading the host's metrics…</div>`}
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
      ${showStatus ? chip("status", DASHBOARD_STATUS_LABELS[session.status]) : nothing}
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
  const waiting = summary.statuses.waiting;
  return html`<div class="dashboard-summary" data-testid="dashboard-summary">
    <div class="dashboard-summary__head">
      <strong class="dashboard-summary__total">${summary.total || !summary.finished ? `${summary.total} session${summary.total === 1 ? "" : "s"}` : "No sessions in flight"}${summary.finished ? html` <span class="dashboard-summary__finished">· ${summary.finished} finished</span>` : nothing}</strong>
      <span class="dashboard-summary__state ${waiting ? "dashboard-summary__state--attention" : ""}">${waiting ? `${waiting} need${waiting === 1 ? "s" : ""} you` : "Nothing needs you"}</span>
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
  return html`<section class="settings-section"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Sessions</h2><p class="settings-section__desc">A session idle in Done counts as finished and is not listed. Subagents show on their parent; archived sessions are left out.</p></div></header>
    ${props.sessionsError ? html`<div class="callout danger" role="alert">${props.sessionsError}</div>` : nothing}
    ${empty && props.sessionsLoading ? html`<div role="status">Reading sessions…</div>` : html`
      ${summaryCard(summary)}
      ${summary.waiting.length ? html`<div class="dashboard-needs-you" data-testid="dashboard-needs-you">
        <h3 class="dashboard-subheading">Needs you <span class="dashboard-subheading__count">${summary.waiting.length}</span></h3>
        ${list(NEEDS_YOU_LIST, summary.waiting, false, "dashboard-sessions")}
      </div>` : nothing}
      ${stagePipeline(summary)}
      ${summary.groups.length
        ? html`<div class="dashboard-groups" data-testid="dashboard-active-sessions">${summary.groups.map((group) => html`
          <h3 class="dashboard-subheading">${group.label} <span class="dashboard-subheading__count">${group.sessions.length}</span></h3>
          ${list(group.key, group.sessions, group.mixed, "settings-group dashboard-sessions")}`)}</div>`
        : summary.waiting.length || summary.finished && !summary.total ? nothing : html`<p class="dashboard-empty">${summary.total ? "Every session is idle." : "No sessions yet."}</p>`}`}
  </section>`;
}

export function renderDashboard(props: DashboardProps): TemplateResult {
  return html`<header class="content-header content-header--settings"><div><div class="page-title">Dashboard</div><div class="page-subtitle">The sessions in flight and the gateway host's resource use.</div></div></header>
    <main class="settings-page settings-page--wide dashboard-page" data-testid="dashboard">${sessionsSection(props)}${hostSection(props)}</main>`;
}
