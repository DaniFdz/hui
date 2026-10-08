/**
 * The Work pane beside the chat: the focused conversation's Work views as a tab strip with a "+" launcher menu, an
 * empty state listing the launchers with their shortcuts, a collapsed rail, a resizable left edge and, below 1100px,
 * a full-screen destination. It renders each kind's view and keeps the views of recently focused conversations
 * mounted but hidden, in a stable DOM order, so terminals and frames keep their state. The state and its transitions
 * belong to the caller (`lib/work-pane.ts`, applied by hui-app); each view belongs to its kind.
 */
import { html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { HuiElement } from "../lit/hui-element.ts";
import { hasOpenWebAwesomePopup } from "../lib/web-awesome.ts";
import { ariaShortcut, formatShortcut } from "../lib/shortcut-binding.ts";
import { requestOpenSettings, settingsHref } from "../lib/open-settings.ts";
import {
  clampWorkPaneWidth, sessionWorkPane, workPaneFits, workViewKey, workViewKind, workViewKinds,
  WORK_PANE_MIN_WIDTH, WORK_PANE_TOGGLE_SHORTCUT,
  type WorkPaneStore, type WorkViewKind, type WorkViewRef, type WorkViewResource, type WorkViewSettingsLink,
} from "../lib/work-pane.ts";

const VIEW_DRAG_TYPE = "application/x-hui-work-view";

/** Local 16px icons in the OpenClaw stroke shell (Lucide geometry); `icons.ts` holds only verbatim upstream icons. */
const stroke16 = (body: ReturnType<typeof svg>) => html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const plusIcon = stroke16(svg`<path d="M5 12h14M12 5v14" />`);
const closeIcon = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>`;
const settingsIcon = stroke16(svg`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />`);
const backIcon = stroke16(svg`<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />`);
const panelOpenIcon = stroke16(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18M10 10l-3 2 3 2" />`);
const panelCloseIcon = stroke16(svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18M8 10l3 2-3 2" />`);

type ViewEntry = { ref: WorkViewRef; kind: WorkViewKind; key: string };
type FocusTarget = "active" | "rail" | { tab: string };

function entries(views: readonly WorkViewRef[]): ViewEntry[] {
  return views.flatMap((ref) => {
    const kind = workViewKind(ref.kind);
    return kind ? [{ ref, kind, key: workViewKey(ref) }] : [];
  });
}

@customElement("hui-work-pane")
export class WorkPane extends HuiElement {
  @property({ attribute: false }) store: WorkPaneStore = {};
  /** The focused conversation, whose views the pane shows. */
  @property() sessionId = "";
  /** Conversations whose views stay mounted, most recent first (from `retainWorkSessions`). */
  @property({ attribute: false }) retained: readonly string[] = [];
  @property({ type: Boolean }) narrow = false;
  /** Chat columns side by side beside the pane; each keeps its room (`WORK_PANE_CHAT_MIN_WIDTH`). */
  @property({ type: Number }) chatColumns = 1;
  /** Narrow screens: the pane is the destination shown instead of the chat. */
  @property({ type: Boolean }) narrowShown = false;
  /** The view the operator just launched; it may take focus. */
  @property() launchedKey = "";
  /** A launcher whose view is being created. */
  @property() launching = "";
  @property() error = "";
  @property({ attribute: false }) onLaunch!: (kind: string) => void;
  @property({ attribute: false }) onReopen!: (ref: WorkViewRef) => void;
  @property({ attribute: false }) onActivate!: (key: string) => void;
  @property({ attribute: false }) onClose!: (sessionId: string, key: string) => void;
  @property({ attribute: false }) onReorder!: (key: string, index: number) => void;
  @property({ attribute: false }) onToggle!: (open: boolean) => void;
  @property({ attribute: false }) onResize!: (width: number, available: number, done: boolean) => void;
  @property({ attribute: false }) onBack!: () => void;
  @property({ attribute: false }) onEscape!: () => void;
  @property({ attribute: false }) onDismissError!: () => void;
  @state() private available = 0;
  /** The conversation whose pane the operator expanded although the chat columns leave it no room. */
  @state() private squeezedOpen = "";
  @state() private reopenable: WorkViewResource[] = [];
  @state() private announcement = "";
  @state() private resizing = false;
  /** First-seen order of conversations and views: the DOM never reorders mounted views (reparenting a custom element
   * disconnects it and tears down its socket or canvas), so tab order is visual only. */
  private readonly mountOrder = new Map<string, number>();
  private mountSequence = 0;
  private pendingFocus: FocusTarget | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private drag: { startX: number; startWidth: number; width: number } | undefined;
  private draggingKey = "";

  /** Unsubscribes from the kinds' availability changes (a launcher's reason appears or goes away). */
  private stopAvailability: (() => void)[] = [];

  override connectedCallback() {
    super.connectedCallback();
    this.stopAvailability = workViewKinds().flatMap((kind) => kind.onAvailabilityChange ? [kind.onAvailabilityChange(() => this.requestUpdate())] : []);
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.parentElement?.clientWidth ?? 0;
      if (width !== this.available) this.available = width;
    });
    if (this.parentElement) this.resizeObserver.observe(this.parentElement);
  }

  override disconnectedCallback() {
    for (const stop of this.stopAvailability) stop();
    this.stopAvailability = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    super.disconnectedCallback();
  }

  /** Moves keyboard focus into the pane once it renders: the active tab (or first launcher), or the collapsed rail. */
  focusPane(target: "active" | "rail") {
    this.pendingFocus = target;
    this.requestUpdate();
  }

  override updated() {
    const target = this.pendingFocus;
    if (!target) return;
    this.pendingFocus = undefined;
    const element = target === "rail"
      ? this.querySelector<HTMLElement>(".work-pane__expand")
      : typeof target === "object"
        ? this.querySelector<HTMLElement>(`.work-pane__tab[data-key="${CSS.escape(target.tab)}"] [role="tab"]`)
        : this.querySelector<HTMLElement>('.work-pane__tab [role="tab"][aria-selected="true"]')
          ?? this.querySelector<HTMLElement>(".work-pane__empty-launcher:not([disabled])")
          ?? this.querySelector<HTMLElement>('.work-pane__launcher [slot="trigger"]');
    element?.focus({ preventScroll: true });
  }

  private order(id: string): number {
    let value = this.mountOrder.get(id);
    if (value === undefined) {
      value = ++this.mountSequence;
      this.mountOrder.set(id, value);
    }
    return value;
  }

  private shown(): boolean {
    if (this.narrow) return this.narrowShown;
    return sessionWorkPane(this.store, this.sessionId).open && (this.fits() || this.squeezedOpen === this.sessionId);
  }

  /** An expanded pane at its minimum still leaves every chat column its room. */
  private fits(): boolean {
    return workPaneFits(this.available, this.chatColumns);
  }

  /** The pane is expanded on screen (open, and not collapsed to its rail for lack of room). */
  get expanded(): boolean {
    return this.shown();
  }

  override willUpdate() {
    // Once there is room again the pane simply fits; a later squeeze collapses it again.
    if (this.squeezedOpen && (this.fits() || this.squeezedOpen !== this.sessionId)) this.squeezedOpen = "";
  }

  private readonly keydown = (event: KeyboardEvent) => {
    // A WA dropdown closes on Escape from a document listener; leave that press to it.
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || hasOpenWebAwesomePopup(event)) return;
    // Escape leaves the pane; it never reaches the chat, where it would stop the agent's turn.
    event.preventDefault();
    event.stopPropagation();
    this.onEscape();
  };

  private toggle(open: boolean) {
    // Without room the operator's expand wins: the pane shows at its minimum and the chat columns narrow.
    this.squeezedOpen = open && !this.narrow && !this.fits() ? this.sessionId : "";
    this.onToggle(open);
    this.focusPane(open ? "active" : "rail");
  }

  /** Expands the pane (the toggle shortcut), even when the chat columns leave it no room. */
  expand() {
    this.toggle(true);
  }

  /** A view of `sessionId` was just opened or shown on purpose: if the chat columns leave no room, show the pane
   * anyway (cleared again as soon as it fits). */
  reveal(sessionId = this.sessionId) {
    if (!this.narrow) this.squeezedOpen = sessionId;
  }

  private activate(key: string, focus = false) {
    this.onActivate(key);
    if (focus) this.pendingFocus = { tab: key };
  }

  private close(sessionId: string, key: string) {
    const focusInside = this.contains(document.activeElement);
    this.onClose(sessionId, key);
    if (focusInside && sessionId === this.sessionId) this.focusPane("active");
  }

  private tabKeydown(event: KeyboardEvent, views: ViewEntry[], index: number) {
    const view = views[index]!;
    if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const to = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= views.length) return;
      this.onReorder(view.key, to);
      this.pendingFocus = { tab: view.key };
      this.announcement = `${view.kind.title(view.ref)} moved to position ${to + 1} of ${views.length}.`;
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.close(this.sessionId, view.key);
      return;
    }
    const target = event.key === "ArrowLeft" ? views[(index - 1 + views.length) % views.length]
      : event.key === "ArrowRight" ? views[(index + 1) % views.length]
        : event.key === "Home" ? views[0] : event.key === "End" ? views.at(-1) : undefined;
    if (!target) return;
    event.preventDefault();
    this.activate(target.key, true);
  }

  private readonly loadReopenable = async () => {
    const sessionId = this.sessionId;
    const open = new Set(sessionWorkPane(this.store, sessionId).views.map(workViewKey));
    const found = await Promise.all(workViewKinds().map((kind) => kind.existing?.(sessionId).catch(() => []) ?? []));
    if (sessionId !== this.sessionId) return;
    this.reopenable = found.flat().filter(({ ref }) => !open.has(workViewKey(ref)));
  };

  private readonly selectMenu = (event: CustomEvent<{ item: HTMLElement }>) => {
    const value = event.detail.item.getAttribute("value") ?? "";
    if (value.startsWith("launch:")) this.onLaunch(value.slice(7));
    else if (value.startsWith("settings:")) {
      const link = workViewKind(value.slice(9))?.settingsLink?.(this.sessionId);
      if (link && !requestOpenSettings(this, link)) window.location.assign(settingsHref(link));
    } else if (value.startsWith("reopen:")) {
      const resource = this.reopenable[Number(value.slice(7))];
      if (resource) this.onReopen(resource.ref);
    }
  };

  private readonly resizeStart = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const width = this.getBoundingClientRect().width;
    this.drag = { startX: event.clientX, startWidth: width, width };
    this.resizing = true;
    handle.setPointerCapture(event.pointerId);
    // No text selection while dragging; keep the arrow keys on the handle, as clicking it would.
    event.preventDefault();
    handle.focus({ preventScroll: true });
  };

  private readonly resizeMove = (event: PointerEvent) => {
    if (!this.drag) return;
    this.drag.width = this.drag.startWidth + (this.drag.startX - event.clientX);
    this.onResize(this.drag.width, this.available, false);
  };

  private readonly resizeEnd = () => {
    if (!this.drag) return;
    const { width } = this.drag;
    this.drag = undefined;
    this.resizing = false;
    this.onResize(width, this.available, true);
  };

  private readonly resizeKey = (event: KeyboardEvent) => {
    const width = this.getBoundingClientRect().width;
    const step = event.shiftKey ? 80 : 24;
    const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step
      : event.key === "Home" ? WORK_PANE_MIN_WIDTH : event.key === "End" ? Number.POSITIVE_INFINITY : undefined;
    if (next === undefined) return;
    event.preventDefault();
    this.onResize(next, this.available, true);
  };

  private dragStart(event: DragEvent, key: string) {
    if (!event.dataTransfer || this.narrow) { event.preventDefault(); return; }
    this.draggingKey = key;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(VIEW_DRAG_TYPE, key);
    // The multiplexer's own pane dragging must not see this.
    event.stopPropagation();
  }

  private dragOver(event: DragEvent) {
    if (!this.draggingKey || !event.dataTransfer?.types.includes(VIEW_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  private drop(event: DragEvent, index: number) {
    if (!this.draggingKey || !event.dataTransfer?.types.includes(VIEW_DRAG_TYPE)) return;
    event.preventDefault();
    const key = this.draggingKey;
    this.draggingKey = "";
    this.onReorder(key, index);
  }

  private renderTabs(views: ViewEntry[], active: string | undefined) {
    return html`<div class="work-pane__tabs" role="tablist" aria-label="Work views">${views.map((view, index) => {
      const title = view.kind.title(view.ref);
      const selected = view.key === active;
      const id = this.order(`${this.sessionId}\u0000${view.key}`);
      return html`<div class="work-pane__tab ${selected ? "work-pane__tab--active" : ""}" role="presentation" draggable=${this.narrow ? "false" : "true"} data-key=${view.key}
        @dragstart=${(event: DragEvent) => this.dragStart(event, view.key)}
        @dragover=${(event: DragEvent) => this.dragOver(event)}
        @drop=${(event: DragEvent) => this.drop(event, index)}
        @dragend=${() => { this.draggingKey = ""; }}>
        <button type="button" class="work-pane__tab-select" role="tab" id=${`work-tab-${id}`} aria-controls=${`work-view-${id}`}
          aria-selected=${String(selected)} tabindex=${selected ? "0" : "-1"} aria-keyshortcuts="Delete"
          data-hui-tooltip=${title}
          @click=${() => this.activate(view.key)}
          @keydown=${(event: KeyboardEvent) => this.tabKeydown(event, views, index)}
        >${view.kind.icon}<span class="work-pane__tab-label">${title}</span></button>
        <button type="button" class="work-pane__tab-close" tabindex="-1" aria-label=${`Close ${title}`} data-hui-tooltip="Close tab"
          @click=${(event: Event) => { event.stopPropagation(); this.close(this.sessionId, view.key); }}>${closeIcon}</button>
      </div>`;
    })}</div>`;
  }

  private renderLauncherMenu() {
    return html`<wa-dropdown class="work-pane__launcher" placement="bottom-end" @wa-show=${this.loadReopenable} @wa-select=${this.selectMenu}>
      <button slot="trigger" type="button" class="btn btn--ghost btn--icon work-pane__icon-btn" aria-label="Open Work view" data-hui-tooltip="Open Work view">${plusIcon}</button>
      ${workViewKinds().map((kind) => {
        const reason = kind.unavailable?.(this.sessionId);
        return html`<wa-dropdown-item value=${`launch:${kind.kind}`} class="session-menu__item work-pane__menu-item" ?disabled=${Boolean(reason) || this.launching === kind.kind}>
          <span slot="icon" class="session-menu__icon" aria-hidden="true">${kind.icon}</span>
          <span class="session-menu__text work-pane__menu-text">${kind.label}${reason ? html`<span class="work-pane__menu-reason">${reason}</span>` : nothing}</span>
          ${kind.shortcut ? html`<kbd slot="details" class="work-pane__shortcut">${formatShortcut(kind.shortcut)}</kbd>` : nothing}
        </wa-dropdown-item>
        ${reason ? this.renderSettingsMenuItem(kind) : nothing}`;
      })}
      ${this.reopenable.length ? html`<div class="session-menu__separator" role="separator"></div>
        <div class="work-pane__menu-label" role="presentation">Running</div>
        ${this.reopenable.map((resource, index) => html`<wa-dropdown-item value=${`reopen:${index}`} class="session-menu__item work-pane__menu-item">
          <span slot="icon" class="session-menu__icon" aria-hidden="true">${workViewKind(resource.ref.kind)?.icon ?? nothing}</span>
          <span class="session-menu__text">${resource.title}</span>
        </wa-dropdown-item>`)}` : nothing}
    </wa-dropdown>`;
  }

  /** Beside a launcher that cannot act: the menu entry that opens the Settings section able to change that. */
  private renderSettingsMenuItem(kind: WorkViewKind) {
    const link = kind.settingsLink?.(this.sessionId);
    if (!link) return nothing;
    return html`<wa-dropdown-item value=${`settings:${kind.kind}`} class="session-menu__item work-pane__menu-item work-pane__menu-settings">
      <span slot="icon" class="session-menu__icon" aria-hidden="true">${settingsIcon}</span>
      <span class="session-menu__text">${link.label}</span>
    </wa-dropdown-item>`;
  }

  private renderSettingsLink(link: WorkViewSettingsLink | undefined) {
    if (!link) return nothing;
    return html` <a class="work-pane__settings-link" href=${settingsHref(link)} @click=${(event: MouseEvent) => {
      if (requestOpenSettings(this, link)) event.preventDefault();
    }}>${link.label}</a>`;
  }

  private renderEmpty() {
    return html`<div class="work-pane__empty">
      <p class="work-pane__empty-lead">Open a view beside this conversation.</p>
      <ul class="work-pane__empty-launchers">${workViewKinds().map((kind) => {
        const reason = kind.unavailable?.(this.sessionId);
        return html`<li>
          <button type="button" class="work-pane__empty-launcher" ?disabled=${Boolean(reason) || this.launching === kind.kind}
            aria-keyshortcuts=${kind.shortcut ? ariaShortcut(kind.shortcut) : nothing}
            @click=${() => this.onLaunch(kind.kind)}>
            ${kind.icon}<span class="work-pane__empty-label">${this.launching === kind.kind ? `${kind.label}…` : kind.label}</span>
            ${kind.shortcut ? html`<kbd class="work-pane__shortcut">${formatShortcut(kind.shortcut)}</kbd>` : nothing}
          </button>
          ${reason ? html`<p class="work-pane__unavailable">${reason}${this.renderSettingsLink(kind.settingsLink?.(this.sessionId))}</p>` : nothing}
        </li>`;
      })}</ul>
      ${this.narrow ? nothing : html`<p class="work-pane__empty-hint"><kbd class="work-pane__shortcut">${formatShortcut(WORK_PANE_TOGGLE_SHORTCUT)}</kbd> shows or hides this pane.</p>`}
    </div>`;
  }

  private renderRail(views: ViewEntry[], active: string | undefined) {
    const shortcut = formatShortcut(WORK_PANE_TOGGLE_SHORTCUT);
    return html`<div class="work-pane__rail">
      <button type="button" class="btn btn--ghost btn--icon work-pane__icon-btn work-pane__expand" aria-label="Show Work pane" aria-expanded="false"
        aria-keyshortcuts=${ariaShortcut(WORK_PANE_TOGGLE_SHORTCUT)} data-hui-tooltip=${`Show Work pane (${shortcut})`}
        @click=${() => this.toggle(true)}>${panelOpenIcon}</button>
      ${views.map((view) => {
        const title = view.kind.title(view.ref);
        return html`<button type="button" class="btn btn--ghost btn--icon work-pane__icon-btn" aria-label=${`Show ${title}`} data-hui-tooltip=${title}
          aria-current=${view.key === active ? "true" : nothing}
          @click=${() => { this.reveal(); this.activate(view.key); this.pendingFocus = { tab: view.key }; }}>${view.kind.icon}</button>`;
      })}
    </div>`;
  }

  private renderHeader(views: ViewEntry[], active: string | undefined) {
    const shortcut = formatShortcut(WORK_PANE_TOGGLE_SHORTCUT);
    return html`<div class="work-pane__header">
      ${this.narrow ? html`<button type="button" class="btn btn--ghost btn--icon work-pane__icon-btn" aria-label="Back to chat" data-hui-tooltip="Back to chat" @click=${this.onBack}>${backIcon}</button>` : nothing}
      ${views.length ? this.renderTabs(views, active) : html`<h2 class="work-pane__title">Work</h2>`}
      ${this.renderLauncherMenu()}
      ${this.narrow ? nothing : html`<button type="button" class="btn btn--ghost btn--icon work-pane__icon-btn work-pane__collapse" aria-label="Hide Work pane" aria-expanded="true"
        aria-keyshortcuts=${ariaShortcut(WORK_PANE_TOGGLE_SHORTCUT)} data-hui-tooltip=${`Hide Work pane (${shortcut})`}
        @click=${() => this.toggle(false)}>${panelCloseIcon}</button>`}
    </div>`;
  }

  private renderSession(sessionId: string, shown: boolean) {
    const pane = sessionWorkPane(this.store, sessionId);
    const focused = sessionId === this.sessionId;
    const views = entries(pane.views).sort((a, b) => this.order(`${sessionId}\u0000${a.key}`) - this.order(`${sessionId}\u0000${b.key}`));
    return html`<div class="work-pane__session ${focused ? "work-pane__session--focused" : ""}" ?inert=${!focused}>
      ${repeat(views, (view) => view.key, (view) => {
        const id = this.order(`${sessionId}\u0000${view.key}`);
        const active = focused && view.key === pane.active;
        return html`<section class="work-pane__view ${active ? "work-pane__view--active" : ""}" role="tabpanel" id=${`work-view-${id}`}
          aria-labelledby=${`work-tab-${id}`} ?inert=${!active} aria-hidden=${String(!active)}>
          ${view.kind.render(view.ref, {
            sessionId,
            visible: active && shown,
            narrow: this.narrow,
            autofocus: focused && view.key === this.launchedKey,
            close: () => this.close(sessionId, view.key),
            invalidate: () => this.requestUpdate(),
          })}
        </section>`;
      })}
    </div>`;
  }

  override render() {
    const pane = sessionWorkPane(this.store, this.sessionId);
    const shown = this.shown();
    const views = entries(pane.views);
    const width = clampWorkPaneWidth(pane.width, this.available || undefined, this.chatColumns);
    // Mounted conversations keep their first-seen DOM order; forget the ones that left.
    const sessions = [...new Set(this.retained)].filter((id) => sessionWorkPane(this.store, id).views.length);
    const live = new Set([...sessions, this.sessionId].flatMap((id) => [id, ...sessionWorkPane(this.store, id).views.map((ref) => `${id}\u0000${workViewKey(ref)}`)]));
    for (const id of this.mountOrder.keys()) if (!live.has(id)) this.mountOrder.delete(id);
    sessions.sort((a, b) => this.order(a) - this.order(b));
    return html`<aside class="work-pane ${shown ? "work-pane--open" : "work-pane--collapsed"} ${this.narrow ? "work-pane--narrow" : ""} ${this.resizing ? "work-pane--resizing" : ""}"
      style=${!this.narrow && shown ? `width:${width}px` : ""} aria-label="Work pane" @keydown=${this.keydown}>
      ${!this.narrow && shown ? html`<div class="work-pane__resizer" role="separator" aria-orientation="vertical" aria-label="Resize Work pane" tabindex="0"
        aria-valuenow=${width} aria-valuemin=${WORK_PANE_MIN_WIDTH} aria-valuemax=${clampWorkPaneWidth(Number.POSITIVE_INFINITY, this.available || undefined, this.chatColumns)}
        @pointerdown=${this.resizeStart} @pointermove=${this.resizeMove} @pointerup=${this.resizeEnd} @pointercancel=${this.resizeEnd} @lostpointercapture=${this.resizeEnd}
        @keydown=${this.resizeKey}></div>` : nothing}
      ${!this.narrow && !shown ? this.renderRail(views, pane.active) : nothing}
      ${shown ? this.renderHeader(views, pane.active) : nothing}
      ${shown && this.error ? html`<div class="work-pane__error" role="alert"><span>${this.error}</span>
        <button type="button" class="btn btn--ghost btn--icon work-pane__icon-btn" aria-label="Dismiss" data-hui-tooltip="Dismiss" @click=${this.onDismissError}>${closeIcon}</button></div>` : nothing}
      <div class="work-pane__bodies">
        ${repeat(sessions, (id) => id, (id) => this.renderSession(id, shown))}
        ${shown && !views.length ? this.renderEmpty() : nothing}
      </div>
      <span class="work-pane__announcement" role="status">${this.announcement}</span>
    </aside>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "hui-work-pane": WorkPane }
}
