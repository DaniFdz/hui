/**
 * Delegated hover/focus preview cards for small marks in session rows (pull
 * requests, Jira work items). One controller serves every anchor matching its
 * selector. The anchor stays a plain link; the card opens on hover or keyboard
 * focus, portaled into the top layer so the sidebar cannot clip it. The pointer
 * may travel onto the card to scroll a long description: a transparent bridge
 * covers the gap and a short grace delay covers diagonal paths. Touch pointers
 * keep the native tap-to-open behavior only.
 */
import { nothing, render, type TemplateResult } from "lit";
import { promoteToPopoverTopLayer } from "./openclaw/menu-surface.ts";
import { hovercardPlacement } from "../lib/hovercard-placement.ts";

/** Closes the session hovercard; the provider already listens for it. */
const SESSION_HOVERCARD_DISMISS_EVENT = "openclaw-session-menu-open";
const OPEN_DELAY_MS = 250;
const SWEEP_DELAY_MS = 60;
const CLOSE_DELAY_MS = 120;
/** Leaving the badge: time to reach the card before it closes. */
const POINTER_EXIT_GRACE_MS = 280;

export type BadgeHovercardOptions<Data> = {
  /** Anchor selector, for example `a.session-pr-badge`. */
  selector: string;
  /** Card classes; the first one is also the id prefix. */
  cardClass: string;
  /** Data attached to the anchor as a property. */
  data: (anchor: HTMLElement) => Data | undefined;
  render: (data: Data) => TemplateResult;
  /** Optional `data-state` for the card. */
  state?: (data: Data) => string;
  /** Container whose gaps between marks must not open the row's session card. */
  gapSelector?: string;
};

function badgeFromEvent(event: Event, selector: string): HTMLElement | null {
  if (event instanceof PointerEvent && event.pointerType === "touch") return null;
  for (const candidate of event.composedPath()) {
    if (candidate instanceof HTMLElement && candidate.matches(selector)) {
      return candidate;
    }
  }
  return null;
}

export class BadgeHovercardController<Data> {
  readonly #options: BadgeHovercardOptions<Data>;
  constructor(options: BadgeHovercardOptions<Data>) {
    this.#options = options;
  }

  #card: HTMLDivElement | null = null;
  #badge: HTMLElement | null = null;
  #openTimer: number | null = null;
  #closeTimer: number | null = null;
  #recentlyOpen = false;
  #pointerOverBadge = false;
  #pointerOverCard = false;

  install(root: Document) {
    root.addEventListener("pointerover", this.#pointerOver, true);
    root.addEventListener("pointerout", this.#pointerOut, true);
    root.addEventListener("focusin", this.#focusIn, true);
    root.addEventListener("focusout", this.#focusOut, true);
    root.addEventListener("keydown", this.#keyDown, true);
    root.addEventListener("click", this.#click, true);
    window.addEventListener("scroll", this.#reposition, true);
    window.addEventListener("resize", this.#reposition);
  }

  readonly #pointerOver = (event: PointerEvent) => {
    const badge = badgeFromEvent(event, this.#options.selector);
    if (!badge) {
      const gapSelector = this.#options.gapSelector;
      if (!gapSelector) return;
      // Gaps between marks belong to the strip, not the row's session card.
      const strip = event.composedPath().find((node): node is HTMLElement =>
        node instanceof HTMLElement && node.matches(gapSelector));
      if (strip) {
        event.stopPropagation();
        strip.dispatchEvent(new Event(SESSION_HOVERCARD_DISMISS_EVENT, { bubbles: true }));
      }
      return;
    }
    // The badge sits inside a session row; its own card replaces the row's.
    event.stopPropagation();
    badge.dispatchEvent(new Event(SESSION_HOVERCARD_DISMISS_EVENT, { bubbles: true }));
    // Gate on the pointer that arrived, not on `(hover: hover)`: hybrid and
    // remote-desktop setups report no hover capability yet deliver mouse input.
    this.#schedule(badge, this.#recentlyOpen ? SWEEP_DELAY_MS : OPEN_DELAY_MS);
    this.#pointerOverBadge = true;
  };

  readonly #pointerOut = (event: PointerEvent) => {
    const badge = badgeFromEvent(event, this.#options.selector);
    if (!badge || badge !== this.#badge) return;
    if (event.relatedTarget instanceof Node && badge.contains(event.relatedTarget)) return;
    this.#pointerOverBadge = false;
    this.#scheduleClose(POINTER_EXIT_GRACE_MS);
  };

  readonly #cardPointerEnter = () => {
    this.#pointerOverCard = true;
    this.#clearClose();
  };

  readonly #cardPointerLeave = () => {
    this.#pointerOverCard = false;
    this.#scheduleClose();
  };

  readonly #focusIn = (event: FocusEvent) => {
    const badge = badgeFromEvent(event, this.#options.selector);
    if (badge && badge.matches(":focus-visible")) this.#schedule(badge, 0);
  };

  readonly #focusOut = (event: FocusEvent) => {
    if (badgeFromEvent(event, this.#options.selector) === this.#badge) this.#scheduleClose();
  };

  readonly #keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.#card) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  readonly #click = (event: Event) => {
    if (badgeFromEvent(event, this.#options.selector)) this.close();
  };

  readonly #reposition = (event: Event) => {
    // Scrolling the card's own description must not re-measure the card.
    if (event.target instanceof Node && this.#card?.contains(event.target)) return;
    if (!this.#badge?.isConnected) {
      this.close();
      return;
    }
    this.#position();
  };

  #schedule(badge: HTMLElement, delay: number) {
    this.#clearClose();
    if (badge === this.#badge && (this.#card || this.#openTimer !== null)) return;
    this.close(false);
    this.#badge = badge;
    this.#openTimer = window.setTimeout(() => {
      this.#openTimer = null;
      this.#show();
    }, delay);
  }

  /** Held while the pointer is on the badge or the card, or keyboard focus
   * rests on the badge. */
  #held(): boolean {
    const badge = this.#badge;
    return this.#pointerOverBadge || this.#pointerOverCard
      || (badge !== null && document.activeElement === badge && badge.matches(":focus-visible"));
  }

  #scheduleClose(delay = CLOSE_DELAY_MS) {
    this.#clearClose();
    if (this.#held()) return;
    this.#closeTimer = window.setTimeout(() => {
      this.#closeTimer = null;
      if (!this.#held()) this.close();
    }, delay);
  }

  #clearClose() {
    if (this.#closeTimer !== null) window.clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  }

  #show() {
    const badge = this.#badge;
    const data = badge ? this.#options.data(badge) : undefined;
    if (!badge?.isConnected || data === undefined) {
      this.close();
      return;
    }
    const card = document.createElement("div");
    card.className = this.#options.cardClass;
    card.id = `${this.#options.cardClass.split(" ")[0]}-${Math.random().toString(36).slice(2)}`;
    card.setAttribute("role", "tooltip");
    const state = this.#options.state?.(data);
    if (state) card.dataset.state = state;
    render(this.#options.render(data), card);
    // The badge already opens its target; keep description links
    // pointer-only so keyboard traversal does not wander into the card.
    for (const link of card.querySelectorAll<HTMLElement>("a[href]")) link.tabIndex = -1;
    card.addEventListener("pointerenter", this.#cardPointerEnter);
    card.addEventListener("pointerleave", this.#cardPointerLeave);
    // A modal navigation drawer makes body siblings inert; stay inside it.
    (badge.closest("openclaw-modal-dialog") ?? document.body).append(card);
    promoteToPopoverTopLayer(card);
    badge.setAttribute("aria-describedby", card.id);
    this.#card = card;
    this.#recentlyOpen = true;
    this.#position();
  }

  #position() {
    const badge = this.#badge;
    const card = this.#card;
    if (!badge || !card) return;
    card.style.maxHeight = "";
    const placement = hovercardPlacement(
      badge.getBoundingClientRect(),
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: innerWidth, height: innerHeight },
    );
    card.dataset.side = placement.side;
    card.style.left = `${placement.left}px`;
    card.style.top = `${placement.top}px`;
    if (placement.maxHeight !== undefined) card.style.maxHeight = `${placement.maxHeight}px`;
  }

  close(resetSweep = true) {
    if (this.#openTimer !== null) window.clearTimeout(this.#openTimer);
    this.#openTimer = null;
    this.#clearClose();
    this.#pointerOverBadge = false;
    this.#pointerOverCard = false;
    this.#badge?.removeAttribute("aria-describedby");
    this.#badge = null;
    if (this.#card) {
      render(nothing, this.#card);
      this.#card.remove();
      this.#card = null;
      if (resetSweep) window.setTimeout(() => { if (!this.#card) this.#recentlyOpen = false; }, 300);
    }
  }
}
