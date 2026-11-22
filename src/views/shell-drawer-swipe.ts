/**
 * Pulls the navigation drawer open from the chat on a narrow screen: a pointer
 * down in the screen's left edge makes the drawer follow the finger, and letting
 * go settles it open past a third of its width or a fling, and closed below
 * that. Thresholds live in lib/drawer-swipe.ts; the Open navigation button
 * remains the click and keyboard path. Nothing is drawn over the chat: a touch
 * that starts at the edge and moves right is kept from panning the page, so
 * taps, vertical scrolling and every control there work as they did.
 */
import {
  drawerSwipeFollows,
  drawerSwipeOpens,
  drawerSwipeProgress,
  startsAtDrawerEdge,
} from "../lib/drawer-swipe.ts";
import { APP_SHELL_DRAWER_MEDIA, setNavigationDrawer } from "./shell.ts";

/** Longest the closed drawer may stay visible waiting for its snap-back to end. */
const SETTLE_TIMEOUT_MS = 400;

let endSettle: (() => void) | undefined;

/** The edge touch a drag may start from, kept until the browser's scroll decision. */
let edgeTouch: { x: number; y: number } | undefined;

type ClosedDrawer = { nav: HTMLElement; sidebar: HTMLElement; backdrop: HTMLElement | null; width: number };

/** The drawer this screen may drag open, or nothing while the sidebar is a column or already open. */
function closedDrawer(shell: HTMLElement): ClosedDrawer | undefined {
  const nav = shell.querySelector<HTMLElement>(".shell-nav");
  const sidebar = nav?.querySelector<HTMLElement>(".sidebar");
  if (!nav || !sidebar || sidebar.dataset.open === "true" || !matchMedia(APP_SHELL_DRAWER_MEDIA).matches) {
    return undefined;
  }
  const width = nav.getBoundingClientRect().width;
  return width > 0 ? { nav, sidebar, backdrop: shell.querySelector<HTMLElement>(".shell-nav-backdrop"), width } : undefined;
}

/** Remembers a touch that starts at the screen's left edge, before the browser decides to scroll. */
export function trackDrawerEdgeTouch(event: TouchEvent): void {
  edgeTouch = undefined;
  const shell = event.currentTarget;
  const touch = event.touches[0];
  if (!(shell instanceof HTMLElement) || event.touches.length !== 1 || !touch || !startsAtDrawerEdge(touch.clientX)) {
    return;
  }
  if (closedDrawer(shell)) {
    edgeTouch = { x: touch.clientX, y: touch.clientY };
  }
}

/** Keeps a rightward edge drag for the drawer instead of letting the chat pan. */
export function holdDrawerEdgeDrag(event: TouchEvent): void {
  const start = edgeTouch;
  const touch = event.touches[0];
  edgeTouch = undefined;
  if (!start || !touch || event.touches.length !== 1) {
    return;
  }
  if (drawerSwipeFollows(touch.clientX - start.x, touch.clientY - start.y)) {
    edgeTouch = start;
    event.preventDefault();
  }
}

export function endDrawerEdgeTouch(): void {
  edgeTouch = undefined;
}

/** The shell's pointerdown handler. It does nothing while the sidebar is a column or open. */
export function startDrawerSwipe(event: PointerEvent): void {
  const shell = event.currentTarget;
  if (!(shell instanceof HTMLElement) || event.button !== 0 || !event.isPrimary || !startsAtDrawerEdge(event.clientX)) {
    return;
  }
  const drawer = closedDrawer(shell);
  if (!drawer) {
    return;
  }
  const { nav, sidebar, backdrop, width } = drawer;
  endSettle?.();

  const { pointerId } = event;
  const startX = event.clientX;
  const startY = event.clientY;
  const startedAt = event.timeStamp;
  let following = false;
  let finished = false;

  const applyStyles = (distance: number) => {
    const progress = drawerSwipeProgress(distance, width);
    nav.style.transform = `translateX(${-100 + progress * 100}%)`;
    // The drawer is opaque as soon as it moves; only the backdrop fades with
    // the finger, as it does when the drawer animates open on its own.
    nav.style.opacity = "1";
    if (backdrop) {
      backdrop.style.opacity = String(progress);
    }
  };

  const stopListening = () => {
    if (finished) {
      return;
    }
    finished = true;
    shell.removeEventListener("pointermove", move);
    shell.removeEventListener("pointerup", release);
    shell.removeEventListener("pointercancel", cancel);
    shell.removeEventListener("lostpointercapture", lostCapture);
    if (shell.hasPointerCapture(pointerId)) {
      shell.releasePointerCapture(pointerId);
    }
  };

  const settle = (open: boolean) => {
    endSettle?.();
    // The drag's own transform and opacity are handed back to the drawer's
    // open or closed state, which stays visible while the transform animates.
    shell.classList.remove("shell--drawer-dragging");
    shell.classList.add("shell--drawer-settling");
    nav.style.removeProperty("transform");
    nav.style.removeProperty("opacity");
    backdrop?.style.removeProperty("opacity");
    if (open) {
      setNavigationDrawer(sidebar, true, false);
    }
    const settled = () => {
      window.clearTimeout(timer);
      nav.removeEventListener("transitionend", onTransitionEnd);
      shell.classList.remove("shell--drawer-settling");
      if (endSettle === settled) {
        endSettle = undefined;
      }
    };
    const onTransitionEnd = (end: TransitionEvent) => {
      if (end.propertyName === "transform") {
        settled();
      }
    };
    const timer = window.setTimeout(settled, SETTLE_TIMEOUT_MS);
    endSettle = settled;
    nav.addEventListener("transitionend", onTransitionEnd);
  };

  const finish = (open: boolean) => {
    stopListening();
    if (following) {
      settle(open);
      return;
    }
    shell.classList.remove("shell--drawer-dragging");
  };

  const cancel = () => finish(false);

  // Capture moving between the touched element and the shell fires this on the
  // element, which bubbles; only losing the shell's own capture ends the gesture.
  const lostCapture = (lost: PointerEvent) => {
    if (lost.target === shell) {
      cancel();
    }
  };

  const release = (up: PointerEvent) => {
    if (up.pointerId !== pointerId) {
      return;
    }
    const elapsed = Math.max(1, up.timeStamp - startedAt);
    finish(drawerSwipeOpens(up.clientX - startX, width, (up.clientX - startX) / elapsed));
  };

  const move = (movement: PointerEvent) => {
    if (movement.pointerId !== pointerId) {
      return;
    }
    const dx = movement.clientX - startX;
    const dy = movement.clientY - startY;
    if (!following) {
      if (dx < 0 || Math.abs(dx) < Math.abs(dy)) {
        // A leftwards or mostly vertical drag belongs to the chat.
        if (Math.abs(dy) > 8 || dx < -8) {
          stopListening();
        }
        return;
      }
      if (!drawerSwipeFollows(dx, dy)) {
        return;
      }
      following = true;
      shell.classList.add("shell--drawer-dragging");
      shell.setPointerCapture(pointerId);
    }
    movement.preventDefault();
    applyStyles(dx);
  };

  shell.addEventListener("pointermove", move);
  shell.addEventListener("pointerup", release);
  shell.addEventListener("pointercancel", cancel);
  shell.addEventListener("lostpointercapture", lostCapture);
}
