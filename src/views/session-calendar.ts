import { LitElement, html, nothing } from "lit";

import { icons } from "../lib/icons.ts";
import {
  addDays,
  calendarWeek,
  formatDuration,
  loadSessionActivity,
  localHour,
  MIN_DRAWN_MS,
  weekStart,
  type CalendarBlock,
  type CalendarWeek,
} from "../lib/session-calendar.ts";

if (typeof document !== "undefined") await import("../styles/session-calendar.css");

const HOUR_PX = 40;
const POPOVER_PX = 340;

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const hourLabel = (hour: number) => new Date(2000, 0, 1, hour % 24).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** Whether `now` falls in the day that starts at `day` (5 AM). */
const holds = (day: Date, now: Date) => now >= day && now < addDays(day, 1);
const modelName = (model: string | undefined) => model?.slice(model.lastIndexOf("/") + 1);

function weekTitle(start: Date, today: Date): string {
  const end = addDays(start, 6);
  const year = end.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const };
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...year }).formatRange(start, end);
}

/** A week of HUI sessions: when each one was worked on, laid out by day and
 * hour, with the time each took and parallel work counted once. */
export class HuiSessionCalendar extends LitElement {
  onOpenSession?: (id: string) => void;
  #start = weekStart(new Date());
  #shown?: { start: Date; week: CalendarWeek };
  #loading = false;
  #error = "";
  #request = 0;
  /** The clicked block, with the card position its popover takes. */
  #open?: { block: CalendarBlock; left?: number; top?: number; bottom?: number; returnFocus: HTMLElement };
  /** Session highlighted from the side list: pinned by a click, or hovered. */
  #pinned?: string;
  #hovered?: string;
  #scrollToToday = false;

  override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.#outside);
    void this.#load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.#outside);
    this.#request++;
  }

  override updated() {
    if (!this.#scrollToToday) return;
    this.#scrollToToday = false;
    // A narrow screen scrolls the days; start at today, beside the hour labels.
    const today = this.querySelector<HTMLElement>(".session-calendar__day--today");
    const hours = this.querySelector<HTMLElement>(".session-calendar__hours");
    const scroll = this.querySelector<HTMLElement>(".session-calendar__scroll");
    if (!scroll) return;
    scroll.scrollLeft = 0;
    if (today && hours) scroll.scrollLeft = today.getBoundingClientRect().left - hours.getBoundingClientRect().right;
  }

  #outside = (event: PointerEvent) => {
    if (this.#open && !(event.target as Element).closest?.(".session-calendar__popover, .session-calendar__block")) this.#close(false);
  };

  async #load() {
    const request = ++this.#request;
    const start = this.#start;
    this.#loading = true;
    this.#error = "";
    this.requestUpdate();
    try {
      const activity = await loadSessionActivity(start, addDays(start, 7));
      if (request !== this.#request) return;
      const week = calendarWeek(activity, start);
      this.#shown = { start, week };
      this.#open = undefined;
      // A re-render removes rows without a pointerleave; a pinned session may have no time this week.
      this.#hovered = undefined;
      if (!week.sessions.some(({ session }) => session.id === this.#pinned)) this.#pinned = undefined;
      this.#scrollToToday = true;
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "Session activity could not be loaded.";
      if (this.#shown) this.#start = this.#shown.start;
    } finally {
      if (request === this.#request) { this.#loading = false; this.requestUpdate(); }
    }
  }

  #go(start: Date) {
    this.#start = start;
    void this.#load();
  }

  #select(block: CalendarBlock, event: Event) {
    const target = event.currentTarget as HTMLElement;
    if (this.#open?.block === block) { this.#close(true); return; }
    const card = this.querySelector<HTMLElement>(".session-calendar__grid-card")!.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const lower = rect.top + rect.height / 2 > card.top + card.height / 2;
    if (card.width < 2 * POPOVER_PX) {
      // No room beside it: the card's width, under the block, or above it in the lower half.
      this.#open = { block, returnFocus: target, ...(lower ? { bottom: card.bottom - rect.top + 8 } : { top: rect.bottom - card.top + 8 }) };
    } else {
      // Beside the block, on whichever side has room; level with it, or rising from its bottom in the lower half.
      const right = rect.right + 8 - card.left;
      const left = right + POPOVER_PX <= card.width ? right : Math.max(8, rect.left - 8 - POPOVER_PX - card.left);
      this.#open = { block, left, returnFocus: target, ...(lower ? { bottom: Math.max(8, card.bottom - rect.bottom) } : { top: Math.max(8, rect.top - card.top) }) };
    }
    this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLElement>(".session-calendar__popover")?.focus());
  }

  #close(restoreFocus: boolean) {
    const open = this.#open;
    if (!open) return;
    this.#open = undefined;
    this.requestUpdate();
    if (restoreFocus && open.returnFocus.isConnected) open.returnFocus.focus();
  }

  #highlight(): string | undefined { return this.#hovered ?? this.#pinned; }

  #renderBlock(entry: CalendarBlock, day: Date, first: number) {
    const top = (localHour(entry.start, day) - first) * HOUR_PX;
    const bottom = (localHour(Math.max(entry.end, entry.start + MIN_DRAWN_MS), day) - first) * HOUR_PX;
    const height = Math.max(bottom - top, 14);
    const showTime = height >= 46;
    // Title lines that fit above the time: 15px lines inside 10px of padding.
    const lines = Math.max(1, Math.floor((height - 12 - (showTime ? 17 : 0)) / 15));
    const duration = formatDuration(entry.block.end - entry.block.start);
    const highlight = this.#highlight();
    const classes = [
      "session-calendar__block",
      highlight && highlight !== entry.session.id ? "session-calendar__block--dim" : "",
      this.#open?.block === entry ? "session-calendar__block--open" : "",
      height < 30 ? "session-calendar__block--short" : "",
    ].join(" ");
    return html`<button type="button" class=${classes} data-color=${entry.color} data-session=${entry.session.id}
      style="top:${top}px;height:${height - 2}px;left:calc(${(entry.lane / entry.lanes) * 100}% + 2px);width:calc(${100 / entry.lanes}% - 4px);--lines:${lines}"
      aria-label=${`${entry.session.title}, ${time(entry.block.start)} – ${time(entry.block.end)}, ${duration}`}
      aria-expanded=${String(this.#open?.block === entry)}
      @click=${(event: Event) => this.#select(entry, event)}>
      <span class="session-calendar__block-title">${entry.session.title}</span>
      ${showTime ? html`<span class="session-calendar__block-time">${duration}</span>` : nothing}
    </button>`;
  }

  #renderGrid(week: CalendarWeek, now: Date) {
    const [first, last] = week.hours;
    const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    return html`<div class="session-calendar__scroll">
      <div class="session-calendar__grid" style="--hours:${last - first};--hour-px:${HOUR_PX}px">
        <div class="session-calendar__corner"></div>
        ${week.days.map(({ date }) => html`<div class="session-calendar__day-head ${holds(date, now) ? "session-calendar__day-head--today" : ""}">
          ${date.toLocaleDateString(undefined, { weekday: "short" })} <span class="session-calendar__day-number">${date.getDate()}</span>
        </div>`)}
        <div class="session-calendar__hours" aria-hidden="true">
          ${hours.filter((hour) => hour % 3 === 0).map((hour) => html`<span class="session-calendar__hour" style="top:${(hour - first) * HOUR_PX}px">${hourLabel(hour)}</span>`)}
        </div>
        ${week.days.map(({ date, blocks }) => {
          const today = holds(date, now);
          const hour = localHour(now.valueOf(), date);
          return html`<div class="session-calendar__day ${today ? "session-calendar__day--today" : ""}"
            role="group" aria-label=${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
            ${blocks.map((block) => this.#renderBlock(block, date, first))}
            ${today && hour >= first && hour <= last
              ? html`<div class="session-calendar__now" style="top:${(hour - first) * HOUR_PX}px" aria-hidden="true"></div>` : nothing}
          </div>`;
        })}
      </div>
    </div>
    ${week.sessions.length === 0 ? html`<div class="session-calendar__empty">No HUI session activity this week.</div>` : nothing}`;
  }

  #renderPopover(week: CalendarWeek) {
    const open = this.#open;
    if (!open) return nothing;
    const { block, session, color } = open.block;
    const total = week.sessions.find((entry) => entry.session.id === session.id);
    const place = `${open.left === undefined ? "" : `left:${open.left}px;`}${open.top === undefined ? `bottom:${open.bottom}px` : `top:${open.top}px`}`;
    return html`<div class="session-calendar__popover ${open.left === undefined ? "session-calendar__popover--full" : ""}" role="dialog" aria-labelledby="session-calendar-popover-title" tabindex="-1" style=${place}
      @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.#close(true); } }}>
      <h3 class="session-calendar__popover-title" id="session-calendar-popover-title">${session.title}</h3>
      <div class="session-calendar__popover-when">
        ${new Date(block.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        · ${time(block.start)} – ${time(block.end)} · ${formatDuration(block.end - block.start)}
      </div>
      <div class="session-calendar__popover-meta">
        <span class="session-calendar__chip"><span class="session-calendar__dot" data-color=${color}></span>${session.group || "Ungrouped"}</span>
        ${block.model ? html`<span>${modelName(block.model)}</span>` : nothing}
      </div>
      ${block.firstMessage ? html`<div class="session-calendar__popover-label">First message</div>
        <p class="session-calendar__popover-quote">“${block.firstMessage}”</p>` : nothing}
      <div class="session-calendar__popover-foot">
        <span><strong>${formatDuration(total?.ms ?? 0)}</strong> this week</span>
        ${this.onOpenSession ? html`<button type="button" class="btn btn--sm" @click=${() => this.onOpenSession?.(session.id)}>Open session</button>` : nothing}
      </div>
    </div>`;
  }

  #renderSide(week: CalendarWeek, now: Date) {
    const highlight = this.#highlight();
    const dayMax = Math.max(1, ...week.days.map((day) => day.activeMs));
    const busiest = week.days.reduce((best, day) => day.activeMs > best.activeMs ? day : best, week.days[0]!);
    return html`<aside class="session-calendar__side">
      <section class="session-calendar__panel">
        <h2 class="session-calendar__total"><strong>${formatDuration(week.activeMs)}</strong>
          across ${week.sessions.length} ${week.sessions.length === 1 ? "session" : "sessions"}</h2>
        <div class="session-calendar__stack" aria-hidden="true">
          ${week.sessions.map(({ session, color, ms }) => html`<span data-color=${color}
            class=${highlight && highlight !== session.id ? "session-calendar__stack--dim" : ""}
            style="flex-grow:${ms}"></span>`)}
        </div>
        <p class="session-calendar__caption">Parallel sessions counted once · ${formatDuration(week.sessionMs)} of session time</p>
        <ul class="session-calendar__sessions" aria-label="Time per session">
          ${week.sessions.map(({ session, color, ms }) => html`<li>
            <button type="button" class="session-calendar__session ${highlight === session.id ? "session-calendar__session--active" : ""}"
              aria-pressed=${String(this.#pinned === session.id)}
              @click=${() => { this.#pinned = this.#pinned === session.id ? undefined : session.id; this.requestUpdate(); }}
              @pointerenter=${() => { this.#hovered = session.id; this.requestUpdate(); }}
              @pointerleave=${() => { this.#hovered = undefined; this.requestUpdate(); }}>
              <span class="session-calendar__dot" data-color=${color}></span>
              <span class="session-calendar__session-title">${session.title}</span>
              <span class="session-calendar__session-time">${formatDuration(ms)}</span>
            </button>
          </li>`)}
        </ul>
      </section>
      <section class="session-calendar__panel">
        <h2 class="session-calendar__panel-title">Hours per day</h2>
        <div class="session-calendar__days" role="list">
          ${week.days.map((day) => html`<div class="session-calendar__bar ${holds(day.date, now) ? "session-calendar__bar--today" : ""}" role="listitem"
            aria-label=${`${day.date.toLocaleDateString(undefined, { weekday: "long" })}: ${formatDuration(day.activeMs)}`} title=${formatDuration(day.activeMs)}>
            <span class="session-calendar__bar-track">
              <span class="session-calendar__bar-fill ${day === busiest && day.activeMs > 0 ? "session-calendar__bar-fill--max" : ""}" style="height:${Math.max(2, (day.activeMs / dayMax) * 100)}%">
                ${day === busiest && day.activeMs > 0 ? html`<span class="session-calendar__bar-value">${formatDuration(day.activeMs)}</span>` : nothing}
              </span>
            </span>
            <span class="session-calendar__bar-label">${day.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
          </div>`)}
        </div>
      </section>
    </aside>`;
  }

  override render() {
    const today = new Date();
    const current = weekStart(today);
    const shown = this.#shown;
    const nav = html`<div class="session-calendar__nav">
      <button type="button" class="btn btn--icon session-calendar__prev" aria-label="Previous week" title="Previous week"
        @click=${() => this.#go(addDays(this.#start, -7))}>${icons.chevron}</button>
      <button type="button" class="btn btn--sm" ?disabled=${this.#start.valueOf() === current.valueOf()} @click=${() => this.#go(current)}>This week</button>
      <button type="button" class="btn btn--icon" aria-label="Next week" title="Next week" ?disabled=${this.#start >= current}
        @click=${() => this.#go(addDays(this.#start, 7))}>${icons.chevron}</button>
      <button type="button" class="btn btn--icon" aria-label="Refresh" title="Refresh" ?disabled=${this.#loading} @click=${() => void this.#load()}>${icons.refresh}</button>
    </div>`;
    if (!shown) {
      return html`<div class="session-calendar__toolbar"><h2 class="session-calendar__title">${weekTitle(this.#start, today)}</h2>${nav}</div>
        ${this.#error
          ? html`<div class="callout danger" role="alert">${this.#error} <button type="button" class="btn btn--sm" @click=${() => void this.#load()}>Retry</button></div>`
          : html`<div class="observability-feedback" role="status">Reading session activity…</div>`}`;
    }
    const { week } = shown;
    const blocks = week.days.reduce((sum, day) => sum + day.blocks.length, 0);
    return html`
      <div class="session-calendar__toolbar">
        <h2 class="session-calendar__title">${weekTitle(shown.start, today)}</h2>
        <div class="session-calendar__summary">
          <span><strong>${week.sessions.length}</strong> ${week.sessions.length === 1 ? "session" : "sessions"}</span>
          <span><strong>${blocks}</strong> ${blocks === 1 ? "block" : "blocks"}</span>
          ${week.peak > 1 ? html`<span>up to <strong>${week.peak}</strong> at once</span>` : nothing}
        </div>
        ${nav}
      </div>
      ${this.#error ? html`<div class="callout warning" role="alert">${this.#error}</div>` : nothing}
      <div class="session-calendar__layout" aria-busy=${String(this.#loading)}>
        <div class="session-calendar__grid-card">
          ${this.#renderGrid(week, today)}
          ${this.#renderPopover(week)}
        </div>
        ${this.#renderSide(week, today)}
      </div>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-session-calendar")) customElements.define("hui-session-calendar", HuiSessionCalendar);
