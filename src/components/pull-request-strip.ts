/**
 * `<hui-pull-request-strip>`: the horizontally scrollable pull request marks of
 * one session row. Its children are rendered by the shell (light DOM); this
 * element only tracks overflow for the edge fades, turns a vertical mouse wheel
 * into horizontal scrolling, and returns to the newest mark once the pointer
 * and keyboard focus have left. Touch keeps native swipe scrolling.
 */
import { stripOverflow, stripWheelScroll } from "../lib/pull-request-strip.ts";

const LINE_HEIGHT_PX = 16;

export class PullRequestStrip extends HTMLElement {
  readonly #resize = new ResizeObserver(() => this.#sync());
  readonly #mutations = new MutationObserver(() => this.#sync());

  connectedCallback() {
    this.addEventListener("scroll", this.#sync, { passive: true });
    // The width animates on hover; re-measure once it settles.
    this.addEventListener("transitionend", this.#sync);
    this.addEventListener("wheel", this.#wheel, { passive: false });
    this.addEventListener("pointerleave", this.#pointerLeave);
    this.addEventListener("focusout", this.#focusOut);
    this.#resize.observe(this);
    this.#mutations.observe(this, { childList: true });
    this.#sync();
  }

  disconnectedCallback() {
    this.removeEventListener("scroll", this.#sync);
    this.removeEventListener("transitionend", this.#sync);
    this.removeEventListener("wheel", this.#wheel);
    this.removeEventListener("pointerleave", this.#pointerLeave);
    this.removeEventListener("focusout", this.#focusOut);
    this.#resize.disconnect();
    this.#mutations.disconnect();
  }

  readonly #sync = () => {
    const { before, after } = stripOverflow(this.scrollLeft, this.scrollWidth, this.clientWidth);
    this.toggleAttribute("data-more-before", before);
    this.toggleAttribute("data-more-after", after);
  };

  readonly #wheel = (event: WheelEvent) => {
    // Trackpad horizontal gestures and pinch-zoom keep their native behavior.
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_HEIGHT_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.clientWidth : 1;
    const next = stripWheelScroll(this.scrollLeft, this.scrollWidth, this.clientWidth, event.deltaY * scale);
    if (next === undefined) return;
    event.preventDefault();
    this.scrollLeft = next;
    // Scroll events wait for a rendering frame; update the fades now so they
    // never lag behind the wheel (or stay stale in a throttled background tab).
    this.#sync();
  };

  /** Instant, not smooth: the pointer has already left, and a smooth scroll
   * depends on animation frames that background tabs never get. */
  readonly #rest = () => {
    this.scrollLeft = 0;
    this.#sync();
  };

  readonly #pointerLeave = () => {
    if (!this.matches(":focus-within")) this.#rest();
  };

  readonly #focusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && this.contains(event.relatedTarget)) return;
    if (!this.matches(":hover")) this.#rest();
  };
}

if (!customElements.get("hui-pull-request-strip")) {
  customElements.define("hui-pull-request-strip", PullRequestStrip);
}
