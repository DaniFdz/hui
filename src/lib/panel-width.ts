/**
 * Width of a view's file list beside its content: the Files navigator and the
 * Diff view's changed-file list. Owns their bounds, the browser-local width
 * each remembers, the rule that leaves the content room in a narrow pane, and
 * the pointer drag that changes it. A stored value that no longer parses
 * degrades to the default instead of reaching CSS.
 */

export type PanelWidthBounds = {
  /** localStorage key for the per-browser choice. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly min: number;
  readonly max: number;
};

export const FILES_NAV_WIDTH: PanelWidthBounds = {
  storageKey: "hui.files-nav-width",
  defaultWidth: 260,
  min: 200,
  max: 640,
};

export const DIFF_LIST_WIDTH: PanelWidthBounds = {
  storageKey: "hui.diff-list-width",
  defaultWidth: 280,
  min: 220,
  max: 640,
};

/** The space the Files editor keeps when the navigator takes as much as it can. */
export const FILES_EDITOR_MIN_WIDTH = 240;
/** The space the diff keeps when the changed-file list takes as much as it can. */
export const DIFF_MAIN_MIN_WIDTH = 320;

type WidthStorage = Pick<Storage, "getItem" | "setItem">;

function storage(): WidthStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A width the bounds allow, rounded; junk falls back to the default. */
export function normalizePanelWidth(value: unknown, bounds: PanelWidthBounds): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed)
    ? Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)))
    : bounds.defaultWidth;
}

/** The width this browser last chose, or the default. */
export function readPanelWidth(bounds: PanelWidthBounds, store: WidthStorage | undefined = storage()): number {
  try {
    return normalizePanelWidth(store?.getItem(bounds.storageKey) ?? null, bounds);
  } catch {
    return bounds.defaultWidth;
  }
}

/** Normalizes and remembers a chosen width; returns what was written. */
export function rememberPanelWidth(bounds: PanelWidthBounds, value: number, store: WidthStorage | undefined = storage()): number {
  const width = normalizePanelWidth(value, bounds);
  try {
    store?.setItem(bounds.storageKey, String(width));
  } catch {
    // The view keeps the width for this session.
  }
  return width;
}

/** The widest the list may get while the content keeps `minRemaining` of `containerWidth`. */
export function maxPanelWidth(containerWidth: number, bounds: PanelWidthBounds, minRemaining: number): number {
  if (!(containerWidth > 0)) return bounds.max;
  return Math.max(bounds.min, Math.min(bounds.max, Math.floor(containerWidth - minRemaining)));
}

export type PanelResizeOptions = {
  panel: HTMLElement | null;
  bounds: PanelWidthBounds;
  /** The content beside the list keeps at least this much room. */
  minRemaining: number;
  /** A width while the pointer moves; the caller writes it to CSS without re-rendering. */
  onWidth: (width: number) => void;
  /** The width the pointer settled on, and whether it differs from where the drag began. */
  onEnd: (width: number, changed: boolean) => void;
};

/**
 * Drags a list's boundary: the panel widens or narrows with the pointer, never
 * past its bounds or over the content's minimum. Moves redraw once per frame;
 * the caller commits the width on release.
 */
export function startPanelResize(event: PointerEvent, options: PanelResizeOptions): void {
  const handle = event.currentTarget;
  const { panel } = options;
  if (!(handle instanceof HTMLElement) || !panel || event.button !== 0) return;
  const container = panel.parentElement;
  const limit = maxPanelWidth(container?.clientWidth ?? 0, options.bounds, options.minRemaining);
  const startWidth = panel.getBoundingClientRect().width;
  if (!(startWidth > 0) || limit <= startWidth && startWidth <= options.bounds.min) return;

  const pointerId = event.pointerId;
  const startX = event.clientX;
  let width = startWidth;
  let pendingX: number | undefined;
  let frame = 0;
  let done = false;

  const apply = (value: number) => {
    width = Math.min(limit, Math.max(options.bounds.min, value));
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    options.onWidth(width);
  };
  const flush = () => {
    frame = 0;
    if (pendingX === undefined) return;
    apply(startWidth + pendingX - startX);
    pendingX = undefined;
  };
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    pendingX = moveEvent.clientX;
    frame ||= requestAnimationFrame(flush);
  };
  const finish = (endEvent?: Event) => {
    if (done || (endEvent instanceof PointerEvent && endEvent.pointerId !== pointerId)) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    flush();
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    window.removeEventListener("blur", finish);
    handle.classList.remove("is-resizing");
    container?.classList.remove("hui-panel-resizing");
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    options.onEnd(width, Math.round(width) !== Math.round(startWidth));
  };

  event.preventDefault();
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(pointerId);
  handle.classList.add("is-resizing");
  container?.classList.add("hui-panel-resizing");
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
}
