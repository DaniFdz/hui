/**
 * The browser Work view: the larger live view of one session's agent browser, inside a Work pane tab. Streaming, tabs
 * and pointer marks come from the shared browser view controller; this element fits the frame to the view and stops
 * streaming while the view is hidden. It watches, and while the agent has handed a tab over it is also where the
 * operator takes that tab: their pointer, wheel and keys go to it, and Continue ends the wait. The Work pane owns
 * the tab, its caption and closing (`views/work/browser.ts`).
 */
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { HuiElement } from "../lit/hui-element.ts";
import { connectBrowserView } from "../api/browser.ts";
import { BrowserViewController } from "../controllers/browser-view-controller.ts";
import { browserTabOptions, browserViewEmptyMessage, browserViewStatus, fitFrame, operatorDriving, operatorKey, operatorPoint, relativeTime, type Size } from "../lib/browser-view.ts";
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
  private readonly browser = new BrowserViewController(this, connectBrowserView);
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
    if (this.moveFrame !== undefined) cancelAnimationFrame(this.moveFrame);
    this.moveFrame = undefined;
    this.pendingMove = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    super.disconnectedCallback();
  }

  private select(tabId: string | null) {
    this.browser.select(tabId);
  }

  /** Their input reaches the browser only through the handoff the agent opened. */
  private pointer(at: { clientX: number; clientY: number }, kind: "down" | "move" | "up", element: HTMLElement, button: number) {
    const handoff = this.browser.view?.handoff;
    const frame = this.browser.frame?.tabId === handoff?.tabId ? this.browser.frame : undefined;
    if (!handoff || !frame) return;
    const point = operatorPoint(at, element.getBoundingClientRect(), frame);
    if (!point) return;
    this.browser.send({ action: "pointer", tabId: handoff.tabId, kind, x: point.x, y: point.y, button: button === 2 ? "right" : "left" });
  }

  /** Moves arrive faster than a phone link wants to carry them: one per frame. */
  private move(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement;
    const at = { clientX: event.clientX, clientY: event.clientY };
    const button = event.button;
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
    this.pointer(event, "down", element, event.button);
  }

  private up(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement;
    element.releasePointerCapture?.(event.pointerId);
    this.pointer(event, "up", element, event.button);
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
    // The tab caption already says "Browser"; the strip appears once there is a tab to choose or to stop watching.
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
        ${view && !view.following ? html`<button type="button" class="btn btn--ghost btn--sm" @click=${() => this.select(null)}>Follow agent</button>` : nothing}
      </div>
    </div>` : nothing}
    <div class="hui-browser-meta">
      <span class="hui-browser-url" data-hui-tooltip=${watching?.url || nothing}>${watching?.url || "No page"}</span>
      <span role="status" class="hui-browser-status">${live ? html`<span class="hui-browser-status__dot" aria-hidden="true"></span>` : nothing}${status}</span>
    </div>
    ${handoff
      ? html`<div class="hui-browser-handoff">
          <p class="hui-browser-handoff__text"><strong>Your turn.</strong> ${handoff.message}</p>
          ${driving
            ? html`<button type="button" class="btn btn--sm hui-browser-handoff__done" @click=${() => this.browser.send({ action: "continue", tabId: handoff.tabId })}>I'm done — continue</button>`
            : html`<button type="button" class="btn btn--sm" @click=${() => this.select(handoff.tabId)}>Show tab ${handoff.tabId}</button>`}
        </div>`
      : nothing}
    <div class="hui-browser-surface">
      ${frame && size && watching
        ? html`<div class="hui-browser-frame ${driving ? "hui-browser-frame--driving" : ""}" style=${`width:${size.width}px;height:${size.height}px`}
            tabindex=${driving ? 0 : nothing}
            aria-label=${driving ? "Your turn: the agent is waiting" : nothing}
            @pointerdown=${driving ? this.down : nothing}
            @pointermove=${driving ? this.move : nothing}
            @pointerup=${driving ? this.up : nothing}
            @pointercancel=${driving ? this.up : nothing}
            @wheel=${driving ? this.wheel : nothing}
            @keydown=${driving ? this.key : nothing}
            @contextmenu=${driving ? (event: Event) => event.preventDefault() : nothing}>
            <img src=${frame.src} alt=${`Live view of ${watching.title || watching.url}`} draggable="false" />
            ${pointer ? keyed(pointer.key, html`<span class="hui-browser-pointer" aria-hidden="true" style=${`left:${pointer.left}%;top:${pointer.top}%`}></span>`) : nothing}
          </div>`
        : html`<p class="hui-browser-empty">${browserViewEmptyMessage(view, connection, this.enabled)}</p>`}
    </div>
    <div class="hui-browser-activity" aria-live="polite">
      ${action
        ? html`<span class="hui-browser-activity__text" data-hui-tooltip=${driving ? "You have control of this tab; the agent waits." : action.text}>${driving ? "You have control; the agent waits." : action.text}</span><time datetime=${action.at}>${relativeTime(action.at, Math.max(this.now, Date.parse(action.at) || 0))}</time>`
        : html`<span>View only · the agent controls this browser</span>`}
    </div>
    ${connection === "disconnected" ? html`<button type="button" class="btn btn--sm hui-browser-reconnect" @click=${() => this.browser.connect(this.ownerSessionId, "stream")}>Reconnect</button>` : nothing}`;
  }
}
