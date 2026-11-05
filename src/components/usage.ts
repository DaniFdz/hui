/** The Usage page: reporting controls and charts over recorded local conversation histories, never provider billing. */
import { LitElement, html, nothing, render, svg, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { UsageInvestigationRecord, UsageMetrics, UsageModel, UsageReport } from "../api/schema/diagnostics.ts";
import type { UsageInvestigationTarget } from "../api/usage.ts";
import { UsageController } from "../controllers/usage-controller.ts";
import { cardGridStyle } from "../lib/card-grid.ts";
import { sumUsage, usageChartDays, usageComparison, usageCost, usageDailyCsv, usageDetail, usageErrorDays, usageHeatmap, usageInvestigationKey, usageInvestigations, usageOverview, usagePullRequests, usageSessionCsv, type UsagePullRequest, type UsageSort } from "../lib/usage.ts";
import { downloadTextFile } from "../lib/download.ts";
import { icons } from "../lib/icons.ts";
import { loadViewAssets } from "../lib/view-assets.ts";
import { renderPicker } from "../views/settings-picker.ts";

loadViewAssets(() => import("../styles/usage.css"));

const number = new Intl.NumberFormat().format;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format;
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? "" : "s"}`;
const cost = (value: UsageMetrics) => value.calls === 0 && value.costUsd === null ? "Unavailable" : usageCost(value);
const TYPES = [["outputTokens", "Output", "accent"], ["inputTokens", "Input", "ok"], ["cacheWriteTokens", "Cache write", "warn"], ["cacheReadTokens", "Cache read", "info"]] as const;
const PRESETS = [["today", "Today"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"], ["1y", "1y"], ["all", "All"]] as const;
const dayLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", year: "numeric" });
const checkedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const labelDate = (date: string) => (date.length === 7 ? monthLabel : dayLabel).format(new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`));
const CHART_SCOPE = { day: "Daily", week: "Weekly", month: "Monthly" } as const;
const SORT_LABELS: Record<UsageSort, string> = { recent: "Recent", tokens: "Tokens", cost: "Cost" };
const SORT_OPTIONS = (Object.keys(SORT_LABELS) as UsageSort[]).map((value) => ({ value, label: SORT_LABELS[value] }));
const asSort = (value: string): UsageSort => value === "tokens" || value === "cost" ? value : "recent";
const ZONE_OPTIONS = [{ value: "local", label: "Local" }, { value: "utc", label: "UTC" }] as const;
const HEATMAP_CELL = 11;
const HEATMAP_PITCH = 14;
const HEATMAP_LEFT = 30;
const HEATMAP_TOP = 16;
const HEATMAP_MIN_DAYS = 60;
const WEEKDAY_ROWS = [[1, Date.UTC(2024, 0, 1)], [3, Date.UTC(2024, 0, 3)], [5, Date.UTC(2024, 0, 5)]] as const;
const PALETTE = ["var(--accent)", "var(--accent-2)", "var(--info)", "var(--warn)", "var(--ok)"] as const;
const stamp = (date: string) => new Date(`${date}T12:00:00Z`).getTime();
const spanDays = (from: string, to: string) => Math.round((stamp(to) - stamp(from)) / 86_400_000) + 1;
const percent = (part: number, whole: number) => `${(part / whole * 100).toFixed(whole > 100 ? 0 : 1)}%`;

/** The period a bar selects, ready to become the reporting range. */
type Selection = { from: string; to: string; label: string; metrics: UsageMetrics; report: UsageReport };

function statCard(label: string, value: string, detail: string, delta?: { change: number; against: string }) {
  const tone = delta === undefined || delta.change === 0 ? "flat" : delta.change > 0 ? "up" : "down";
  const marker = delta === undefined || delta.change === 0 ? "•" : delta.change > 0 ? "▲" : "▼";
  return html`<article class="usage-stat"><span class="usage-stat__label">${label}</span><strong class="usage-stat__value">${value}</strong><small class="usage-stat__detail">${detail}</small>
    ${delta ? html`<span class="usage-stat__delta usage-stat__delta--${tone}">${marker} ${(Math.abs(delta.change) * 100).toFixed(delta.change > 0.095 ? 0 : 1)}% <span>${delta.against}</span></span>` : nothing}</article>`;
}

const TIP_MODELS = 6;

/** A bar's card: its day or period, each model it recorded, then the period's own numbers. */
export function renderBarTip(label: string, metrics: UsageMetrics, models: readonly UsageModel[]): TemplateResult {
  const [only] = models;
  const covered = only !== undefined && models.length === 1 && only.metrics.totalTokens === metrics.totalTokens && only.metrics.costUsd === metrics.costUsd;
  const detail = usageDetail(metrics).slice(covered ? 1 : 0);
  return html`<div class="usage-tip__card">
    <div class="usage-tip__day">${label}</div>
    ${models.length ? html`<div class="usage-tip__rows">${models.slice(0, TIP_MODELS).map((row) => html`<div class="usage-tip__row"><span class="usage-tip__name">${row.provider}/${row.model}</span><span class="usage-tip__tokens">${number(row.metrics.totalTokens)} tokens</span><span class="usage-tip__cost">${cost(row.metrics)}</span></div>`)}${models.length > TIP_MODELS ? html`<div class="usage-tip__line">${count(models.length - TIP_MODELS, "more model")}</div>` : nothing}</div>` : nothing}
    ${detail.map((line) => html`<div class="usage-tip__line">${line}</div>`)}
  </div>`;
}

function summary(title: string, value: string, description: string) {
  return html`<article class="stat usage-summary-card"><span class="usage-summary-title">${title}</span><strong class="usage-summary-value">${value}</strong><small class="usage-summary-sub">${description}</small></article>`;
}

function skeleton() {
  return html`<section class="settings-group usage-panel usage-loading-card" data-testid="usage-loading">
    <div class="usage-stats">${[0, 1, 2, 3].map(() => html`<div class="skeleton usage-skeleton-stat"></div>`)}</div>
    <div class="usage-dashboard"><div class="skeleton usage-skeleton-block usage-skeleton-block--tall"></div><div class="skeleton usage-skeleton-block usage-skeleton-block--tall"></div></div>
    <div class="usage-loading-grid">${[0, 1, 2].map(() => html`<div class="skeleton usage-skeleton-block"></div>`)}</div>
    <div class="skeleton usage-skeleton-block"></div>
  </section>`;
}

export class HuiUsagePage extends LitElement {
  onOpenSession?: (id: string) => void;
  /** A session this page started, which the shell opens once its list holds the new row. */
  onOpenStartedSession?: (id: string) => void;
  #usage = new UsageController(this);
  #chartFocus = 0;
  #selection: Selection | undefined;
  #tip: HTMLElement | undefined;
  #overview: { report: UsageReport; query: string; sort: UsageSort; value: ReturnType<typeof usageOverview> } | undefined;
  #investigations: { report: UsageReport; value: Map<string, UsageInvestigationRecord> } | undefined;

  override createRenderRoot() { return this; }
  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("scroll", this.#hideTip, true);
    void this.#usage.load();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("scroll", this.#hideTip, true);
    this.#usage.disconnect();
    this.#tip?.remove();
    this.#tip = undefined;
  }

  #showTip(target: Element, content: string | TemplateResult) {
    const tip = this.#tip ??= (() => {
      const element = document.createElement("div");
      element.className = "usage-tip";
      element.setAttribute("role", "tooltip");
      document.body.append(element);
      return element;
    })();
    render(content, tip);
    tip.dataset.open = "true";
    const anchor = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const viewport = document.documentElement;
    tip.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, viewport.clientWidth - width - 8))}px`;
    const above = anchor.top - height - 8;
    tip.style.top = `${above >= 8 ? above : Math.min(anchor.bottom + 8, viewport.clientHeight - height - 8)}px`;
  }

  #hideTip = () => {
    if (this.#tip) this.#tip.dataset.open = "false";
  };

  #segments(totals: UsageMetrics) {
    const total = TYPES.reduce((sum, [key]) => sum + totals[key], 0);
    return TYPES.map(([key, , color]) => html`<span class="cost-segment" style=${`background: var(--${color}); flex: 0 0 ${total ? totals[key] / total * 100 : 0}%`}></span>`);
  }

  #chartKey(event: KeyboardEvent, index: number, count: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    this.#hideTip();
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : index + (event.key === "ArrowLeft" ? -1 : 1);
    this.#chartFocus = Math.max(0, Math.min(next, count - 1));
    this.querySelectorAll<HTMLButtonElement>(".usage-report__day")[this.#chartFocus]?.focus();
    this.requestUpdate();
  }

  #select(from: string, to: string, label: string, metrics: UsageMetrics) {
    const state = this.#usage;
    if (!state.report) return;
    this.#hideTip();
    this.#selection = this.#selection?.report === state.report && this.#selection.from === from && this.#selection.to === to
      ? undefined
      : { from, to, label, metrics, report: state.report };
    this.requestUpdate();
  }

  #selectionBar(selection: Selection) {
    return html`<div class="usage-selection" role="status" data-testid="usage-selection">
      <div class="usage-selection__text"><strong>${selection.label}</strong>${usageDetail(selection.metrics).map((line) => html`<span>${line}</span>`)}</div>
      <div class="usage-selection__actions">
        <button class="btn btn--sm" type="button" @click=${() => {
          this.#selection = undefined;
          this.#usage.applyRange(selection.from, selection.to);
          this.querySelector<HTMLButtonElement>(".usage-date-range button")?.focus();
        }}>Show only ${selection.label}</button>
        <button class="btn btn--sm" type="button" @click=${() => { this.#selection = undefined; this.requestUpdate(); }}>Clear</button>
      </div>
    </div>`;
  }

  #chart(days: ReturnType<typeof usageChartDays>) {
    const state = this.#usage;
    const totals = sumUsage(days.days.map(({ metrics }) => metrics));
    const selection = this.#selection?.report === state.report ? this.#selection : undefined;
    const value = (metrics: UsageMetrics) => state.metric === "cost" ? metrics.costUsd ?? 0 : metrics.totalTokens;
    const max = Math.max(0, ...days.days.map(({ metrics }) => value(metrics)));
    return html`<section class="settings-group usage-panel usage-card daily-chart-compact" data-testid="usage-chart">
      <div class="usage-card__header">
        <div class="usage-card__headline">
          <h2 class="usage-card__title">${CHART_SCOPE[days.bucket]} ${state.metric === "cost" ? "cost estimates" : "token usage"}</h2>
          <div class="usage-card__figure"><strong>${state.metric === "cost" ? usageCost(totals) : compact(totals.totalTokens)}</strong>${state.metric === "cost" ? html`<span class="usage-summary-sub">PI estimate</span>` : html`<span class="usage-summary-sub">tokens</span>`}</div>
          <p class="usage-card__meta">${state.report?.range.from} to ${state.report?.range.to} · ${state.report?.range.timeZone}</p>
        </div>
        ${state.metric === "tokens" ? html`<div class="settings-segmented" role="group" aria-label="Token breakdown">${(["total", "types"] as const).map((mode) => html`<button type="button" class="settings-segmented__btn ${state.chart === mode ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.chart === mode} @click=${() => { state.chart = mode; this.requestUpdate(); }}>${mode === "total" ? "Total" : "By type"}</button>`)}</div>` : html`<span class="usage-summary-sub">Unpriced calls excluded</span>`}
      </div>
      <div class="daily-chart-plot"><div class="daily-chart-scale"><span>${state.metric === "cost" ? usageCost({ costUsd: max, unpricedCalls: 0 }) : compact(max)}</span><span>0</span></div><div class="daily-chart-bars">
        ${days.days.map((bar, index) => {
          const { date, end, metrics } = bar;
          const unpriced = state.metric === "cost" && metrics.unpricedCalls > 0;
          const byType = state.metric === "tokens" && state.chart === "types" && TYPES.some(([key]) => metrics[key] > 0);
          const empty = metrics.calls === 0 && metrics.totalTokens === 0;
          const shown = days.bucket === "week" ? `${labelDate(date)} to ${labelDate(end)}` : labelDate(date);
          const hint = [shown, ...usageDetail(metrics)].join("\n");
          const chosen = selection !== undefined && selection.from === (date.length === 7 ? `${date}-01` : date) && selection.to === end;
          return html`<button type="button" class="daily-bar-wrapper usage-report__day ${chosen ? "selected" : ""} ${empty ? "usage-report__day--empty" : ""}" aria-pressed=${chosen} aria-label=${hint.replace(/\n/gu, " · ")} tabindex=${index === Math.min(this.#chartFocus, days.days.length - 1) ? 0 : -1}
            @pointerenter=${(event: PointerEvent) => { if (event.pointerType !== "touch") this.#showTip(event.currentTarget as HTMLElement, renderBarTip(shown, metrics, bar.models)); }} @pointerleave=${this.#hideTip}
            @focus=${(event: FocusEvent) => this.#showTip(event.currentTarget as HTMLElement, renderBarTip(shown, metrics, bar.models))} @blur=${this.#hideTip}
            @keydown=${(event: KeyboardEvent) => this.#chartKey(event, index, days.days.length)} @click=${() => this.#select(date.length === 7 ? `${date}-01` : date, end, shown, metrics)}><span class="daily-bar ${byType ? "daily-bar--stacked" : ""} ${unpriced ? "usage-report__unpriced" : ""}" style=${`height: ${max ? value(metrics) / max * 200 : 0}px; opacity: ${empty ? 0.25 : 1}`}>
              ${byType ? this.#segments(metrics) : nothing}</span>
              <span class="daily-bar-label">${days.days.length <= 10 || index % Math.ceil(days.days.length / 6) === 0 || index === days.days.length - 1 ? labelDate(date) : ""}</span><span class="daily-bar-total">${unpriced ? "?" : ""}</span></button>`;
        })}
      </div></div>
      ${selection ? this.#selectionBar(selection) : nothing}
      <div class="cost-breakdown"><h3 class="usage-summary-title">Tokens by type</h3><div class="cost-breakdown-bar" aria-hidden="true">${this.#segments(totals)}</div>
        <div class="cost-breakdown-legend">${TYPES.map(([key, text, color]) => html`<span class="legend-item"><span class="legend-dot" style=${`background: var(--${color})`} aria-hidden="true"></span>${text} ${compact(totals[key])}</span>`)}</div></div>
    </section>`;
  }

  #heatmap(report: UsageReport, overview: ReturnType<typeof usageOverview>, selection: Selection | undefined) {
    if (spanDays(report.range.from, report.range.to) < HEATMAP_MIN_DAYS) return nothing;
    const { weeks, monthLabels } = usageHeatmap(overview.days, report.range.from, report.range.to);
    const width = HEATMAP_LEFT + weeks.length * HEATMAP_PITCH + 24;
    const height = HEATMAP_TOP + 7 * HEATMAP_PITCH;
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
    return html`<section class="settings-group usage-panel usage-card usage-heatmap-section" data-testid="usage-heatmap">
      <div class="usage-card__header"><div class="usage-card__headline"><h2 class="usage-card__title">Daily activity</h2><p class="usage-card__meta">One cell per day · pick a day to inspect it</p></div>
        <div class="usage-heatmap__legend" aria-hidden="true"><span>Less</span>${[0, 1, 2, 3, 4].map((level) => html`<span class="usage-heatmap__swatch usage-heatmap__cell--l${level}"></span>`)}<span>More</span></div></div>
      <div class="usage-heatmap">${svg`<svg class="usage-heatmap__svg" viewBox="0 0 ${width} ${height}" style=${`--usage-heatmap-width: ${width}px`} aria-hidden="true">
        ${monthLabels.map((label, index) => label ? svg`<text class="usage-heatmap__month" x=${HEATMAP_LEFT + index * HEATMAP_PITCH} y="10">${label}</text>` : nothing)}
        ${WEEKDAY_ROWS.map(([row, day]) => svg`<text class="usage-heatmap__weekday" x=${HEATMAP_LEFT - 6} y=${HEATMAP_TOP + row * HEATMAP_PITCH + HEATMAP_CELL - 2}>${weekday.format(new Date(day))}</text>`)}
        ${weeks.map((week, column) => week.map((cell, row) => {
          if (!cell) return nothing;
          const hint = `${labelDate(cell.date)}\n${usageDetail(cell.metrics).join("\n")}`;
          const chosen = selection?.from === cell.date && selection.to === cell.date;
          return svg`<rect class="usage-heatmap__cell usage-heatmap__cell--l${cell.level} ${chosen ? "usage-heatmap__cell--selected" : ""}" x=${HEATMAP_LEFT + column * HEATMAP_PITCH} y=${HEATMAP_TOP + row * HEATMAP_PITCH} width=${HEATMAP_CELL} height=${HEATMAP_CELL} rx="2.5"
            @pointerenter=${(event: PointerEvent) => { if (event.pointerType !== "touch") this.#showTip(event.currentTarget as Element, hint); }} @pointerleave=${this.#hideTip}
            @click=${() => this.#select(cell.date, cell.date, labelDate(cell.date), cell.metrics)}></rect>`;
        }))}
      </svg>`}</div>
    </section>`;
  }

  #stats(report: UsageReport, overview: ReturnType<typeof usageOverview>, totals: UsageMetrics) {
    const compared = usageComparison(overview.days, report.range.from, report.range.to);
    const delta = (recent: number | null, previous: number | null) => {
      if (!compared.window || recent === null || previous === null || previous <= 0) return undefined;
      return { change: (recent - previous) / previous, against: `vs previous ${compared.window} ${compared.window === 1 ? "day" : "days"}` };
    };
    const reported = overview.sessions.filter((session) => session.reportedCost).length;
    const messages = totals.userMessages + totals.assistantMessages;
    const rate = messages ? totals.errors / messages : null;
    const previousRate = compared.previous.userMessages + compared.previous.assistantMessages
      ? compared.previous.errors / (compared.previous.userMessages + compared.previous.assistantMessages)
      : null;
    return html`<section class="usage-stats" data-testid="usage-totals">
      ${statCard("Total tokens", compact(totals.totalTokens), count(totals.calls, "usage record"), delta(totals.totalTokens, compared.previous.totalTokens))}
      ${statCard(reported ? "Cost" : "PI cost estimate", cost(totals), reported
        ? `${count(reported, "session")} reported by its own source · recorded prices elsewhere`
        : totals.unpricedCalls ? `${count(totals.unpricedCalls, "unpriced record")}${totals.costUsd === null ? "" : " · partial estimate"}` : "Recorded prices, not a provider bill", delta(totals.costUsd, compared.previous.costUsd))}
      ${statCard("Sessions", number(overview.sessions.length), `${number(report.coverage.readSessions)} local ${report.coverage.readSessions === 1 ? "history" : "histories"} read · ${count(report.coverage.registeredSessions, "registered session")}`)}
      ${statCard("Error rate", rate === null ? "Unavailable" : percent(rate, 1), `${count(totals.errors, "error")} across ${count(messages, "message")}`, delta(rate, previousRate))}
    </section>`;
  }

  #donut(overview: ReturnType<typeof usageOverview>) {
    const top = overview.models.slice(0, 5).map((row) => ({ label: `${row.provider}/${row.model}`, metrics: row.metrics }));
    const rest = overview.models.slice(5);
    const rows = rest.length ? [...top, { label: "Other models", metrics: sumUsage(rest.map((row) => row.metrics)) }] : top;
    const total = overview.totals.totalTokens;
    if (!total || rows.length === 0) return nothing;
    let offset = 0;
    const segments = rows.map((row, index) => {
      const share = row.metrics.totalTokens / total;
      // The rest of the models share one neutral slice, so no colour stands for two models.
      const color = rest.length > 0 && index === rows.length - 1 ? "var(--muted)" : PALETTE[index % PALETTE.length];
      const segment = { ...row, share, color, offset };
      offset += share * 100;
      return segment;
    });
    const detail = (segment: (typeof segments)[number]) => `${segment.label} · ${compact(segment.metrics.totalTokens)} tokens · ${Math.round(segment.share * 100)}%`;
    return html`<section class="settings-group usage-panel usage-card usage-donut-card" data-testid="usage-models">
      <div class="usage-card__header"><div class="usage-card__headline"><h2 class="usage-card__title">Usage by model</h2><p class="usage-card__meta">Recorded tokens, ranked</p></div></div>
      <div class="usage-donut-layout">
        <div class="usage-donut">
          ${svg`<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="usage-donut__track" cx="21" cy="21" r="15.9155" fill="none" pathLength="100" stroke-width="5"></circle>${segments.map((segment) => svg`<circle class="usage-donut__segment" cx="21" cy="21" r="15.9155" fill="none" pathLength="100" stroke=${segment.color} stroke-width="5" stroke-dasharray="${(segment.share * 100).toFixed(2)} ${(100 - segment.share * 100).toFixed(2)}" stroke-dashoffset=${(25 - segment.offset).toFixed(2)} @pointerenter=${(event: PointerEvent) => { if (event.pointerType !== "touch") this.#showTip(event.currentTarget as Element, detail(segment)); }} @pointerleave=${this.#hideTip}></circle>`)}</svg>`}
          <div class="usage-donut__center"><strong>${compact(total)}</strong><span>tokens</span></div>
        </div>
        <div class="usage-donut__legend">${segments.map((segment) => html`<button type="button" class="usage-donut__row" data-hui-tooltip=${`${detail(segment)} · Click to show only these sessions`} @click=${() => this.#usage.search(segment.label)}>
          <span class="usage-donut__dot" style=${`background: ${segment.color}`} aria-hidden="true"></span>
          <span class="usage-donut__name">${segment.label}</span>
          <span class="usage-donut__value">${compact(segment.metrics.totalTokens)} tokens</span>
          <span class="usage-donut__share">${Math.round(segment.share * 100)}%</span>
        </button>`)}</div>
      </div>
    </section>`;
  }

  /** Starts the explanation session and opens it; the page owns nothing else of it. */
  async #investigate(target: UsageInvestigationTarget): Promise<void> {
    const id = await this.#usage.investigate(target);
    if (id) (this.onOpenStartedSession ?? this.onOpenSession)?.(id);
  }

  /**
   * The row's action: start a report, or open the one HUI already started for
   * this target. An answered target says so beside its numbers and never starts
   * a second report by accident.
   */
  #investigateAction(target: UsageInvestigationTarget, label: string, name: string, answered: UsageInvestigationRecord | undefined) {
    if (answered) {
      const range = `${answered.range.from} to ${answered.range.to} (${answered.range.timeZone})`;
      return html`<div class="usage-investigation-actions">
        <span class="usage-investigated" data-testid="usage-investigated" data-hui-tooltip=${"HUI explained it on " + new Date(answered.createdAt).toLocaleDateString() + " for " + range}>Investigated</span>
        <button class="btn btn--sm usage-investigate" type="button" data-hui-tooltip=${"Open the report started for " + name}
          aria-label=${"Open the investigation of " + name} @click=${() => this.onOpenStartedSession?.(answered.id)}>${icons.fileText}<span>Open report</span></button>
      </div>`;
    }
    const starting = this.#usage.investigating === usageInvestigationKey(target);
    return html`<button class="btn btn--sm usage-investigate" type="button" data-hui-tooltip=${label} aria-label=${label}
      aria-busy=${starting} ?disabled=${Boolean(this.#usage.investigating)} @click=${() => void this.#investigate(target)}>${icons.search}<span>${starting ? "Starting…" : "Investigate"}</span></button>`;
  }

  #pullRequests(rows: readonly UsagePullRequest[], investigations: ReadonlyMap<string, UsageInvestigationRecord>) {
    return html`<section class="settings-group usage-panel sessions-card" data-testid="usage-pull-requests">
      <div class="sessions-card-header"><div><h2 class="settings-section__heading">Cost by pull request</h2><p class="usage-summary-sub">${count(rows.length, "pull request")} opened by the sessions in range · a session that opened several counts under each</p></div></div>
      <div class="session-bars">${rows.slice(0, this.#usage.limit).map((row) => html`<article class="session-bar-row" data-testid="usage-pull-request">
        <div class="usage-pr-name"><a class="usage-pr-link" href=${row.url} target="_blank" rel="noreferrer">${row.repository}#${row.number}</a>
          <span class="session-bar-meta">${row.sessions.map((session) => session.title).join(" · ")}</span></div>
        <div class="usage-report__session-values"><strong>${compact(row.metrics.totalTokens)}</strong><span class="usage-summary-sub">${cost(row.metrics)}</span></div>
        ${this.#investigateAction({ kind: "pullRequest", repository: row.repository, number: row.number }, `Investigate why ${row.repository}#${row.number} was expensive`, `${row.repository}#${row.number}`, investigations.get(usageInvestigationKey({ kind: "pullRequest", repository: row.repository, number: row.number })))}
      </article>`)}</div></section>`;
  }

  #rankings(overview: ReturnType<typeof usageOverview>) {
    const totalCost = overview.totals.costUsd;
    const spending = (metrics: UsageMetrics) => {
      const share = totalCost && metrics.costUsd !== null ? ` · ${percent(metrics.costUsd, totalCost)} of cost` : "";
      return `${compact(metrics.totalTokens)} tokens${share}`;
    };
    const failures = usageErrorDays(overview.days);
    const rankings = [
      { title: "Top providers", search: true, rows: overview.providers.map((row) => ({ label: row.provider, detail: spending(row.metrics), value: cost(row.metrics) })) },
      { title: "Top tools", search: false, rows: overview.tools.map((row) => ({ label: row.name, detail: `${count(row.errors, "error")}`, value: count(row.calls, "result") })) },
      { title: "Days with errors", search: false, empty: "No recorded failures in these sessions.", rows: failures.map((row) => ({ label: labelDate(row.date), detail: `${count(row.errors, "error")} · ${count(row.messages, "message")}`, value: `${(row.rate * 100).toFixed(1)}%` })) },
    ];
    return html`<section class="usage-insights-grid hui-card-grid" style=${cardGridStyle(rankings.length)}>${rankings.map(({ title, search, rows, empty }) => html`<article class="usage-insight-card"><h2 class="usage-insight-title">${title}</h2><div class="usage-list">${rows.slice(0, 5).map((row) => html`${search
      ? html`<button type="button" class="usage-list-item usage-rank" data-hui-tooltip=${`Show only sessions with ${row.label}`} @click=${() => this.#usage.search(row.label)}><span class="usage-report__rank-name">${row.label}<span class="usage-list-sub">${row.detail}</span></span><span class="usage-list-value">${row.value}</span></button>`
      : html`<div class="usage-list-item"><span class="usage-report__rank-name">${row.label}<span class="usage-list-sub">${row.detail}</span></span><span class="usage-list-value">${row.value}</span></div>`}`)}${rows.length === 0 ? html`<p class="usage-summary-sub">${empty ?? "No recorded data."}</p>` : nothing}</div></article>`)}</section>`;
  }

  #overviewCards(totals: UsageMetrics, overview: ReturnType<typeof usageOverview>) {
    const cards = [
      summary("Messages", number(totals.userMessages + totals.assistantMessages), `${number(totals.userMessages)} user · ${number(totals.assistantMessages)} assistant`),
      summary("Tool results", number(totals.toolResults), `${count(overview.tools.length, "tool")} recorded`),
      summary("Avg tokens / record", totals.calls ? compact(totals.totalTokens / totals.calls) : "Unavailable", "Across recorded usage metadata"),
      summary("Cache hit rate", totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens ? `${(totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens) * 100).toFixed(1)}%` : "Unavailable", `${compact(totals.cacheReadTokens)} cache-read tokens`),
      summary("Errors", number(totals.errors), "Recorded model and tool failures"),
      summary("Priced records", totals.calls ? `${number(totals.calls - totals.unpricedCalls)} / ${number(totals.calls)}` : "Unavailable", "A recorded zero is included"),
      summary("Avg cost / record", totals.calls && totals.costUsd !== null ? usageCost({ costUsd: totals.costUsd / totals.calls, unpricedCalls: totals.unpricedCalls }) : "Unavailable", "Recorded price per usage record"),
    ];
    return html`<section class="settings-section"><h2 class="settings-section__heading">Usage overview</h2><div class="usage-summary-grid hui-card-grid" style=${cardGridStyle(cards.length)}>${cards}</div></section>`;
  }

  override render() {
    const state = this.#usage;
    const report = state.report;
    if (report && (this.#overview?.report !== report || this.#overview.query !== state.query || this.#overview.sort !== state.sort)) {
      this.#overview = { report, query: state.query, sort: state.sort, value: usageOverview(report, state.query, state.sort) };
    }
    if (report && this.#investigations?.report !== report) this.#investigations = { report, value: usageInvestigations(report) };
    const investigations = report ? this.#investigations?.value ?? new Map<string, UsageInvestigationRecord>() : new Map<string, UsageInvestigationRecord>();
    const overview = report ? this.#overview?.value : undefined;
    const totals = overview?.totals;
    const pullRequests = overview ? usagePullRequests(overview.sessions) : [];
    const active = this.#usage.query.trim().length > 0;
    const lastActive = report ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: report.range.timeZone }) : undefined;
    return html`<header class="content-header content-header--settings"><div><div class="page-title" data-testid="page-title">Usage</div><div class="page-subtitle">Recorded tokens and PI cost estimates.</div></div><div class="page-header-actions">${state.slow && report ? html`<button class="btn" type="button" @click=${() => state.cancel()}>Cancel</button>` : nothing}${report && overview ? html`<button class="btn" type="button" data-hui-tooltip="Download these days as a CSV" @click=${() => downloadTextFile(`hui-usage-daily-${report.range.from}-${report.range.to}.csv`, usageDailyCsv(overview.days.toSorted((left, right) => left.date.localeCompare(right.date))))}>${icons.download}<span>Daily CSV</span></button>` : nothing}<button class="btn" type="button" @click=${() => state.refresh()}>${icons.refresh}<span>${state.loading ? "Refreshing…" : "Refresh"}</span></button></div></header>
    <main class="settings-page settings-page--wide usage-page usage-report" data-testid="usage-report" aria-busy=${state.loading}>
      <section class="settings-section"><h2 class="settings-section__heading">Reporting range</h2><div class="settings-group usage-panel usage-report__controls">
        <div class="usage-controls"><div class="settings-segmented usage-presets" role="group" aria-label="Range presets">${PRESETS.map(([preset, label]) => html`<button type="button" class="settings-segmented__btn ${state.preset === preset ? "settings-segmented__btn--active" : ""}" aria-pressed=${state.preset === preset} @click=${() => state.selectPreset(preset)}>${label}</button>`)}</div>
          <form class="usage-date-range" @submit=${(event: SubmitEvent) => { event.preventDefault(); state.applyRange(); }}>
            <input class="usage-date-input" type="date" required aria-label="From" .value=${live(state.from)} @input=${(event: Event) => { state.from = (event.currentTarget as HTMLInputElement).value; }}>
            <span class="usage-separator" aria-hidden="true">to</span>
            <input class="usage-date-input" type="date" required aria-label="To" .value=${live(state.to)} @input=${(event: Event) => { state.to = (event.currentTarget as HTMLInputElement).value; }}>
            <button class="btn btn--sm" type="submit">Apply range</button>
          </form>
          <div class="usage-zone-picker">${renderPicker({ label: "Time zone", value: state.zone, options: ZONE_OPTIONS, showOptionTooltips: false, onChange: (value) => state.setZone(value === "utc" ? "utc" : "local") })}</div>
          <div class="settings-segmented" role="group" aria-label="Chart metric">${(["tokens", "cost"] as const).map((metric) => html`<button class="settings-segmented__btn ${state.metric === metric ? "settings-segmented__btn--active" : ""}" type="button" aria-pressed=${state.metric === metric} @click=${() => { state.metric = metric; this.requestUpdate(); }}>${metric === "tokens" ? "Tokens" : "Cost"}</button>`)}</div>
        </div>
        <div class="usage-query-bar"><input class="usage-query-input" type="search" placeholder="Search sessions by title, ID or model" aria-label="Filter sessions" .value=${state.query} @input=${(event: Event) => state.search((event.currentTarget as HTMLInputElement).value)}>${active ? html`<button class="btn btn--sm" type="button" @click=${() => state.search("")}>Clear search</button>` : html`<span class="usage-query-hint">${report ? `${count(report.sessions.length, "session")} in range` : ""}</span>`}</div>
      </div></section>
      <div class="usage-report__notes">
        <p class="usage-report__scope">Recorded local conversation histories only. Remote workers and provider billing are not included. Shared fork history counts once.</p>
        ${report && (report.unplacedSpend.totalTokens || report.unplacedSpend.costUsd) ? html`<p class="usage-report__scope" data-testid="usage-unplaced">Also recorded outside these entries: ${number(report.unplacedSpend.totalTokens)} tokens, ${usageCost({ costUsd: report.unplacedSpend.costUsd, unpricedCalls: 0 })}, for all recorded time. Compaction summaries, tool-side model calls and imported history carry no date, so the range totals and the chart leave them out.</p>` : nothing}
      </div>
      ${state.error ? html`<div class="callout danger" role="alert">${state.error}<button class="btn btn--sm" type="button" @click=${() => { this.querySelector<HTMLButtonElement>(".page-header-actions button")?.focus(); void state.load(); }}>Retry</button></div>` : nothing}
      ${!report ? state.loading ? html`${skeleton()}<div class="usage-loading-status" role="status"><span class="usage-loading-note">${state.slow ? "Still reading local histories. This can take a while the first time." : "Reading HUI diagnostics…"}</span>${state.slow ? html`<button class="btn btn--sm" type="button" @click=${() => state.cancel()}>Cancel</button>` : nothing}</div>` : html`<div class="settings-group usage-panel usage-empty-state" role="status"><strong class="usage-empty-state__title">${state.stopped ? "Reading stopped." : "Usage is unavailable."}</strong><p class="usage-summary-sub">${state.stopped ? "The report has not been read yet." : "The gateway has not reported usage yet."}</p><div class="usage-empty-state__actions"><button class="btn btn--sm" type="button" @click=${() => state.refresh()}>Read histories again</button></div></div>` : nothing}
      ${report && (report.coverage.unavailable.length || report.coverage.undatedRecords) ? html`<div class="callout warning">Totals are partial. ${number(report.coverage.unavailable.length)} histories unavailable; ${number(report.coverage.undatedRecords)} records without valid dates were excluded.</div>` : nothing}
      ${report && totals && overview ? html`
        ${this.#stats(report, overview, totals)}
        ${overview.sessions.length ? html`<div class="usage-dashboard">${this.#chart(usageChartDays(overview.days, report.range.from, report.range.to))}${this.#donut(overview)}</div>${this.#heatmap(report, overview, this.#selection?.report === report ? this.#selection : undefined)}` : html`<div class="settings-group usage-panel usage-empty-state"><strong class="usage-empty-state__title">${active ? "No sessions match your search." : "No usage in this range."}</strong><p class="usage-summary-sub">${active ? "Try a title, session ID or model name, or clear the search above." : "Choose another range or start a conversation."}</p>${active ? nothing : html`<div class="usage-empty-state__actions"><button class="btn btn--sm" type="button" @click=${() => state.selectPreset("all")}>Show all time</button></div>`}</div>`}
        ${this.#overviewCards(totals, overview)}
        ${this.#rankings(overview)}
        <section class="settings-group usage-panel sessions-card" data-testid="usage-sessions"><div class="sessions-card-header"><div><h2 class="settings-section__heading">Sessions</h2><p class="usage-summary-sub">${Math.min(state.limit, overview.sessions.length)} shown · ${overview.sessions.length} in range</p></div><div class="usage-card-actions"><button class="btn btn--sm" type="button" data-hui-tooltip="Download these sessions as a CSV" @click=${() => downloadTextFile(`hui-usage-sessions-${report.range.from}-${report.range.to}.csv`, usageSessionCsv(overview.sessions))}>Sessions CSV</button><div class="usage-sessions-sort">Sort sessions<div class="usage-sort-picker">${renderPicker({ label: "Sort sessions", value: state.sort, options: SORT_OPTIONS, showOptionTooltips: false, onChange: (value) => { state.sort = asSort(value); this.requestUpdate(); } })}</div></div></div></div>
          <div class="session-bars" data-testid="usage-session-rows">${overview.sessions.slice(0, state.limit).map((session) => html`<article class="session-bar-row" data-testid="usage-session-row"><button class="session-bar-selection" type="button" @click=${() => this.onOpenSession?.(session.id)}><span class="session-bar-title">${session.title}</span><span class="session-bar-meta">${session.models.map(({ model }) => model).join(", ") || "Unknown model"}${session.parentId ? " · Child session" : ""} · ${lastActive && session.lastActivityAt ? `Active ${lastActive.format(session.lastActivityAt)} · ` : ""}${count(session.metrics.userMessages + session.metrics.assistantMessages, "message")} · ${count(session.metrics.toolResults, "tool result")}</span></button><div class="usage-report__session-values"><strong>${compact(session.metrics.totalTokens)}</strong><span class="usage-summary-sub" data-hui-tooltip=${session.reportedCost ? `Reported by ${session.reportedCost.source}, checked ${checkedAt.format(session.reportedCost.asOf)}` : nothing}>${cost(session.metrics)}${session.reportedCost ? ` · ${session.reportedCost.source}` : ""}</span></div>${session.metrics.calls ? this.#investigateAction({ kind: "session", id: session.id }, `Investigate why ${session.title} was expensive`, session.title, investigations.get(usageInvestigationKey({ kind: "session", id: session.id }))) : nothing}</article>`)}</div>
          ${overview.sessions.length > state.limit ? html`<button class="btn usage-more-sessions" type="button" @click=${() => { state.limit += 50; this.requestUpdate(); }}>Show more</button>` : nothing}
        </section>
        ${state.investigationError ? html`<div class="callout danger" role="alert">${state.investigationError}</div>` : nothing}
        ${pullRequests.length ? this.#pullRequests(pullRequests, investigations) : nothing}` : nothing}
    </main>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-usage-page")) customElements.define("hui-usage-page", HuiUsagePage);
