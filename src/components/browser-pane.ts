/**
 * The browser Work view: the larger live view of one session's agent browser, inside a Work pane tab. Streaming, tabs
 * and pointer marks come from the shared browser view controller; this element fits the frame to the view and stops
 * streaming while the view is hidden. It watches, and while a tab waits for its operator it is also where they drive
 * it: their pointer, wheel and keys go to it, a paste and Cmd/Ctrl+C/V use this device's clipboard, and
 * Continue ends the wait. With no wait holding the tab, the toolbar offers to take it,
 * which stops the agent's run and leaves the tab open for the operator. The Work pane owns the tab, its caption and
 * closing (`views/work/browser.ts`).
 */
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { HuiElement } from "../lit/hui-element.ts";
import { connectBrowserView } from "../api/browser.ts";
import { BrowserViewController } from "../controllers/browser-view-controller.ts";
import { browserTabOptions, browserViewEmptyMessage, browserViewStatus, drivingActivity, drivingLabel, fitFrame, handoffNotice, insertableText, operatorDriving, operatorKey, operatorPoint, relativeTime, takeoverAvailable, type Size } from "../lib/browser-view.ts";
import { renderPicker } from "../views/settings-picker.ts";

/** The larger live view beside the chat: follows the agent's current tab
 * unless the operator picks another, and marks where the agent clicks. */
@customElement("hui-browser-pane")
export class BrowserPane extends HuiElement {
  @property() ownerSessionId = "";
  @property({ type: Boolean }) visible = true;
  @property({ type: Boolean }) enabled = true;
  @state() private box: Size | undefined;
  @state() private now = Date.now();
  private moveFrame: number | undefined;
  private pendingMove: (() => void) | undefined;
  /** The button held on the page, kept across a pointercancel whose own button is -1. */
  private pressedButton: "left" | "right" | undefined;
  private readonly browser = new BrowserViewController(this, connectBrowserView);
  /** The last copied selection written to this device's clipboard. */
  private lastClipboardSeq = 0;
  /** A held press that became a long press: the page gets one context click, not two. */
  private longPress: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;
  private clock: ReturnType<typeof setInterval> | undefined;
  private resizeObserver: ResizeObserver | undefined;

  override connectedCallback() {
    super.connectedCallback();
    this.clock = setInterval(() => { if (this.visible) this.now = Date.now(); }, 5_000);
  }

  protected override willUpdate(changed: PropertyValues) {
    // Hidden views (another tab, a collapsed pane, another conversation) stop streaming.
    if (!changed.has("ownerSessionId") && !changed.has("visible")) return;
    if (this.visible && this.ownerSessionId) this.browser.connect(this.ownerSessionId, "stream");
    else this.browser.disconnect();
  }

  override updated() {
    const clipboard = this.browser.clipboard;
    if (clipboard && clipboard.seq !== this.lastClipboardSeq) {
      this.lastClipboardSeq = clipboard.seq;
      this.browser.clipboard = undefined;
      void this.writeClipboard(clipboard.text);
    }
    const surface = this.querySelector<HTMLElement>(".hui-browser-surface");
    if (!surface || this.resizeObserver) return;
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const style = getComputedStyle(surface);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      this.box = { width: surface.clientWidth - padX, height: surface.clientHeight - padY };
    });
    this.resizeObserver.observe(surface);
  }

  override disconnectedCallback() {
    clearInterval(this.clock);
    clearTimeout(this.longPress);
    this.longPress = undefined;
    if (this.moveFrame !== undefined) cancelAnimationFrame(this.moveFrame);
    this.moveFrame = undefined;
    this.pendingMove = undefined;
    this.pressedButton = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    super.disconnectedCallback();
  }

  private select(tabId: string | null) {
    this.browser.select(tabId);
  }

  /** The operator takes the watched tab: the agent's run stops and the tab waits for them. */
  private takeControl() {
    const tabId = this.browser.view?.watching;
    if (!tabId) return;
    this.browser.send({ action: "takeover", tabId });
  }

  /** Text pasted onto the driving frame goes into the page's focused field at its caret. */
  private paste(event: ClipboardEvent) {
    const tabId = this.browser.view?.handoff?.tabId;
    const text = insertableText(event.clipboardData?.getData("text") ?? "");
    if (!tabId || !text) return;
    event.preventDefault();
    this.browser.send({ action: "insert", tabId, text });
  }

  /** Write the page's copied selection to this device's clipboard; a browser that refuses still gets the
   * legacy copy path. The value never enters a text node, a tooltip or a log. */
  private async writeClipboard(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      document.execCommand("copy");
    } finally {
      area.remove();
      this.querySelector<HTMLElement>(".hui-browser-frame")?.focus();
    }
  }

  private copy() {
    const tabId = this.browser.view?.handoff?.tabId;
    if (tabId) this.browser.send({ action: "copy", tabId });
  }

  /** Their input reaches the browser only through the tab's wait, never by viewing it. */
  private pointer(at: { clientX: number; clientY: number }, kind: "down" | "move" | "up", element: HTMLElement, button: "left" | "right", clickCount = 1) {
    const handoff = this.browser.view?.handoff;
    const frame = this.browser.frame?.tabId === handoff?.tabId ? this.browser.frame : undefined;
    if (!handoff || !frame) return;
    const point = operatorPoint(at, element.getBoundingClientRect(), frame);
    if (!point) return;
    this.browser.send({ action: "pointer", tabId: handoff.tabId, kind, x: point.x, y: point.y, button, clickCount });
  }

  /** A right click at the pointer: the page's own context menu, from a long press or a secondary click. */
  private contextAt(at: { clientX: number; clientY: number }, element: HTMLElement) {
    this.pointer(at, "down", element, "right", 1);
    this.pointer(at, "up", element, "right", 1);
  }

  private contextMenu(event: MouseEvent) {
    event.preventDefault();
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    this.contextAt(event, event.currentTarget as HTMLElement);
  }

  /** Moves arrive faster than a phone link wants to carry them: one per frame. */
  private move(event: PointerEvent) {
    if (this.longPress) { clearTimeout(this.longPress); this.longPress = undefined; }
    const element = event.currentTarget as HTMLElement;
    const at = { clientX: event.clientX, clientY: event.clientY };
    const button = this.pressedButton ?? "left";
    this.pendingMove = () => this.pointer(at, "move", element, button);
    if (this.moveFrame !== undefined) return;
    this.moveFrame = requestAnimationFrame(() => {
      this.moveFrame = undefined;
      const send = this.pendingMove;
      this.pendingMove = undefined;
      send?.();
    });
  }

  private wheel(event: WheelEvent) {
    const handoff = this.browser.view?.handoff;
    const frame = this.browser.frame?.tabId === handoff?.tabId ? this.browser.frame : undefined;
    if (!handoff || !frame) return;
    event.preventDefault();
    const point = operatorPoint(event, (event.currentTarget as HTMLElement).getBoundingClientRect(), frame);
    if (!point) return;
    this.browser.send({ action: "wheel", tabId: handoff.tabId, x: point.x, y: point.y, deltaX: event.deltaX, deltaY: event.deltaY });
  }

  private key(event: KeyboardEvent) {
    const handoff = this.browser.view?.handoff;
    if (!handoff) return;
    if (event.ctrlKey || event.metaKey) {
      const chord = event.key.toLowerCase();
      // The browser's own paste event is what the page answers.
      if (chord === "v") return;
      // Copy the page's selection to this device's clipboard, not the browser's.
      if (chord === "c") { event.preventDefault(); this.copy(); return; }
    }
    const key = operatorKey(event);
    if (!key) return;
    // The page gets Tab, Enter and the arrows; the app keeps none of them while the operator drives.
    event.preventDefault();
    this.browser.send({ action: "key", tabId: handoff.tabId, key });
  }

  private down(event: PointerEvent) {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.focus();
    element.setPointerCapture?.(event.pointerId);
    const button = event.button === 2 ? "right" : "left";
    this.pressedButton = button;
    this.longPressed = false;
    this.longPress = setTimeout(() => {
      this.longPress = undefined;
      this.longPressed = true;
      this.contextAt(event, element);
    }, 450);
    this.pointer(event, "down", element, button, event.detail);
  }

  private up(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement;
    element.releasePointerCapture?.(event.pointerId);
    // A cancel reports -1; the press still names the button the page holds.
    const button = this.pressedButton ?? (event.button === 2 ? "right" : "left");
    this.pressedButton = undefined;
    if (this.longPress) { clearTimeout(this.longPress); this.longPress = undefined; }
    this.longPressed = false;
    this.pointer(event, "up", element, button, event.detail);
  }

  override render() {
    const { view, action, pointer, connection } = this.browser;
    // Only the watched tab's frame; another tab's would sit under the wrong title.
    const frame = this.browser.frame?.tabId === view?.watching ? this.browser.frame : undefined;
    const watching = view?.tabs.find((tab) => tab.id === view.watching);
    const size = frame && this.box ? fitFrame(this.box, frame) : undefined;
    const status = browserViewStatus(view, connection);
    const live = connection === "live" && Boolean(view?.running && view.watching);
    const handoff = view?.handoff;
    const driving = operatorDriving(view);
    const notice = handoff ? handoffNotice(handoff) : undefined;
    // Only while the operator holds the tab: the words say whether the agent waits or was stopped.
    const activity = driving && handoff ? drivingActivity(handoff) : undefined;
    const frameLabel = driving && handoff ? drivingLabel(handoff) : undefined;
    const activityText = activity?.line ?? action?.text;
    // The tab caption already says "Browser"; the bar appears once there is a tab to choose or to stop watching.
    const picking = Boolean(view && view.tabs.length > 0 && view.watching);
    return html`${picking || (view && !view.following) ? html`<div class="hui-browser-toolbar">
      <div class="hui-browser-title">
        ${view && picking
          ? renderPicker({
              label: "Browser tab",
              value: view.watching,
              options: browserTabOptions(view),
              className: "hui-browser-picker",
              showOptionTooltips: false,
              onChange: (id) => this.select(id === view.current ? null : id),
            })
          : nothing}
      </div>
      <div class="hui-browser-actions">
        ${takeoverAvailable(view, connection) ? html`<button type="button" class="btn btn--ghost btn--sm" @click=${this.takeControl}>Take control</button>` : nothing}
        ${view && !view.following ? html`<button type="button" class="btn btn--ghost btn--sm" @click=${() => this.select(null)}>Follow agent</button>` : nothing}
      </div>
    </div>` : nothing}
    <div class="hui-browser-meta">
      <span class="hui-browser-url" data-hui-tooltip=${watching?.url || nothing}>${watching?.url || "No page"}</span>
      <span role="status" class="hui-browser-status">${live ? html`<span class="hui-browser-status__dot" aria-hidden="true"></span>` : nothing}${status}</span>
    </div>
    ${handoff && notice
      ? html`<div class="hui-browser-handoff">
          <p class="hui-browser-handoff__text"><strong>${notice.lead}</strong> ${notice.detail}</p>
          ${driving
            ? html`<button type="button" class="btn btn--sm hui-browser-handoff__done" @click=${() => this.browser.send({ action: "continue", tabId: handoff.tabId })}>I'm done — continue</button>`
            : html`<button type="button" class="btn btn--sm" @click=${() => this.select(handoff.tabId)}>Show tab ${handoff.tabId}</button>`}
        </div>`
      : nothing}
    <div class="hui-browser-surface">
      ${frame && size && watching
        ? html`<div class="hui-browser-frame ${driving ? "hui-browser-frame--driving" : ""}" style=${`width:${size.width}px;height:${size.height}px`}
            tabindex=${driving ? 0 : nothing}
            aria-label=${frameLabel ?? nothing}
            @pointerdown=${driving ? this.down : nothing}
            @pointermove=${driving ? this.move : nothing}
            @pointerup=${driving ? this.up : nothing}
            @pointercancel=${driving ? this.up : nothing}
            @wheel=${driving ? this.wheel : nothing}
            @keydown=${driving ? this.key : nothing}
            @paste=${driving ? this.paste : nothing}
            @contextmenu=${driving ? this.contextMenu : nothing}>
            <img src=${frame.src} alt=${`Live view of ${watching.title || watching.url}`} draggable="false" />
            ${pointer ? keyed(pointer.key, html`<span class="hui-browser-pointer" aria-hidden="true" style=${`left:${pointer.left}%;top:${pointer.top}%`}></span>`) : nothing}
          </div>`
        : html`<p class="hui-browser-empty">${browserViewEmptyMessage(view, connection, this.enabled)}</p>`}
    </div>
    <div class="hui-browser-activity" aria-live="polite">
      ${activityText
        ? html`<span class="hui-browser-activity__text" data-hui-tooltip=${activity?.tooltip ?? action?.text}>${activityText}</span>${action ? html`<time datetime=${action.at}>${relativeTime(action.at, Math.max(this.now, Date.parse(action.at) || 0))}</time>` : nothing}`
        : html`<span>View only · the agent controls this browser</span>`}
    </div>
    ${connection === "disconnected" ? html`<button type="button" class="btn btn--sm hui-browser-reconnect" @click=${() => this.browser.connect(this.ownerSessionId, "stream")}>Reconnect</button>` : nothing}`;
  }
}
