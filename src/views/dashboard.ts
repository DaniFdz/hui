/**
 * The Dashboard page (Labs → Dashboard): a queue of the decisions the sessions in flight wait on, with the activity
 * monitor beside it. The queue narrows by group, status, worker, stage and a text query, counts what it shows in a
 * stat strip, and lists one lane per reason — Answer, Fix, Unread, In flight, Parked — with the session to pick up
 * first at the top of each and three rows per lane until its Show all button opens it. An Answer row answers a select
 * or confirm question in place and a Fix row resumes a session whose last run failed; both report their own failure
 * until the operator dismisses it. A Fix row whose runtime is not connected keeps its reason and only opens the
 * session, because a dead runtime cannot continue. The activity monitor is one chart with a line per selected machine
 * over the last 5, 15 or 30 minutes, a switch for the metric it draws, chips that choose the machines it and the cards
 * show, and a card per host metric for each of them with its value and a bar. A metric that reads above 85% is marked;
 * one the host can't report says so. A value too long for its card wraps between its parts, and the disk path keeps its
 * end on one line.
 */
import { html, nothing, svg, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { HostMetrics } from "../api/schema/host.ts";
import type { ProgressCard, SessionGroup, SessionStage, SessionStatus, SessionView } from "../api/schema/sessions.ts";
import type { WorkerMetrics } from "../api/workers.ts";
import {
  DASHBOARD_ROWS, filterOptions, summarizeSessions,
  type FilterOption, type FilterOptions, type SessionFilters, type SessionLane, type SessionSummary,
} from "../lib/dashboard.ts";
import { isSessionStage, SESSION_STAGE_LABELS } from "../lib/kanban.ts";
import { relativeTime } from "../lib/message-metadata.ts";
import { CHART_METRICS, CHART_METRIC_KEYS, CHART_WINDOWS, chartSeries, snapTime, valueAt, type ChartMetric, type ChartWindow } from "../lib/metric-chart.ts";
import { navigationPath } from "../lib/navigation.ts";
import { pullRequestAccessibleLabel, pullRequestStateLabel } from "../lib/pull-requests.ts";
import { sessionGroupLabel } from "../lib/session/sessions.ts";
import { loadViewAssets } from "../lib/view-assets.ts";
import { formatBytes } from "../lib/worktrees.ts";
import { renderSettingsPicker } from "./settings-picker.ts";

loadViewAssets(() => import("../styles/dashboard.css"));

const HIGH_PERCENT = 85;
/** The most answer buttons one row draws; the gateway sends at most this many options. */
const MAX_ANSWER_OPTIONS = 8;
/** The pickers' value for "no filter on this dimension". */
const ALL = "all";
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
  /** What narrows the lanes; a filter is set when any dimension is non-empty. */
  filters: SessionFilters;
  /** Session ids with an action in flight. */
  busy: ReadonlySet<string>;
  /** The last action's failure, shown until the operator dismisses it. */
  actionError: string;
  metrics: HostMetrics | undefined;
  metricsError: string;
  workers: readonly WorkerMetrics[];
  workersError: string;
  chart: DashboardChartProps;
  expandedLists: ReadonlySet<string>;
  now: number;
  onRetry: () => void;
  onToggleList: (key: string) => void;
  onFilters: (patch: Partial<SessionFilters>) => void;
  onClearFilters: () => void;
  onDismissActionError: () => void;
  onAnswer: (session: SessionView, question: NonNullable<SessionView["question"]>, answer: { value: string } | { confirmed: boolean }) => void;
  onResume: (session: SessionView) => void;
  onOpenSession: (session: SessionView) => void;
};

type Metric = { value: string; detail: string; path?: string; percent?: number };

const percentLabel = (value: number) => `${Math.round(value)}%`;
const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
const rate = (arrow: string, bytes: number) => `${arrow} ${formatBytes(bytes)}/s`.replaceAll(" ", "\u00a0");

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
    <small class="dashboard-metric__detail">${metric.detail}${metric.path ? html`<span class="dashboard-metric__path" data-hui-tooltip=${metric.path}><span dir="ltr">${metric.path}</span></span>` : nothing}</small>
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
  return html`<section class="settings-section dashboard-page__activity" data-testid="dashboard-activity"><header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Activity</h2><p class="settings-section__desc">This gateway's host and every worker's own machine, sampled every 15 seconds, and every 5 while this page is open. Opening this page never wakes a worker.</p></div></header>
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

/** Whether any filter narrows the lanes, so the filter bar and its Clear button are worth drawing. */
const hasFilters = (filters: SessionFilters) => Boolean(filters.group || filters.status || filters.worker || filters.stage || filters.query.trim());

/** The dotted session line: each part that has something to say, separated by a middle dot. */
const dotted = (parts: readonly unknown[]) => parts
  .filter((part) => typeof part === "string" ? part.length > 0 : part !== nothing && part !== undefined)
  .flatMap((part, index) => (index === 0 ? [part] : [" · ", part]));

/** A time HUI can read, in the row's own type; nothing when it cannot. */
function timeAgo(updatedAt: string, now: number) {
  const at = Date.parse(updatedAt);
  return Number.isNaN(at) ? nothing : html`<time class="dashboard-row__time" datetime=${updatedAt}>${relativeTime(at, now)}</time>`;
}

/** A time with the verb that makes it read in its lane ("waiting 5m ago"). */
function ago(verb: string, updatedAt: string, now: number) {
  const time = timeAgo(updatedAt, now);
  return time === nothing ? nothing : html`${verb} ${time}`;
}

/** The one-line reading of a progress card: how many steps are done, and the one in hand. A card without steps reads
 * as its first line of notes; a session without a card has nothing to say here. */
function progressReading(card: ProgressCard | undefined): string | undefined {
  const steps = card?.steps ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const running = steps.find((step) => step.status === "in_progress")?.step;
  if (steps.length) return `${completed} of ${steps.length} steps${running ? ` · ${running}` : ""}`;
  const note = card?.markdown.split("\n").map((line) => line.trim()).find(Boolean);
  return note === "" ? undefined : note;
}

/** Why a stopped session is in the Fix lane: what the run reported, else what HUI knows about how it stopped. */
const failureOf = (session: SessionView) => session.failure?.trim()
  || (session.status === "disconnected" ? "Disconnected" : "The last run failed.");

const pause = (event: MouseEvent) => event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;

/** A link to the session that opens it in place, keeping a modified click for the browser. */
function sessionAnchor(session: SessionView, props: DashboardProps, className: string, content: unknown, label?: string) {
  const href = navigationPath({ kind: "session", id: session.id });
  const open = (event: MouseEvent) => {
    if (pause(event)) return;
    event.preventDefault();
    props.onOpenSession(session);
  };
  // The title link takes its name from its own text; an action link says which session it opens.
  return label === undefined
    ? html`<a class=${className} href=${href} @click=${open}>${content}</a>`
    : html`<a class=${className} href=${href} aria-label=${label} @click=${open}>${content}</a>`;
}

/** A pointer click anywhere on a row that is not a link or a button opens its session. */
function rowClick(session: SessionView, props: DashboardProps) {
  return (event: MouseEvent) => {
    if (pause(event)) return;
    if ((event.target as Element | null)?.closest("a, button")) return;
    props.onOpenSession(session);
  };
}

function chip(kind: string, label: string, tone?: string, tooltip?: string) {
  return html`<span class="dashboard-chip dashboard-chip--${kind}" data-tone=${tone ?? nothing} data-hui-tooltip=${tooltip ?? nothing}>${label}</span>`;
}

/** The chips a row keeps in its compact meta line: its machine, an unread mark outside the Unread lane, its subagents
 * and its pull requests. A chip whose name is already on the row adds nothing and is left out. */
function sessionChips(lane: SessionLane, session: SessionView, summary: SessionSummary) {
  const subagents = summary.subagents.get(session.id);
  return [
    session.worker ? chip("worker", session.worker.name) : nothing,
    session.unread && lane.key !== "unread" ? chip("unread", "Unread") : nothing,
    subagents ? chip("subagent", `${subagents.total} subagent${subagents.total === 1 ? "" : "s"}${subagents.active ? ` · ${subagents.active} running` : ""}`) : nothing,
    ...(session.pullRequests ?? []).map((pullRequest) => chip("pr", `#${pullRequest.number}${pullRequest.state ? ` ${pullRequestStateLabel(pullRequest.state)}` : ""}`,
      pullRequest.state ?? "unknown", pullRequestAccessibleLabel(pullRequest))),
  ].filter((entry) => entry !== nothing);
}

/** The one-line answer control of a waiting session, by the method the question asks for. */
function answerActions(session: SessionView, props: DashboardProps) {
  const open = sessionAnchor(session, props, "dashboard-action dashboard-action--link", "Open", `Open ${session.title}`);
  const question = session.question;
  if (!question) return [open];
  const busy = props.busy.has(session.id);
  const answer = (label: string, choice: { value: string } | { confirmed: boolean }) => html`
    <button class="btn btn--sm dashboard-action" type="button" ?disabled=${busy}
      @click=${() => props.onAnswer(session, question, choice)}>${busy ? "Answering…" : label}</button>`;
  if (question.method === "select") {
    return [...(question.options ?? []).slice(0, MAX_ANSWER_OPTIONS).map((option) => answer(option, { value: option })), open];
  }
  if (question.method === "confirm") return [answer("Yes", { confirmed: true }), answer("No", { confirmed: false }), open];
  return [sessionAnchor(session, props, "dashboard-action dashboard-action--link", "Open to answer"), open];
}

/** What the row offers by its lane: answering or resuming in place, and always a way into the session. Resume is offered
 * only for an idle session, the one state the resume route accepts: a failed turn settles idle with its runtime still
 * there, while `error` and `disconnected` mean the runtime is gone, so that row opens the session to be retried. */
function rowActions(lane: SessionLane, session: SessionView, props: DashboardProps) {
  if (lane.key === "answer") return answerActions(session, props);
  const open = sessionAnchor(session, props, "dashboard-action dashboard-action--link", "Open", `Open ${session.title}`);
  if (lane.key !== "fix" || session.status !== "idle") return [open];
  const busy = props.busy.has(session.id);
  return [
    html`<button class="btn btn--sm dashboard-action" type="button" ?disabled=${busy} @click=${() => props.onResume(session)}>${busy ? "Resuming…" : "Resume"}</button>`,
    open,
  ];
}

function sessionRow(lane: SessionLane, session: SessionView, props: DashboardProps, summary: SessionSummary) {
  const questionTitle = session.question?.title?.trim();
  const progress = progressReading(session.progress);
  // The question leads its row in quotes; the session's own title moves to the line below, with why it is listed there.
  const question = lane.key === "answer" && questionTitle ? `“${questionTitle}”` : undefined;
  const leads = question !== undefined;
  const title = question ?? session.title;
  const group = session.group ? sessionGroupLabel(session.group) : nothing;
  const stage = isSessionStage(session.stage) ? SESSION_STAGE_LABELS[session.stage] : nothing;
  const detail = lane.key === "fix" ? html`<p class="dashboard-row__failure">${failureOf(session)}</p>`
    : lane.key === "flight" ? html`<p class="dashboard-row__progress">${progress ?? "Running"}</p>`
    : lane.key === "unread" && progress ? html`<p class="dashboard-row__progress">${progress}</p>`
    : nothing;
  const line = lane.key === "answer"
    ? dotted([leads ? session.title : nothing, group, stage, ago("waiting", session.updatedAt, props.now)])
    : lane.key === "fix" ? dotted([group, stage, ago("stopped", session.updatedAt, props.now)])
    : lane.key === "parked" ? dotted([group, stage, ago("last answer read", session.updatedAt, props.now)])
    : dotted([group, stage, lane.key === "unread" ? timeAgo(session.updatedAt, props.now) : nothing]);
  const chips = sessionChips(lane, session, summary);
  return html`<li class="dashboard-row dashboard-row--${lane.key}" data-testid="dashboard-row" data-session-id=${session.id} @click=${rowClick(session, props)}>
    <div class="dashboard-row__head">
      ${sessionAnchor(session, props, "dashboard-row__title", html`<span class="dashboard-row__title-text">${title}</span>`)}
      ${lane.key === "answer" && !leads ? html`<span class="dashboard-row__why" data-tone="waiting">Waiting for your answer</span>` : nothing}
      ${lane.key === "unread" ? html`<span class="dashboard-row__why" data-tone="info">Unread answer</span>` : nothing}
    </div>
    ${detail}
    ${line.length ? html`<p class="dashboard-row__line">${line}</p>` : nothing}
    ${chips.length ? html`<p class="dashboard-row__chips">${chips}</p>` : nothing}
    <div class="dashboard-row__actions">${rowActions(lane, session, props)}</div>
  </li>`;
}

/** One picker's choices: every value with the count it would show, under the one that filters nothing. */
function filterPicker(label: string, all: string, value: string, options: readonly FilterOption[], onChange: (value: string) => void) {
  return renderSettingsPicker(label, value || ALL, [
    { value: ALL, label: all },
    ...options.map((option) => ({ value: option.value, label: `${option.label} (${option.count})` })),
  ], (next) => onChange(next === ALL ? "" : next));
}

function filterBar(props: DashboardProps, choices: FilterOptions) {
  const { filters } = props;
  return html`<div class="dashboard-filters" data-testid="dashboard-filters">
    <div class="data-table-search dashboard-filters__search">
      <input type="search" aria-label="Search sessions" placeholder="Search title or project" autocomplete="off"
        .value=${live(filters.query)} @input=${(event: Event) => props.onFilters({ query: (event.target as HTMLInputElement).value })} />
    </div>
    <div class="dashboard-filters__field">${filterPicker("Group", "All groups", filters.group, choices.groups, (group) => props.onFilters({ group }))}</div>
    <div class="dashboard-filters__field">${filterPicker("Status", "All statuses", filters.status, choices.statuses, (status) => props.onFilters({ status: status as SessionStatus }))}</div>
    <div class="dashboard-filters__field">${filterPicker("Worker", "Every machine", filters.worker, choices.workers, (worker) => props.onFilters({ worker }))}</div>
    <div class="dashboard-filters__field">${filterPicker("Stage", "Every stage", filters.stage, choices.stages, (stage) => props.onFilters({ stage: stage as SessionStage }))}</div>
    ${hasFilters(filters) ? html`<button class="btn btn--sm dashboard-filters__clear" type="button" @click=${props.onClearFilters}>Clear</button>` : nothing}
  </div>`;
}

/** How many of the sessions in flight pass the filters, and how many are only counted because they are finished. */
function countLine(props: DashboardProps, summary: SessionSummary) {
  return html`<p class="dashboard-count" role="status" data-testid="dashboard-count">
    <strong class="dashboard-count__matched">${summary.matched} of ${summary.total} ${summary.total === 1 ? "session" : "sessions"}</strong>
    ${summary.finished ? html`<span class="dashboard-count__finished">· ${summary.finished} finished</span>` : nothing}
    ${props.sessionsLoading && summary.total > 0 ? html`<span class="dashboard-count__updating" data-testid="dashboard-updating">Updating…</span>` : nothing}
  </p>`;
}

/** What each lane holds, in lane order; a lane with nothing in it reads muted. */
function statStrip(summary: SessionSummary) {
  return html`<ul class="dashboard-stats" data-testid="dashboard-stats">${summary.lanes.map((lane) => html`
    <li class="dashboard-stat${lane.sessions.length ? "" : " dashboard-stat--zero"}" data-lane=${lane.key}>
      <strong class="dashboard-stat__count">${lane.sessions.length}</strong><span class="dashboard-stat__label">${lane.label}</span>
    </li>`)}</ul>`;
}

function emptyState(props: DashboardProps, summary: SessionSummary) {
  if (!hasFilters(props.filters)) {
    return html`<p class="dashboard-empty" data-testid="dashboard-empty">${summary.finished ? "No sessions in flight." : "No sessions yet."}</p>`;
  }
  return html`<div class="dashboard-empty-state" data-testid="dashboard-empty">
    <p class="dashboard-empty">No sessions match these filters.</p>
    <button class="btn btn--sm" type="button" @click=${props.onClearFilters}>Clear filters</button>
  </div>`;
}

function laneSection(lane: SessionLane, props: DashboardProps, summary: SessionSummary) {
  const id = `dashboard-list-${lane.key}`;
  const expanded = props.expandedLists.has(lane.key);
  const shown = expanded ? lane.sessions : lane.sessions.slice(0, DASHBOARD_ROWS);
  return html`<section class="dashboard-lane" data-testid=${`dashboard-lane-${lane.key}`} data-lane=${lane.key}>
    <header class="dashboard-lane__head">
      <h3 class="dashboard-lane__title"><span class="dashboard-lane__dot" aria-hidden="true"></span>${lane.label}</h3>
      <span class="settings-count">${lane.sessions.length}</span>
    </header>
    <ul class="dashboard-rows" id=${id}>${shown.map((session) => sessionRow(lane, session, props, summary))}</ul>
    ${lane.sessions.length > DASHBOARD_ROWS ? html`<button class="dashboard-more" type="button" aria-controls=${id} aria-expanded=${String(expanded)} @click=${() => props.onToggleList(lane.key)}>${expanded ? "Show fewer" : `Show all ${lane.sessions.length}`}</button>` : nothing}
  </section>`;
}

function sessionsSection(props: DashboardProps) {
  const summary = summarizeSessions(props.groups, props.filters);
  const choices = filterOptions(props.groups);
  const lanes = summary.lanes.filter((lane) => lane.sessions.length);
  const actionError = props.actionError ? html`<div class="callout danger dashboard-callout" role="alert" data-testid="dashboard-action-error">${props.actionError}<button class="btn btn--sm" type="button" @click=${props.onDismissActionError}>Dismiss</button></div>` : nothing;
  const empty = summary.matched === 0
    ? props.sessionsLoading && summary.total === 0
      ? html`<p class="dashboard-empty" role="status">Reading sessions…</p>`
      : emptyState(props, summary)
    : nothing;
  return html`<section class="settings-section dashboard-page__sessions" data-testid="dashboard-sessions">
    <header class="settings-section__header"><div class="settings-section__copy"><h2 class="settings-section__heading">Sessions</h2><p class="settings-section__desc">The sessions that stopped and the ones still running, grouped by what they need from you.</p></div></header>
    ${props.sessionsError ? html`<div class="callout danger dashboard-callout" role="alert">${props.sessionsError}</div>` : nothing}
    ${summary.total || hasFilters(props.filters) ? filterBar(props, choices) : nothing}
    ${countLine(props, summary)}
    ${statStrip(summary)}
    ${actionError}
    ${empty}
    ${lanes.map((lane) => laneSection(lane, props, summary))}
  </section>`;
}

export function renderDashboard(props: DashboardProps): TemplateResult {
  return html`<header class="content-header content-header--settings"><div><div class="page-title">Dashboard</div><div class="page-subtitle">The sessions in flight and the resource use of the machines that run them.</div></div></header>
    <main class="settings-page settings-page--wide dashboard-page" data-testid="dashboard">${sessionsSection(props)}${activitySection(props)}</main>`;
}
