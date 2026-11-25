/**
 * Geometry for opening the navigation drawer by dragging from a narrow screen's
 * left edge: where a drag may start, when it counts as a horizontal one, how far
 * the drawer follows the finger and when letting go opens it. The DOM wiring is
 * views/shell-drawer-swipe.ts; the Open navigation button stays the click and
 * keyboard path.
 */

/** How far from the screen's left edge a drag may start, in CSS px. */
export const DRAWER_SWIPE_EDGE_PX = 20;

/** Horizontal travel, in CSS px, before the drawer starts to follow the finger. */
export const DRAWER_SWIPE_INTENT_PX = 10;

/** How much of the drawer's width a drag must reveal for letting go to open it. */
export const DRAWER_SWIPE_OPEN_RATIO = 0.35;

/** A quick fling, in CSS px per ms, opens the drawer past a short drag. */
export const DRAWER_SWIPE_FLING_PX_PER_MS = 0.45;

/** The shortest drag a fling may open the drawer from. */
export const DRAWER_SWIPE_FLING_MIN_PX = 24;

export function startsAtDrawerEdge(clientX: number): boolean {
  return clientX >= 0 && clientX <= DRAWER_SWIPE_EDGE_PX;
}

/** A drag that has committed to moving the drawer rightwards, not to scrolling the chat. */
export function drawerSwipeFollows(dx: number, dy: number): boolean {
  return dx >= DRAWER_SWIPE_INTENT_PX && dx > Math.abs(dy) * 1.5;
}

/** What share of the drawer the finger uncovers, bounded to the closed and open ends. */
export function drawerSwipeProgress(distance: number, width: number): number {
  if (!(width > 0)) {
    return 0;
  }
  return Math.min(1, Math.max(0, distance / width));
}

/** Whether letting go at this distance and speed opens the drawer instead of closing it again. */
export function drawerSwipeOpens(distance: number, width: number, velocity: number): boolean {
  if (!(width > 0) || distance <= 0) {
    return false;
  }
  return drawerSwipeProgress(distance, width) >= DRAWER_SWIPE_OPEN_RATIO
    || (distance >= DRAWER_SWIPE_FLING_MIN_PX && velocity >= DRAWER_SWIPE_FLING_PX_PER_MS);
}
