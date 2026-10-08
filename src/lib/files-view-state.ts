/**
 * What one Files view remembers in this browser: its selected file, open folders, whether its navigator is open and
 * how a Markdown file is displayed. Keyed by the view's id, so two Files views keep independent selections, and the
 * Work pane's tab title can read the selected file's name.
 */
export type MarkdownDisplayMode = "source" | "rendered";

export type FilesViewState = {
  selected: string | undefined;
  expanded: string[];
  navigatorOpen: boolean;
  markdown: MarkdownDisplayMode;
};

type ViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "hui.files-view.v1:";
const MAX_EXPANDED = 200;
const memory = new Map<string, FilesViewState>();

export const DEFAULT_FILES_VIEW_STATE: FilesViewState = { selected: undefined, expanded: [], navigatorOpen: true, markdown: "rendered" };

function storage(): ViewStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Accepts only well-formed stored state; anything else is the default. */
export function normalizeFilesViewState(value: unknown): FilesViewState {
  if (!value || typeof value !== "object") return { ...DEFAULT_FILES_VIEW_STATE };
  const record = value as Record<string, unknown>;
  const selected = typeof record["selected"] === "string" && record["selected"] ? record["selected"] : undefined;
  const expanded = Array.isArray(record["expanded"])
    ? [...new Set(record["expanded"].filter((path): path is string => typeof path === "string"))].slice(0, MAX_EXPANDED)
    : [];
  return {
    selected,
    expanded,
    navigatorOpen: record["navigatorOpen"] !== false,
    markdown: record["markdown"] === "source" ? "source" : "rendered",
  };
}

export function readFilesViewState(viewId: string, store: ViewStorage | undefined = storage()): FilesViewState {
  const cached = memory.get(viewId);
  if (cached) return cached;
  let state = { ...DEFAULT_FILES_VIEW_STATE };
  try {
    const raw = store?.getItem(PREFIX + viewId);
    if (raw) state = normalizeFilesViewState(JSON.parse(raw));
  } catch {
    // Unreadable state starts over.
  }
  memory.set(viewId, state);
  return state;
}

export function writeFilesViewState(viewId: string, patch: Partial<FilesViewState>, store: ViewStorage | undefined = storage()): FilesViewState {
  const next = normalizeFilesViewState({ ...readFilesViewState(viewId, store), ...patch });
  memory.set(viewId, next);
  try {
    store?.setItem(PREFIX + viewId, JSON.stringify(next));
  } catch {
    // The view keeps working from memory.
  }
  return next;
}

/** Forgets a closed view's state. */
export function clearFilesViewState(viewId: string, store: ViewStorage | undefined = storage()): void {
  memory.delete(viewId);
  try { store?.removeItem(PREFIX + viewId); } catch { /* nothing stored */ }
}

/** The Work pane tab caption: the selected file's name, or "Files". */
export function filesViewTitle(viewId: string): string {
  const selected = readFilesViewState(viewId).selected;
  return selected ? selected.slice(selected.lastIndexOf("/") + 1) : "Files";
}
