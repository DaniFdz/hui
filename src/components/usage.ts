/** The Usage page: reporting controls and charts over recorded local conversation histories, never provider billing. */
import { LitElement, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type { UsageDay, UsageMetrics, UsageReport } from "../api/schema/diagnostics.ts";
import { UsageController } from "../controllers/usage-controller.ts";
import { usageChartDays, usageCost, usageCostPer, usageOverview, usageWindows, type UsageSort } from "../lib/usage.ts";
import { icons } from "../lib/icons.ts";
import { loadViewAssets } from "../lib/view-assets.ts";

loadViewAssets(() => import("../styles/usage.css"));

const number = new Intl.NumberFormat().format;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format;
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? "" : "s"}`;
const cost = (value: UsageMetrics) => usageCostPer(value, 1);
const share = (value: UsageMetrics, totals: UsageMetrics) => value.costUsd === null || !totals.costUsd ? "" : ` · ${(value.costUsd / totals.costUsd * 100).toFixed(1)}% of priced cost`;
const rate = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(2)}%` : "Unavailable";
const TYPES = [["outputTokens", "Output", "accent"], ["inputTokens", "Input", "ok"], ["cacheWriteTokens", "Cache write", "warn"], ["cacheReadTokens", "Cache read", "info"]] as const;
const PRESETS = [["today", "Today"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"], ["1y", "1y"], ["all", "All"]] as const;
const dayLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", year: "numeric" });
const labelDate = (date: string) => (date.length === 7 ? monthLabel : dayLabel).format(new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`));
const CHART_SCOPE = { day: "Daily", week: "Weekly", month: "Monthly" } as const;

function summary(title: string, value: string, description: string) {
  return html`<article class="stat usage-summary-card"><span class="usage-summary-title">${title}</span><strong class="usage-summary-value">${value}</strong><small class="usage-summary-sub">${description}</small></article>`;
}

function metric(value: string, name: string, detail: string) {
  return html`<div class="usage-metric"><strong class="usage-metric__value">${value}</strong><span class="usage-metric__name">${name}</span><small class="usage-summary-sub">${detail}</small></div>`;
}

export class HuiUsagePage extends LitElement {
  onOpenSession?: (id: string) => void;
  #usage = new UsageController(this);
  #chartFocus = 0;
  #overview: { report: UsageReport; query: string; sort: UsageSort; value: ReturnType<typeof usageOverview> } | undefined;

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#usage.load(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.#usage.disconnect(); }

  #segments(totals: UsageMetrics) {
    const total = TYPES.reduce((sum, [key]) => sum + totals[key], 0);
    return TYPES.map(([key, , color]) => html`<span class="cost-segment" style=${`background: var(--${color}); flex: 0 0 ${total ? totals[key] / total * 100 : 0}%`}></span>`);
  }

  #chartKey(event: KeyboardEvent, index: number, count: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : index + (event.key === "ArrowLeft" ? -1 : 1);
    this.#chartFocus = Math.max(0, Math.min(next, count - 1));
    this.querySelectorAll<HTMLButtonElement>(".usage-report__day")[this.#chartFocus]?.focus();
    this.requestUpdate();
  }

  #chart(days: ReturnType<typeof usageChartDays>, totals: UsageMetrics) {
    const state = this.#usage;
    const value = (metrics: UsageMetrics) => state.metric === "cost" ? metrics.costUsd ?? 0 : metrics.totalTokens;
    const max = Math.max(0, ...days.days.map(({ metrics }) => value(metrics)));
    return html`<section class="settings-group usage-panel daily-chart-compact" data-testid="usage-chart">
      <div class="daily-chart-header">
        ${state.metric === "tokens" ? html`<div class="settings-segmented" role="group" aria-label="Token breakdown">${(["total", "types"] as const).map((mode) => html`<button type="button" class="settings-segmented__btn ${state.chart === mode ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.chart === mode} @click=${() => { state.chart = mode; this.requestUpdate(); }}>${mode === "total" ? "Total" : "By type"}</button>`)}</div>` : html`<span class="usage-summary-sub">PI estimates · unpriced calls excluded</span>`}
        <div class="usage-report__chart-heading"><h2 class="settings-section__heading">${CHART_SCOPE[days.bucket]} ${state.metric === "cost" ? "cost estimates" : "token usage"}</h2><p class="settings-section__desc">${state.report?.range.from} to ${state.report?.range.to} · ${state.report?.range.timeZone}</p></div>
      </div>
      <div class="daily-chart-plot"><div class="daily-chart-scale"><span>${state.metric === "cost" ? usageCost({ costUsd: max, unpricedCalls: 0 }) : compact(max)}</span><span>0</span></div><div class="daily-chart-bars">
        ${days.days.map(({ date, end, metrics }, index) => {
          const unpriced = state.metric === "cost" && metrics.unpricedCalls > 0;
          const byType = state.metric === "tokens" && state.chart === "types" && TYPES.some(([key]) => metrics[key] > 0);
          const shown = days.bucket === "week" ? `${labelDate(date)} to ${labelDate(end)}` : labelDate(date);
          const description = `${shown}: ${number(metrics.totalTokens)} tokens · ${metrics.calls ? cost(metrics) : "No recorded usage"}${metrics.unpricedCalls ? ` · ${count(metrics.unpricedCalls, "unpriced record")}` : ""}`;
          return html`<button type="button" class="daily-bar-wrapper usage-report__day" title=${description} aria-label=${description} tabindex=${index === Math.min(this.#chartFocus, days.days.length - 1) ? 0 : -1} @keydown=${(event: KeyboardEvent) => this.#chartKey(event, index, days.days.length)} @click=${() => {
            state.applyRange(days.bucket === "month" ? `${date}-01` : date, end);
            this.querySelector<HTMLButtonElement>(".usage-date-range button")?.focus();
          }}><span class="daily-bar ${byType ? "daily-bar--stacked" : ""} ${unpriced ? "usage-report__unpriced" : ""}" style=${`height: ${max ? value(metrics) / max * 200 : 0}px; opacity: ${metrics.calls || metrics.totalTokens ? 1 : 0.25}`}>
              ${byType ? this.#segments(metrics) : nothing}</span>
              <span class="daily-bar-label">${days.days.length <= 10 || index % Math.ceil(days.days.length / 6) === 0 || index === days.days.length - 1 ? labelDate(date) : ""}</span><span class="daily-bar-total">${unpriced ? "?" : ""}</span></button>`;
        })}
      </div></div>
      <div class="cost-breakdown"><h3 class="usage-summary-title">Tokens by type</h3><div class="cost-breakdown-bar" aria-hidden="true">${this.#segments(totals)}</div>
        <div class="cost-breakdown-legend">${TYPES.map(([key, text, color]) => html`<span class="legend-item"><span class="legend-dot" style=${`background: var(--${color})`} aria-hidden="true"></span>${text} ${compact(totals[key])}</span>`)}</div></div>
    </section>`;
  }

  #windows(days: readonly UsageDay[], from: string, to: string) {
    const windows = usageWindows(days, from, to);
    if (!windows.length) return nothing;
    return html`<section class="cost-window-analysis" data-testid="usage-windows">
      <div class="cost-window-header"><div><h2 class="settings-section__heading">PI cost windows</h2><p class="settings-section__desc">Calendar windows ending ${to}.</p></div></div>
      <div class="cost-window-grid">${windows.map((window, index) => html`<article class="cost-window-card ${index === 0 ? "cost-window-card--range" : ""}">
        <span class="cost-window-card__label">${window.label}</span><strong class="cost-window-card__value">${cost(window.metrics)}</strong>
        <span class="cost-window-card__meta">${window.from === window.to ? window.to : `${window.from} to ${window.to}`}</span>
        <small class="cost-window-card__meta">${compact(window.metrics.totalTokens)} tokens · ${window.metrics.calls ? `${usageCostPer(window.metrics, window.days)} per day` : "No usage records"}</small>
      </article>`)}</div>
    </section>`;
  }

  #rankings(overview: ReturnType<typeof usageOverview>) {
    const detail = (metrics: UsageMetrics) => `${compact(metrics.totalTokens)} tokens${share(metrics, overview.totals)}`;
    const rankings = [
      { title: "Top models", rows: overview.models.map((row) => ({ label: `${row.provider}/${row.model}`, detail: detail(row.metrics), value: cost(row.metrics) })) },
      { title: "Top providers", rows: overview.providers.map((row) => ({ label: row.provider, detail: detail(row.metrics), value: cost(row.metrics) })) },
      { title: "Top tools", rows: overview.tools.map((row) => ({ label: row.name, detail: count(row.errors, "error"), value: count(row.calls, "result") })) },
    ];
    return html`<section class="usage-insights-grid" data-testid="usage-rankings">${rankings.map(({ title, rows }) => html`<article class="usage-insight-card"><h2 class="usage-insight-title">${title}</h2><div class="usage-list">${rows.slice(0, 5).map((row) => html`<div class="usage-list-item"><div class="usage-report__rank-name">${row.label}<div class="usage-list-sub">${row.detail}</div></div><span class="usage-list-value">${row.value}</span></div>`)}${rows.length === 0 ? html`<p class="usage-summary-sub">No recorded data.</p>` : nothing}</div></article>`)}</section>`;
  }

  override render() {
    const state = this.#usage;
    const report = state.report;
    if (report && (this.#overview?.report !== report || this.#overview.query !== state.query || this.#overview.sort !== state.sort)) {
      this.#overview = { report, query: state.query, sort: state.sort, value: usageOverview(report, state.query, state.sort) };
    }
    const overview = report ? this.#overview?.value : undefined;
    const totals = overview?.totals;
    return html`<header class="content-header content-header--settings"><div><div class="page-title">Usage</div><div class="page-subtitle">Recorded tokens and PI cost estimates.</div></div><div class="page-header-actions"><button class="btn" type="button" @click=${() => state.refresh()}>${icons.refresh}<span>${state.loading ? "Refreshing…" : "Refresh"}</span></button></div></header>
    <main class="settings-page settings-page--wide usage-page usage-report" data-testid="usage-report" aria-busy=${state.loading}>
      <section class="settings-section"><h2 class="settings-section__heading">Reporting range</h2><div class="settings-group usage-panel usage-report__controls">
        <div class="usage-controls"><div class="settings-segmented usage-presets" role="group" aria-label="Range presets">${PRESETS.map(([preset, label]) => html`<button type="button" class="settings-segmented__btn ${state.preset === preset ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.preset === preset} @click=${() => state.selectPreset(preset)}>${label}</button>`)}</div>
          <form class="usage-date-range" @submit=${(event: SubmitEvent) => { event.preventDefault(); state.applyRange(); }}>
            <input class="usage-date-input" type="date" required aria-label="From" .value=${live(state.from)} @input=${(event: Event) => { state.from = (event.currentTarget as HTMLInputElement).value; }}>
            <span class="usage-separator" aria-hidden="true">to</span>
            <input class="usage-date-input" type="date" required aria-label="To" .value=${live(state.to)} @input=${(event: Event) => { state.to = (event.currentTarget as HTMLInputElement).value; }}>
            <button class="btn btn--sm" type="submit">Apply range</button>
          </form>
          <select class="usage-select" aria-label="Time zone" .value=${state.zone} @change=${(event: Event) => state.setZone((event.currentTarget as HTMLSelectElement).value === "utc" ? "utc" : "local")}><option value="local">Local</option><option value="utc">UTC</option></select>
          <div class="settings-segmented" role="group" aria-label="Chart metric">${(["tokens", "cost"] as const).map((metric) => html`<button class="settings-segmented__btn ${state.metric === metric ? "settings-segmented__btn--active" : ""}" type="button" aria-pressed=${state.metric === metric} @click=${() => { state.metric = metric; this.requestUpdate(); }}>${metric === "tokens" ? "Tokens" : "Cost"}</button>`)}</div>
        </div>
        ${report && overview && totals ? html`<div class="usage-report__totals" data-testid="usage-totals">${metric(compact(totals.totalTokens), "Total tokens", count(totals.calls, "usage record"))}${metric(cost(totals), "PI cost estimate", totals.unpricedCalls ? `${count(totals.unpricedCalls, "unpriced record")}${totals.costUsd === null ? "" : " · partial estimate"}` : "Recorded prices, not a provider bill")}${metric(number(overview.sessions.length), "Sessions", `${number(report.coverage.readSessions)} local ${report.coverage.readSessions === 1 ? "history" : "histories"} read · ${count(report.coverage.registeredSessions, "registered session")}`)}</div>` : nothing}
        <div class="usage-query-bar"><input class="usage-query-input" type="search" placeholder="Title, ID or model" aria-label="Filter sessions" .value=${state.query} @input=${(event: Event) => state.search((event.currentTarget as HTMLInputElement).value)}>${state.query ? html`<button class="btn btn--sm" type="button" @click=${() => state.search("")}>Clear search</button>` : html`<span class="usage-query-hint">${report ? `${count(report.sessions.length, "session")} in range` : ""}</span>`}</div>
      </div></section>
      <div class="usage-report__notes">
        <p class="usage-report__scope">Recorded local conversation histories only. Remote workers and provider billing are not included. Shared fork history counts once.</p>
        ${report && (report.unplacedSpend.totalTokens || report.unplacedSpend.costUsd) ? html`<p class="usage-report__scope" data-testid="usage-unplaced">Also recorded outside these entries: ${number(report.unplacedSpend.totalTokens)} tokens, ${usageCost({ costUsd: report.unplacedSpend.costUsd, unpricedCalls: 0 })}, for all recorded time. Compaction summaries, tool-side model calls and imported history carry no date, so the range totals and the chart leave them out.</p>` : nothing}
      </div>
      ${state.error ? html`<div class="callout danger" role="alert">${state.error}<button class="btn btn--sm" type="button" @click=${() => { this.querySelector<HTMLButtonElement>(".page-header-actions button")?.focus(); void state.load(); }}>Retry</button></div>` : nothing}
      ${!report ? html`<div role="status">${state.loading ? "Reading HUI diagnostics…" : "Usage is unavailable."}</div>` : nothing}
      ${report && (report.coverage.unavailable.length || report.coverage.undatedRecords) ? html`<div class="callout warning">Totals are partial. ${number(report.coverage.unavailable.length)} histories unavailable; ${number(report.coverage.undatedRecords)} records without valid dates were excluded.</div>` : nothing}
      ${report && totals && overview ? html`
        ${overview.sessions.length ? this.#chart(usageChartDays(overview.days, report.range.from, report.range.to), totals) : html`<div class="settings-group usage-panel usage-empty-state"><strong class="usage-empty-state__title">${state.query ? "No sessions match your search." : "No usage in this range."}</strong><p class="usage-summary-sub">${state.query ? "Try a title, session ID or model name." : "Choose another range or start a conversation."}</p></div>`}
        ${this.#windows(overview.days, report.range.from, report.range.to)}
        <section class="settings-section" data-testid="usage-overview"><h2 class="settings-section__heading">Usage overview</h2><div class="usage-summary-grid">
          ${summary("Messages", number(totals.userMessages + totals.assistantMessages), `${number(totals.userMessages)} user · ${number(totals.assistantMessages)} assistant`)}
          ${summary("Tool results", number(totals.toolResults), `${count(overview.tools.length, "tool")} recorded`)}
          ${summary("PI cost / message", usageCostPer(totals, totals.userMessages + totals.assistantMessages), `Across ${count(totals.userMessages + totals.assistantMessages, "message")}`)}
          ${summary("Error rate", rate(totals.errors, totals.assistantMessages + totals.toolResults), `${count(totals.errors, "recorded failure")} · ${count(totals.assistantMessages, "response")} · ${count(totals.toolResults, "tool result")}`)}
          ${summary("Avg tokens / record", totals.calls ? compact(totals.totalTokens / totals.calls) : "Unavailable", "Across recorded usage metadata")}
          ${summary("Cache hit rate", totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens ? `${(totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens) * 100).toFixed(1)}%` : "Unavailable", `${compact(totals.cacheReadTokens)} cache-read tokens`)}
          ${summary("Errors", number(totals.errors), "Recorded model and tool failures")}
          ${summary("Priced records", totals.calls ? `${number(totals.calls - totals.unpricedCalls)} / ${number(totals.calls)}` : "Unavailable", "A recorded zero is included")}
        </div></section>
        ${this.#rankings(overview)}
        <section class="settings-group usage-panel sessions-card" data-testid="usage-sessions"><div class="sessions-card-header"><div><h2 class="settings-section__heading">Sessions</h2><p class="usage-summary-sub">${Math.min(state.limit, overview.sessions.length)} shown · ${overview.sessions.length} in range</p></div><label class="sessions-sort">Sort sessions<select .value=${state.sort} @change=${(event: Event) => { const value = (event.currentTarget as HTMLSelectElement).value; state.sort = value === "tokens" || value === "cost" ? value : "recent"; this.requestUpdate(); }}><option value="recent">Recent</option><option value="tokens">Tokens</option><option value="cost">Cost</option></select></label></div>
          <div class="session-bars">${overview.sessions.slice(0, state.limit).map((session) => html`<article class="session-bar-row"><button class="session-bar-selection" type="button" @click=${() => this.onOpenSession?.(session.id)}><span class="session-bar-title">${session.title}</span><span class="session-bar-meta">${session.models.map(({ model }) => model).join(", ") || "Unknown model"}${session.parentId ? " · Child session" : ""} · ${count(session.metrics.userMessages + session.metrics.assistantMessages, "message")} · ${count(session.metrics.toolResults, "tool result")}</span></button><div class="usage-report__session-values"><strong>${compact(session.metrics.totalTokens)}</strong><span class="usage-summary-sub">${cost(session.metrics)}</span></div></article>`)}</div>
          ${overview.sessions.length > state.limit ? html`<button class="btn usage-more-sessions" type="button" @click=${() => { state.limit += 50; this.requestUpdate(); }}>Show more</button>` : nothing}
        </section>` : nothing}
    </main>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-usage-page")) customElements.define("hui-usage-page", HuiUsagePage);
