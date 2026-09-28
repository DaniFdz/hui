/** Geometry for a hovercard that opens from a small trigger such as a sidebar
 * badge. The card hangs directly below the trigger (or above it when there is
 * more room there), aligned so the pointer can travel straight onto it. */
export type Box = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type HovercardPlacement = {
  left: number;
  top: number;
  side: "bottom" | "top";
  /** Set only when the card does not fit; the card then scrolls internally. */
  maxHeight?: number;
};

export const HOVERCARD_GAP = 6;
export const HOVERCARD_VIEWPORT_PADDING = 12;
/** Pulls the card left so its leading icon sits under the trigger's icon. */
export const HOVERCARD_INSET = 12;

export function hovercardPlacement(anchor: Box, card: Size, viewport: Size): HovercardPlacement {
  const below = viewport.height - anchor.bottom - HOVERCARD_GAP - HOVERCARD_VIEWPORT_PADDING;
  const above = anchor.top - HOVERCARD_GAP - HOVERCARD_VIEWPORT_PADDING;
  const side = card.height <= below ? "bottom" : card.height <= above ? "top" : below >= above ? "bottom" : "top";
  const space = Math.max(0, side === "bottom" ? below : above);
  const height = Math.min(card.height, space);
  const maxLeft = Math.max(HOVERCARD_VIEWPORT_PADDING, viewport.width - card.width - HOVERCARD_VIEWPORT_PADDING);
  return {
    left: Math.min(Math.max(HOVERCARD_VIEWPORT_PADDING, anchor.left - HOVERCARD_INSET), maxLeft),
    top: side === "bottom" ? anchor.bottom + HOVERCARD_GAP : anchor.top - HOVERCARD_GAP - height,
    side,
    ...(card.height > space ? { maxHeight: space } : {}),
  };
}
