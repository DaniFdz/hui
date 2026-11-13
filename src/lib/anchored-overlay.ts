// Ported from OpenClaw v2026.9.5 components/anchored-overlay.ts (MIT).
import WaPopup from "@awesome.me/webawesome/dist/components/popup/popup.js";

type AnchoredOverlaySide = "top" | "bottom";
type AnchoredOverlayOptions = {
  alignment?: "start" | "end";
  anchor?: Element;
};

const VIEWPORT_MARGIN = 8;
const VIEWPORT_SIDE_MARGIN = 12;

export function syncAnchoredOverlay(
  details: HTMLDetailsElement,
  preferredSide: AnchoredOverlaySide,
  options: AnchoredOverlayOptions = {},
): void {
  const anchor = details.querySelector<HTMLElement>(":scope > summary");
  const popup = details.querySelector<WaPopup>(":scope > wa-popup[data-anchored-overlay]");
  if (!anchor || !popup) {
    return;
  }
  configureAnchoredPopup(popup, options.anchor ?? anchor, preferredSide, options.alignment);
  popup.active = details.open;
}

/** Keep a picker's reference inside the visible viewport when the real trigger moves below an IME.
 * Web Awesome shifts top/bottom popups horizontally only; an offscreen reference otherwise leaves the menu clipped. */
export function pickerAnchorInViewport(
  rect: Pick<DOMRect, "x" | "y" | "width" | "height">,
  viewport: { offsetTop: number; height: number },
): DOMRect {
  const minimum = viewport.offsetTop + VIEWPORT_MARGIN;
  const maximum = Math.max(minimum, viewport.offsetTop + viewport.height - VIEWPORT_MARGIN);
  const top = Math.max(minimum, Math.min(rect.y, maximum));
  const bottom = Math.max(top, Math.min(rect.y + rect.height, maximum));
  return { x: rect.x, y: top, width: rect.width, height: bottom - top,
    top, bottom, left: rect.x, right: rect.x + rect.width,
    toJSON: () => ({ x: rect.x, y: top, width: rect.width, height: bottom - top }) };
}

/** Preserve a real anchor's position-only movement for an open picker using a virtual reference.
 * Idle frames read one rect and do no popup work; the caller cancels on close and disconnect. */
export function observePickerAnchor(trigger: Element, reposition: () => void): () => void {
  let previous = trigger.getBoundingClientRect();
  let active = true;
  let frame = 0;
  const stop = () => { active = false; window.cancelAnimationFrame(frame); frame = 0; };
  const update = () => {
    frame = 0;
    if (!active) return;
    if (!trigger.isConnected) { stop(); return; }
    const rect = trigger.getBoundingClientRect();
    if (rect.x !== previous.x || rect.y !== previous.y || rect.width !== previous.width || rect.height !== previous.height) {
      previous = rect;
      reposition();
    }
    if (active) frame = window.requestAnimationFrame(update);
  };
  frame = window.requestAnimationFrame(update);
  return stop;
}

/** Shared popup geometry; the caller owns opening, focus, and dismissal. */
export function configureAnchoredPopup(
  popup: WaPopup,
  anchor: Element | { getBoundingClientRect(): DOMRect },
  preferredSide: AnchoredOverlaySide,
  alignment: "start" | "end" = "start",
): void {
  popup.anchor = anchor;
  popup.placement = `${preferredSide}-${alignment}`;
  popup.boundary = "viewport";
  popup.distance = 6;
  popup.flip = true;
  popup.flipPadding = VIEWPORT_MARGIN;
  popup.shift = true;
  popup.shiftPadding = VIEWPORT_SIDE_MARGIN;
  popup.autoSize = "vertical";
  popup.autoSizePadding = VIEWPORT_MARGIN;
}
