import type { PaneRect, SessionLayout } from "./session-multiplexer.ts";

export const PANE_DIVIDER_SIZE = 6;
export type PaneDivider = PaneRect & { id: string; columnId?: string; index: number; ratio: number; extent: number };

/** Flex-like allocation, honoring the original 320px columns / 200px rows.
 * Overflow scrolls when the viewport cannot contain the minimum sizes. */
export function paneTrackSizes(size: number, weights: readonly number[], minimum: number): number[] {
  let remaining = Math.max(minimum * weights.length, size - PANE_DIVIDER_SIZE * (weights.length - 1));
  const result = weights.map(() => 0);
  const pending = new Set(weights.map((_, index) => index));
  while (pending.size) {
    const total = [...pending].reduce((sum, i) => sum + weights[i]!, 0);
    const constrained = [...pending].filter((i) => remaining * weights[i]! / total < minimum);
    if (!constrained.length) {
      for (const i of pending) result[i] = remaining * weights[i]! / total;
      break;
    }
    for (const i of constrained) { result[i] = minimum; remaining -= minimum; pending.delete(i); }
  }
  return result;
}

/** Keep pane DOM in a stable, flat host. Only these rectangles change when a
 * pane moves, so no custom-element disconnect, stream restart or PTY teardown
 * is necessary, including between columns and with duplicate sessions. */
export function sessionPaneGeometry(layout: SessionLayout, width: number, height: number) {
  const panes = new Map<string, PaneRect>();
  const dividers: PaneDivider[] = [];
  const widths = paneTrackSizes(width, layout.columnWeights, Math.min(320, width));
  let left = 0;
  let canvasHeight = height;
  for (const [columnIndex, column] of layout.columns.entries()) {
    const columnWidth = widths[columnIndex]!;
    const heights = paneTrackSizes(height, column.paneWeights, 200);
    let top = 0;
    for (const [paneIndex, pane] of column.panes.entries()) {
      const paneHeight = heights[paneIndex]!;
      panes.set(pane.id, { left, top, width: columnWidth, height: paneHeight });
      top += paneHeight;
      if (paneIndex < column.panes.length - 1) {
        dividers.push({ id: `${column.id}:${paneIndex}`, columnId: column.id, index: paneIndex,
          ratio: column.paneWeights[paneIndex]! / (column.paneWeights[paneIndex]! + column.paneWeights[paneIndex + 1]!),
          extent: paneHeight + heights[paneIndex + 1]!, left, top, width: columnWidth, height: PANE_DIVIDER_SIZE });
        top += PANE_DIVIDER_SIZE;
      }
    }
    canvasHeight = Math.max(canvasHeight, top);
    left += columnWidth;
    if (columnIndex < layout.columns.length - 1) {
      dividers.push({ id: `columns:${columnIndex}`, index: columnIndex,
        ratio: layout.columnWeights[columnIndex]! / (layout.columnWeights[columnIndex]! + layout.columnWeights[columnIndex + 1]!),
        extent: columnWidth + widths[columnIndex + 1]!, left, top: 0, width: PANE_DIVIDER_SIZE, height });
      left += PANE_DIVIDER_SIZE;
    }
  }
  for (const divider of dividers) if (!divider.columnId) divider.height = canvasHeight;
  return { panes, dividers, width: left, height: canvasHeight };
}
