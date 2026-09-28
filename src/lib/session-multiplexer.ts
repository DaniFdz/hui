/** Port of OpenClaw 2026.9.5's chat split layout (MIT, ec9c1a13).
 * Columns contain vertical stacks, not a recursive binary docking tree. */
export type SplitDirection = "left" | "right" | "up" | "down";
/** A pane shows its session's chat, one of its shared terminals, or (with
 * `browser`) the live view of its managed-browser tabs. */
export type SessionPane = { id: string; sessionId: string; terminalId?: string; browser?: true };
export type SessionColumn = { id: string; panes: SessionPane[]; paneWeights: number[] };
export type SessionLayout = { columns: SessionColumn[]; columnWeights: number[]; activePaneId: string };
export type DropZone = { kind: "center" } | { kind: "edge"; edge: SplitDirection };
export type PaneRect = { left: number; top: number; width: number; height: number };

export const SESSION_SPLIT_MEDIA = "(max-width: 1099px)";
export const SESSION_LAYOUT_KEY = "hui.chat-split-layout.v1";

export function singleSessionLayout(sessionId: string): SessionLayout {
  return { columns: [{ id: "c1", panes: [{ id: "p1", sessionId }], paneWeights: [1] }], columnWeights: [1], activePaneId: "p1" };
}

export function sessionPanes(layout: SessionLayout): SessionPane[] {
  return layout.columns.flatMap((column) => column.panes);
}

export function isChatPane(pane: SessionPane): boolean {
  return !pane.terminalId && !pane.browser;
}

export function locateSessionPane(layout: SessionLayout, id: string) {
  for (const [columnIndex, column] of layout.columns.entries()) {
    const paneIndex = column.panes.findIndex((pane) => pane.id === id);
    const pane = column.panes[paneIndex];
    if (pane) return { column, columnIndex, pane, paneIndex };
  }
  return undefined;
}

export function activeSessionPane(layout: SessionLayout): SessionPane {
  return locateSessionPane(layout, layout.activePaneId)?.pane ?? layout.columns[0]!.panes[0]!;
}

function copyLayout(layout: SessionLayout): SessionLayout {
  return { ...layout, columnWeights: [...layout.columnWeights], columns: layout.columns.map((column) => ({ ...column, paneWeights: [...column.paneWeights], panes: column.panes.map((pane) => ({ ...pane })) })) };
}

function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function nextId(ids: string[], prefix: string): string {
  return `${prefix}${Math.max(0, ...ids.map((id) => Number(id.slice(1)) || 0)) + 1}`;
}

export function splitSessionPane(layout: SessionLayout, paneId: string, sessionId: string, direction: SplitDirection): SessionLayout {
  const source = locateSessionPane(layout, paneId);
  if (!source) return layout;
  const next = copyLayout(layout);
  const pane: SessionPane = { id: nextId(sessionPanes(layout).map(({ id }) => id), "p"), sessionId };
  if (direction === "left" || direction === "right") {
    const index = source.columnIndex + Number(direction === "right");
    const weight = next.columnWeights[source.columnIndex]!;
    next.columns.splice(index, 0, { id: nextId(layout.columns.map(({ id }) => id), "c"), panes: [pane], paneWeights: [1] });
    next.columnWeights.splice(source.columnIndex, 1, weight / 2, weight / 2);
  } else {
    const column = next.columns[source.columnIndex]!;
    const index = source.paneIndex + Number(direction === "down");
    const weight = column.paneWeights[source.paneIndex]!;
    column.panes.splice(index, 0, pane);
    column.paneWeights.splice(source.paneIndex, 1, weight / 2, weight / 2);
  }
  next.activePaneId = pane.id;
  return next;
}

/** Closing a view never deletes or aborts its session. Keep the surviving pane
 * identities even when a split collapses back to one pane. */
export function closeSessionPane(layout: SessionLayout, paneId: string): SessionLayout {
  const source = locateSessionPane(layout, paneId);
  if (!source || sessionPanes(layout).length < 2) return layout;
  const next = copyLayout(layout);
  if (next.activePaneId === paneId) {
    next.activePaneId = source.column.panes[source.paneIndex - 1]?.id
      ?? layout.columns[source.columnIndex - 1]?.panes.at(-1)?.id
      ?? sessionPanes(layout).find(({ id }) => id !== paneId)!.id;
  }
  const column = next.columns[source.columnIndex]!;
  column.panes.splice(source.paneIndex, 1);
  column.paneWeights.splice(source.paneIndex, 1);
  if (!column.panes.length) {
    next.columns.splice(source.columnIndex, 1);
    next.columnWeights.splice(source.columnIndex, 1);
  } else column.paneWeights = normalizeWeights(column.paneWeights);
  next.columnWeights = normalizeWeights(next.columnWeights);
  return next;
}

export function focusSessionPane(layout: SessionLayout, paneId: string): SessionLayout {
  return paneId === layout.activePaneId || !locateSessionPane(layout, paneId) ? layout : { ...layout, activePaneId: paneId };
}

/** Move the view, not its session. Center swaps both views; edges relocate the
 * source without duplicating it or losing terminal ownership. */
export function moveSessionPane(layout: SessionLayout, sourceId: string, targetId: string, zone: DropZone): SessionLayout {
  const source = locateSessionPane(layout, sourceId);
  const target = locateSessionPane(layout, targetId);
  if (!source || !target || sourceId === targetId) return layout;
  if (zone.kind === "center") {
    const next = copyLayout(layout);
    next.columns[source.columnIndex]!.panes[source.paneIndex] = { ...target.pane };
    next.columns[target.columnIndex]!.panes[target.paneIndex] = { ...source.pane };
    next.activePaneId = sourceId;
    return next;
  }
  const next = closeSessionPane(layout, sourceId);
  const destination = locateSessionPane(next, targetId)!;
  const pane = { ...source.pane };
  if (zone.edge === "left" || zone.edge === "right") {
    const index = destination.columnIndex + Number(zone.edge === "right");
    const weight = next.columnWeights[destination.columnIndex]!;
    next.columns.splice(index, 0, {
      id: nextId(layout.columns.map(({ id }) => id), "c"), panes: [pane], paneWeights: [1],
    });
    next.columnWeights.splice(destination.columnIndex, 1, weight / 2, weight / 2);
  } else {
    const column = destination.column;
    const index = destination.paneIndex + Number(zone.edge === "down");
    const weight = column.paneWeights[destination.paneIndex]!;
    column.panes.splice(index, 0, pane);
    column.paneWeights.splice(destination.paneIndex, 1, weight / 2, weight / 2);
  }
  next.activePaneId = sourceId;
  return next;
}

/** Arrow-key equivalent of moving a header to a neighboring pane's edge. */
export function sessionPaneMoveTarget(layout: SessionLayout, paneId: string, direction: SplitDirection): string | undefined {
  const source = locateSessionPane(layout, paneId);
  if (!source) return;
  const { column, columnIndex, paneIndex } = source;
  if (direction === "left") return layout.columns[columnIndex - 1]?.panes[0]?.id ?? column.panes[paneIndex - 1]?.id ?? column.panes[paneIndex + 1]?.id;
  if (direction === "right") return layout.columns[columnIndex + 1]?.panes[0]?.id ?? column.panes[paneIndex + 1]?.id ?? column.panes[paneIndex - 1]?.id;
  if (direction === "up") return column.panes[paneIndex - 1]?.id ?? layout.columns[columnIndex - 1]?.panes.at(-1)?.id;
  return column.panes[paneIndex + 1]?.id ?? layout.columns[columnIndex + 1]?.panes[0]?.id;
}

export function replacePaneSession(layout: SessionLayout, paneId: string, sessionId: string): SessionLayout {
  const next = copyLayout(layout);
  const pane = locateSessionPane(next, paneId)?.pane;
  if (pane) { pane.sessionId = sessionId; delete pane.terminalId; delete pane.browser; }
  return next;
}

export function replacePaneTerminal(layout: SessionLayout, paneId: string, terminalId: string): SessionLayout {
  const next = copyLayout(layout);
  const pane = locateSessionPane(next, paneId)?.pane;
  if (pane) pane.terminalId = terminalId;
  return next;
}

export function splitTerminalPane(layout: SessionLayout, paneId: string, ownerSessionId: string, terminalId: string, direction: SplitDirection): SessionLayout {
  const next = splitSessionPane(layout, paneId, ownerSessionId, direction);
  return next === layout ? layout : replacePaneTerminal(next, next.activePaneId, terminalId);
}

/** A session has at most one browser view; it follows the agent across tabs. */
export function splitBrowserPane(layout: SessionLayout, paneId: string, ownerSessionId: string, direction: SplitDirection): SessionLayout {
  const next = splitSessionPane(layout, paneId, ownerSessionId, direction);
  if (next === layout) return layout;
  const pane = locateSessionPane(next, next.activePaneId)?.pane;
  if (pane) pane.browser = true;
  return next;
}

export function browserPaneFor(layout: SessionLayout, sessionId: string): SessionPane | undefined {
  return sessionPanes(layout).find((pane) => pane.browser && pane.sessionId === sessionId);
}

export function resizeSessionWeights(weights: readonly number[], index: number, ratio: number): number[] {
  const next = [...weights];
  if (index < 0 || index + 1 >= next.length || !Number.isFinite(ratio)) return next;
  const total = next[index]! + next[index + 1]!;
  const clamped = Math.max(0.15, Math.min(0.85, ratio));
  next[index] = total * clamped;
  next[index + 1] = total * (1 - clamped);
  return next;
}

export function resizeSessionLayout(layout: SessionLayout, columnId: string | undefined, index: number, ratio: number): SessionLayout {
  const next = copyLayout(layout);
  if (columnId) {
    const column = next.columns.find(({ id }) => id === columnId);
    if (column) column.paneWeights = resizeSessionWeights(column.paneWeights, index, ratio);
  } else next.columnWeights = resizeSessionWeights(next.columnWeights, index, ratio);
  return next;
}

/** Upstream uses a 30% edge band and nearest-edge corner resolution. */
export function sessionDropZone(rect: PaneRect, clientX: number, clientY: number): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const horizontal = x <= 0.3 ? { edge: "left" as const, distance: x } : 1 - x <= 0.3 ? { edge: "right" as const, distance: 1 - x } : undefined;
  const vertical = y <= 0.3 ? { edge: "up" as const, distance: y } : 1 - y <= 0.3 ? { edge: "down" as const, distance: 1 - y } : undefined;
  const closest = horizontal && vertical ? horizontal.distance <= vertical.distance ? horizontal : vertical : horizontal ?? vertical;
  return closest ? { kind: "edge", edge: closest.edge } : { kind: "center" };
}

export function sessionDropRect(rect: PaneRect, zone: DropZone): PaneRect {
  // DOMRect dimensions are prototype getters, not enumerable own properties.
  const bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (zone.kind === "center") return bounds;
  if (zone.edge === "left") return { ...bounds, width: rect.width / 2 };
  if (zone.edge === "right") return { ...bounds, left: rect.left + rect.width / 2, width: rect.width / 2 };
  if (zone.edge === "up") return { ...bounds, height: rect.height / 2 };
  return { ...bounds, top: rect.top + rect.height / 2, height: rect.height / 2 };
}

/** Browser-local state only; reject malformed records without touching registry
 * or PI data. Session existence is checked once the registry finishes loading. */
export function parseSessionLayout(value: unknown): SessionLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<SessionLayout>;
  if (!Array.isArray(raw.columns) || !raw.columns.length || !Array.isArray(raw.columnWeights)) return undefined;
  const ids = new Set<string>();
  const validId = (value: unknown, pattern: RegExp) => {
    if (typeof value !== "string" || !pattern.test(value) || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  const validWeights = (value: unknown, count: number): value is number[] => Array.isArray(value) && value.length === count && value.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (!validWeights(raw.columnWeights, raw.columns.length)) return undefined;
  for (const column of raw.columns) {
    if (!column || !validId(column.id, /^c\d+$/) || !Array.isArray(column.panes) || !column.panes.length || !validWeights(column.paneWeights, column.panes.length)) return undefined;
    for (const pane of column.panes) {
      if (!pane || !validId(pane.id, /^p\d+$/) || typeof pane.sessionId !== "string" || !pane.sessionId.trim() || pane.sessionId.length > 512 || /[\u0000-\u001f\u007f]/u.test(pane.sessionId)) return undefined;
      if (pane.terminalId !== undefined && (typeof pane.terminalId !== "string" || !/^[0-9a-f-]{36}$/u.test(pane.terminalId))) return undefined;
      if (pane.browser !== undefined && (pane.browser !== true || pane.terminalId !== undefined)) return undefined;
    }
  }
  if (typeof raw.activePaneId !== "string" || !raw.columns.some((column) => column.panes.some(({ id }) => id === raw.activePaneId))) return undefined;
  return copyLayout(raw as SessionLayout);
}
