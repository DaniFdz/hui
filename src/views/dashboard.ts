/**
 * The Dashboard page (Labs → Dashboard): counts of the sessions by status and stage, the sessions that are not idle,
 * and a card per host metric with its value, a bar and a sparkline of the samples the browser kept. A metric above
 * 85% is marked; one the host can't report says so.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { HostMetrics } from "../api/schema/host.ts";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import { DASHBOARD_STATUSES, DASHBOARD_STATUS_LABELS, summarizeSessions } from "../lib/dashboard.ts";
import { SESSION_STAGES, SESSION_STAGE_LABELS, isSessionStage } from "../lib/kanban.ts";
import { relativeTime } from "../lib/message-metadata.ts";
import { navigationPath } from "../lib/navigation.ts";
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
  now: number;
  onRetry: () => void;
  onOpenSession: (session: SessionView) => void;
};

type Metric = { value: string; detail: string; percent?: number; series: number[] };

const percentLabel = (value: number) => `${Math.round(value)}%`;
const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
const rate = (bytes: number) => `${formatBytes(bytes)}/s`;

function sparkline(series: readonly number[], max?: number) {
  if (series.length < 2) return nothing;
  const top = Math.max(max ?? 0, ...series) || 1;
  const points = series.map((value, index) => `${((index / (series.length - 1)) * 100).toFixed(1)},${(24 - (value / top) * 22).toFixed(1)}`).join(" ");
  return html`<svg class="dashboard-metric__spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points=${points}></polyline></svg>`;
}

function card(id: string, title: string, metric: Metric | null) {
  if (!metric) {
    return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric"><span class="dashboard-metric__title">${title}</span><p class="dashboard-metric__unavailable">Not available on this host</p></article>`;
  }
  const high = metric.percent !== undefined && metric.percent > HIGH_PERCENT;
  return html`<article data-testid=${`dashboard-metric-${id}`} class="dashboard-metric ${high ? "dashboard-metric--high" : ""}">
    <div class="dashboard-metric__head"><span class="dashboard-metric__title">${title}</span><strong class="dashboard-metric__value">${metric.value}</strong></div>
    ${metric.percent === undefined ? nothing : html`<div class="dashboard-metric__bar" role="meter" aria-label=${`${title} use`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(metric.percent)}><span style=${`width: ${Math.min(100, metric.percent)}%`}></span></div>`}
    <small class="dashboard-metric__detail">${metric.detail}</small>
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
      detail: `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)} · ${disk.path}`,
    }),
    card("gpu", "GPU", gpu && { value: percentLabel(gpu.percent), percent: gpu.percent, series: series((sample) => sample.gpu?.percent), detail: "Busiest accelerator" }),
    card("network", "Network", network && {
      value: `↓ ${rate(network.rxBytesPerSecond)} ↑ ${rate(network.txBytesPerSecond)}`,
      series: series((sample) => sample.network && sample.network.rxBytesPerSecond + sample.network.txBytesPerSecond),
      detail: "All interfaces but loopback",
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

function count(label: string, value: number, key: string) {
  return html`<div class="dashboard-count ${value ? "" : "dashboard-count--zero"}" data-key=${key}><strong>${value}</strong><span>${label}</span></div>`;
}

function sessionRow(session: SessionView, props: DashboardProps) {
  const target = { kind: "session", id: session.id } as const;
  const subagent = Boolean(session.parentId || session.subagent);
  return html`<li><a class="dashboard-session" href=${navigationPath(target)} @click=${(event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpenSession(session);
  }}>
    <span class="dashboard-session__title">${session.title}${subagent ? html`<span class="dashboard-session__kind">Subagent</span>` : nothing}</span>
    <span class="dashboard-session__status" data-status=${session.status}>${DASHBOARD_STATUS_LABELS[session.status]}</span>
    <span class="dashboard-session__meta">${[
      isSessionStage(session.stage) ? SESSION_STAGE_LABELS[session.stage] : "",
      session.worker ? session.worker.name : "",
      `updated ${relativeTime(Date.parse(session.updatedAt), props.now)}`,
    ].filter(Boolean).join(" · ")}</span>
  </a></li>`;
}

function sessionsSection(props: DashboardProps) {
  const summary = summarizeSessions(props.groups);
  const empty = !props.groups.length;
  return html`<section class="settings-section"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Sessions</h2><p class="settings-section__desc">Archived sessions are left out.</p></div></header>
    ${props.sessionsError ? html`<div class="callout danger" role="alert">${props.sessionsError}</div>` : nothing}
    ${empty && props.sessionsLoading ? html`<div role="status">Reading sessions…</div>` : html`
      <div class="dashboard-counts" data-testid="dashboard-status-counts">${DASHBOARD_STATUSES.map((status) => count(DASHBOARD_STATUS_LABELS[status], summary.statuses[status], status))}</div>
      <div class="dashboard-counts" data-testid="dashboard-stage-counts">${SESSION_STAGES.map((stage) => count(SESSION_STAGE_LABELS[stage], summary.stages[stage], stage))}</div>
      <h3 class="dashboard-subheading">Not idle</h3>
      ${summary.active.length
        ? html`<ul class="settings-group dashboard-sessions" data-testid="dashboard-active-sessions">${summary.active.map((session) => sessionRow(session, props))}</ul>`
        : html`<p class="dashboard-empty">Every session is idle.</p>`}`}
  </section>`;
}

export function renderDashboard(props: DashboardProps): TemplateResult {
  return html`<header class="content-header content-header--settings"><div><div class="page-title">Dashboard</div><div class="page-subtitle">Every session's status and the gateway host's resource use.</div></div></header>
    <main class="settings-page settings-page--wide dashboard-page" data-testid="dashboard">${sessionsSection(props)}${hostSection(props)}</main>`;
}
