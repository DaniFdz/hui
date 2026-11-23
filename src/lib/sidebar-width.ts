/**
 * Width of the desktop sidebar: the bounds its drag handle works within, the
 * `--hui-sidebar-width` variable the shell's column reads, and its per-browser
 * copy in localStorage. A stored value that no longer parses degrades to the
 * default instead of reaching CSS. The main shell and the Settings shell share
 * one handle and one stored width, so the column keeps its width between them.
 */

export const SIDEBAR_WIDTH_DEFAULT = 258;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 460;

const STORAGE_KEY = "hui.sidebar-width";

let current: number | undefined;

export function normalizeSidebarWidth(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed)
    ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(parsed)))
    : SIDEBAR_WIDTH_DEFAULT;
}

/** The width in use: the stored choice on the first call, then the last applied one. */
export function sidebarWidth(): number {
  if (current === undefined) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch { /* Without storage the default still applies. */ }
    current = normalizeSidebarWidth(stored);
  }
  return current;
}

/** Applies a width to the shell and returns what actually landed. `remember` writes it for the next visit. */
export function applySidebarWidth(value: number, remember = false): number {
  current = normalizeSidebarWidth(value);
  document.documentElement.style.setProperty("--hui-sidebar-width", `${current}px`);
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, String(current));
    } catch { /* Keep the width for this view. */ }
  }
  return current;
}

/** One drag at a time, so a second finger cannot compete with the one that started it. */
let sidebarResizing = false;

/** The sidebar's right edge. A drag writes `--hui-sidebar-width` straight to the
 * document, so resizing never re-renders the shell; the choice is stored once
 * the pointer is released. */
export function startSidebarResize(event: PointerEvent) {
  const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const nav = handle?.closest<HTMLElement>(".shell-nav");
  const startWidth = nav?.getBoundingClientRect().width ?? 0;
  if (!handle || !nav || event.button !== 0 || startWidth <= 0 || sidebarResizing) return;
  const shell = nav.closest<HTMLElement>(".shell");
  const { pointerId } = event;
  const startX = event.clientX;
  let width = startWidth;
  let done = false;
  const resize = (value: number) => {
    width = applySidebarWidth(value);
    handle.setAttribute("aria-valuenow", String(width));
  };
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId === pointerId) resize(startWidth + moveEvent.clientX - startX);
  };
  const finish = (endEvent?: Event) => {
    if (done || (endEvent instanceof PointerEvent && endEvent.pointerId !== pointerId)) return;
    done = true;
    sidebarResizing = false;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    window.removeEventListener("blur", finish);
    shell?.classList.remove("shell--sidebar-resizing");
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    applySidebarWidth(width, true);
  };
  event.preventDefault();
  sidebarResizing = true;
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(pointerId);
  shell?.classList.add("shell--sidebar-resizing");
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
}

export function resizeSidebarWithKeys(event: KeyboardEvent) {
  const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const step = event.shiftKey ? 48 : 16;
  const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  if (!handle || delta === 0) return;
  event.preventDefault();
  handle.setAttribute("aria-valuenow", String(applySidebarWidth(sidebarWidth() + delta, true)));
}
