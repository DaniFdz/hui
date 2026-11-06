/**
 * Width of the desktop sidebar: the bounds its drag handle works within, the
 * `--hui-sidebar-width` variable the shell's column reads, and its per-browser
 * copy in localStorage. A stored value that no longer parses degrades to the
 * default instead of reaching CSS.
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
