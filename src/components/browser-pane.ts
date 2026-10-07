/**
 * The browser panel beside a chat, for one session's agent browser. Streaming, tabs and pointer marks come from the
 * shared browser view controller; this element fits the frame to the pane and stops streaming while the pane is
 * hidden. It only watches: the agent drives the browser, the operator can only choose which tab to see.
 */
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { HuiElement } from "../lit/hui-element.ts";
import { icons } from "../lib/icons.ts";
import { connectBrowserView } from "../lib/browser-store.ts";
import { BrowserViewController } from "../lib/browser-view-controller.ts";
import { browserTabOptions, browserViewEmptyMessage, browserViewStatus, fitFrame, relativeTime, type Size } from "../lib/browser-view.ts";
import { toggleNavigationDrawer } from "../views/shell.ts";
import { renderPaneMoveHandle } from "../views/pane-move-handle.ts";
import { renderPicker } from "../views/settings-picker.ts";

/** The larger live view beside the chat: follows the agent's current tab
 * unless the operator picks another, and marks where the agent clicks. */
@customElement("hui-browser-pane")
export class BrowserPane extends HuiElement {
  @property() ownerSessionId = "";
  @property({ type: Boolean }) visible = true;
  @property({ type: Boolean }) active = true;
  @property({ type: Boolean }) mobileNav = false;
  @property({ type: Boolean }) movable = false;
  @property({ type: Boolean }) enabled = true;
  @property({ attribute: false }) onClosePane: (() => void) | undefined;
  @state() private box: Size | undefined;
  @state() private now = Date.now();
  private readonly browser = new BrowserViewController(this, connectBrowserView);
  private clock: ReturnType<typeof setInterval> | undefined;
  private resizeObserver: ResizeObserver | undefined;

  override connectedCallback() {
    super.connectedCallback();
    this.clock = setInterval(() => { if (this.visible) this.now = Date.now(); }, 5_000);
  }

  protected override willUpdate(changed: PropertyValues) {
    // Hidden panes (the inactive panel on a narrow screen) stop streaming.
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    super.disconnectedCallback();
  }

  private select(tabId: string | null) {
    this.browser.select(tabId);
  }

  override render() {
    const { view, action, pointer, connection } = this.browser;
    // Only the watched tab's frame; another tab's would sit under the wrong title.
    const frame = this.browser.frame?.tabId === view?.watching ? this.browser.frame : undefined;
    const watching = view?.tabs.find((tab) => tab.id === view.watching);
    const size = frame && this.box ? fitFrame(this.box, frame) : undefined;
    const status = browserViewStatus(view, connection);
    const live = connection === "live" && Boolean(view?.running && view.watching);
    return html`<header class="chat-pane__header hui-browser-header" tabindex="-1" draggable=${this.movable ? "true" : "false"}>
      <div class="hui-browser-title">
        ${renderPaneMoveHandle(this.movable)}
        ${this.mobileNav ? html`<button class="btn btn--ghost btn--icon" aria-label="Open navigation" @click=${toggleNavigationDrawer}>${icons.menu}</button>` : nothing}
        <span aria-hidden="true">${icons.globe}</span>
        ${view && view.tabs.length > 0 && view.watching
          ? renderPicker({
              label: "Browser tab",
              value: view.watching,
              options: browserTabOptions(view),
              className: "hui-browser-picker",
              showOptionTooltips: false,
              onChange: (id) => this.select(id === view.current ? null : id),
            })
          : html`<span class="hui-browser-heading">Browser</span>`}
      </div>
      <div class="hui-browser-actions">
        ${view && !view.following ? html`<button type="button" class="btn btn--ghost btn--sm" @click=${() => this.select(null)}>Follow agent</button>` : nothing}
        ${this.onClosePane ? html`<button type="button" class="btn btn--ghost btn--icon" title="Hide browser view" aria-label="Hide browser view" @click=${this.onClosePane}>${icons.close}</button>` : nothing}
      </div>
    </header>
    <div class="hui-browser-meta">
      <span class="hui-browser-url" title=${watching?.url ?? ""}>${watching?.url || "No page"}</span>
      <span role="status" class="hui-browser-status">${live ? html`<span class="hui-browser-status__dot" aria-hidden="true"></span>` : nothing}${status}</span>
    </div>
    <div class="hui-browser-surface">
      ${frame && size && watching
        ? html`<div class="hui-browser-frame" style=${`width:${size.width}px;height:${size.height}px`}>
            <img src=${frame.src} alt=${`Live view of ${watching.title || watching.url}`} draggable="false" />
            ${pointer ? keyed(pointer.key, html`<span class="hui-browser-pointer" aria-hidden="true" style=${`left:${pointer.left}%;top:${pointer.top}%`}></span>`) : nothing}
          </div>`
        : html`<p class="hui-browser-empty">${browserViewEmptyMessage(view, connection, this.enabled)}</p>`}
    </div>
    <div class="hui-browser-activity" aria-live="polite">
      ${action
        ? html`<span class="hui-browser-activity__text" title=${action.text}>${action.text}</span><time datetime=${action.at}>${relativeTime(action.at, Math.max(this.now, Date.parse(action.at) || 0))}</time>`
        : html`<span>View only · the agent controls this browser</span>`}
    </div>
    ${connection === "disconnected" ? html`<button type="button" class="btn btn--sm hui-browser-reconnect" @click=${() => this.browser.connect(this.ownerSessionId, "stream")}>Reconnect</button>` : nothing}`;
  }
}
