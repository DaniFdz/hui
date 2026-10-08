/**
 * The Work pane's contract and state: the registry of Work view kinds (terminal, browser, files, VS Code…), the
 * browser-local per-conversation record (open, width, views, active view) and the pure transitions on it, plus the
 * one-time move of terminal and browser panes out of the chat multiplexer's saved layout. Rendering belongs to
 * `components/work-pane.ts`; each kind renders its own view; the conversations themselves stay PI/HUI-owned.
 */
import type { TemplateResult } from "lit";
import { closeSessionPane, isChatPane, locateSessionPane, replacePaneSession, sessionPanes, spotTabs, type SessionLayout } from "./session-multiplexer.ts";

export type WorkViewRef =
  | { kind: "terminal"; terminalId: string }
  | { kind: "browser" }
  | { kind: "files"; id: string }
  | { kind: "vscode" };

export type WorkViewContext = {
  /** The conversation owning the Work pane. */
  sessionId: string;
  /** This view is the active tab of a shown Work pane. */
  visible: boolean;
  /** < 1100px presentation. */
  narrow: boolean;
  /** Close this view (tab). */
  close(): void;
  /** The operator just launched this view: it may take keyboard focus once it is ready. */
  autofocus: boolean;
  /** Ask the Work pane to re-read this view's `title` (for example once a terminal reports its name). */
  invalidate(): void;
};

/** An existing resource a launcher can show again, such as a running terminal whose tab was closed. */
export type WorkViewResource<R extends WorkViewRef = WorkViewRef> = { ref: R; title: string };

export type WorkViewKind<R extends WorkViewRef = WorkViewRef> = {
  kind: R["kind"];
  /** Launcher caption, e.g. "Files". */
  label: string;
  /** 16px SVG, explicit size. */
  icon: TemplateResult;
  /** e.g. "Mod+Alt+KeyF" (display + binding). */
  shortcut?: string;
  /** Visible reason when it cannot launch (for this conversation, when given). */
  unavailable?(sessionId?: string): string | undefined;
  /** Launcher action → new (or reused) ref. */
  create(sessionId: string): Promise<R> | R;
  /** Stable identity within a session. */
  key(ref: R): string;
  /** Tab caption. */
  title(ref: R): string;
  render(ref: R, ctx: WorkViewContext): TemplateResult;
  /** Resources of this kind that exist without a tab and can be reopened from the launcher menu. */
  existing?(sessionId: string): Promise<WorkViewResource<R>[]>;
};

const kinds = new Map<string, WorkViewKind<any>>();

/** Registers (or replaces) a kind. Launchers list kinds in registration order. */
export function registerWorkViewKind(kind: WorkViewKind<any>): void {
  kinds.set(kind.kind, kind);
}

export function workViewKind(kind: string): WorkViewKind | undefined {
  return kinds.get(kind);
}

export function workViewKinds(): WorkViewKind[] {
  return [...kinds.values()];
}

/** Used for kinds that are not registered (yet): the same keys the built-in kinds use. */
export function defaultWorkViewKey(ref: WorkViewRef): string {
  if (ref.kind === "terminal") return `terminal:${ref.terminalId}`;
  if (ref.kind === "files") return `files:${ref.id}`;
  return ref.kind;
}

export function workViewKey(ref: WorkViewRef): string {
  return kinds.get(ref.kind)?.key(ref) ?? defaultWorkViewKey(ref);
}

/* ── state ────────────────────────────────────────────────────────────────── */

export const WORK_PANE_KEY = "hui.work-pane.v1";
export const WORK_PANE_DEFAULT_WIDTH = 560;
export const WORK_PANE_MIN_WIDTH = 320;
export const WORK_PANE_MAX_WIDTH = 1600;
/** The chat keeps at least this much room beside an expanded Work pane. */
export const WORK_PANE_CHAT_MIN_WIDTH = 420;
/** Conversations whose Work views stay mounted (hidden) after focus moves away, the focused one included. A view of a
 * conversation pushed out of this set reconnects (terminals replay their snapshot) when it is shown again. */
export const WORK_PANE_RETAINED_SESSIONS = 3;
/** Shows or hides the Work pane (on narrow screens: opens it as the destination, or returns to the chat). */
export const WORK_PANE_TOGGLE_SHORTCUT = "Mod+Alt+KeyW";

export type SessionWorkPane = {
  /** Expanded on desktop. On narrow screens the pane is a destination instead (see the app's narrow state). */
  open: boolean;
  /** CSS pixels; clamped again against the viewport when rendered. */
  width: number;
  /** Tab order. Keys (`workViewKey`) are unique. */
  views: WorkViewRef[];
  /** The active view's key, when there is one. */
  active?: string;
};

export type WorkPaneStore = Readonly<Record<string, SessionWorkPane>>;

export function emptyWorkPane(): SessionWorkPane {
  return { open: false, width: WORK_PANE_DEFAULT_WIDTH, views: [] };
}

export function sessionWorkPane(store: WorkPaneStore, sessionId: string): SessionWorkPane {
  return store[sessionId] ?? emptyWorkPane();
}

function update(store: WorkPaneStore, sessionId: string, change: (pane: SessionWorkPane) => SessionWorkPane): WorkPaneStore {
  const current = sessionWorkPane(store, sessionId);
  const next = change(current);
  return next === current ? store : { ...store, [sessionId]: next };
}

/** Adds `ref` as the last tab (or finds its existing tab) and makes it active; `expand` also opens the pane. */
export function openWorkView(store: WorkPaneStore, sessionId: string, ref: WorkViewRef, expand = true): WorkPaneStore {
  const key = workViewKey(ref);
  return update(store, sessionId, (pane) => ({
    ...pane,
    open: expand || pane.open,
    views: pane.views.some((view) => workViewKey(view) === key) ? pane.views : [...pane.views, ref],
    active: key,
  }));
}

/** Removes a tab. The previous tab (or else the next) becomes active; the pane stays open on its empty state. */
export function closeWorkView(store: WorkPaneStore, sessionId: string, key: string): WorkPaneStore {
  return update(store, sessionId, (pane) => {
    const index = pane.views.findIndex((view) => workViewKey(view) === key);
    if (index < 0) return pane;
    const views = pane.views.filter((_, i) => i !== index);
    const neighbour = views[index - 1] ?? views[index];
    const active = pane.active === key ? neighbour && workViewKey(neighbour) : pane.active;
    const next: SessionWorkPane = { ...pane, views };
    if (active) next.active = active; else delete next.active;
    return next;
  });
}

export function activateWorkView(store: WorkPaneStore, sessionId: string, key: string, expand = true): WorkPaneStore {
  return update(store, sessionId, (pane) => {
    if (!pane.views.some((view) => workViewKey(view) === key)) return pane;
    if (pane.active === key && (pane.open || !expand)) return pane;
    return { ...pane, active: key, open: expand || pane.open };
  });
}

/** Moves a tab to `index` (clamped) in tab order. */
export function reorderWorkView(store: WorkPaneStore, sessionId: string, key: string, index: number): WorkPaneStore {
  return update(store, sessionId, (pane) => {
    const from = pane.views.findIndex((view) => workViewKey(view) === key);
    if (from < 0 || !Number.isFinite(index)) return pane;
    const to = Math.max(0, Math.min(pane.views.length - 1, Math.trunc(index)));
    if (to === from) return pane;
    const views = [...pane.views];
    const [moved] = views.splice(from, 1);
    views.splice(to, 0, moved!);
    return { ...pane, views };
  });
}

/** The tab `step` places after (or before) the active one, wrapping around. */
export function adjacentWorkView(pane: SessionWorkPane, step: 1 | -1): string | undefined {
  if (!pane.views.length) return undefined;
  const index = pane.views.findIndex((view) => workViewKey(view) === pane.active);
  const next = index < 0 ? 0 : (index + step + pane.views.length) % pane.views.length;
  return workViewKey(pane.views[next]!);
}

export function setWorkPaneOpen(store: WorkPaneStore, sessionId: string, open: boolean): WorkPaneStore {
  return update(store, sessionId, (pane) => pane.open === open ? pane : { ...pane, open });
}

export function clampWorkPaneWidth(width: number, available = Number.POSITIVE_INFINITY): number {
  const max = Math.max(WORK_PANE_MIN_WIDTH, Math.min(WORK_PANE_MAX_WIDTH, available - WORK_PANE_CHAT_MIN_WIDTH));
  if (Number.isNaN(width)) return Math.min(WORK_PANE_DEFAULT_WIDTH, max);
  return Math.round(Math.max(WORK_PANE_MIN_WIDTH, Math.min(max, width)));
}

export function setWorkPaneWidth(store: WorkPaneStore, sessionId: string, width: number, available?: number): WorkPaneStore {
  const clamped = clampWorkPaneWidth(width, available);
  return update(store, sessionId, (pane) => pane.width === clamped ? pane : { ...pane, width: clamped });
}

/** Forgets conversations that no longer exist (deleted or archived out of the registry). */
export function pruneWorkPaneStore(store: WorkPaneStore, sessionIds: ReadonlySet<string>): WorkPaneStore {
  const entries = Object.entries(store);
  const kept = entries.filter(([id]) => sessionIds.has(id));
  return kept.length === entries.length ? store : Object.fromEntries(kept);
}

/** Most recently focused first, `focused` included, at most `bound` conversations that have Work views. */
export function retainWorkSessions(previous: readonly string[], focused: string | undefined, store: WorkPaneStore, bound = WORK_PANE_RETAINED_SESSIONS): string[] {
  const order = focused ? [focused, ...previous.filter((id) => id !== focused)] : [...previous];
  return order.filter((id) => sessionWorkPane(store, id).views.length > 0).slice(0, bound);
}

/* ── persistence ──────────────────────────────────────────────────────────── */

const TERMINAL_ID = /^[0-9a-f-]{36}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function validSessionId(id: string): boolean {
  return Boolean(id.trim()) && id.length <= 512 && !CONTROL.test(id);
}

/** A structurally valid ref of a kind `isKnown` accepts, or undefined. */
export function parseWorkViewRef(value: unknown, isKnown: (kind: string) => boolean = (kind) => kinds.has(kind)): WorkViewRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== "string" || !isKnown(raw.kind)) return undefined;
  if (raw.kind === "terminal") return typeof raw.terminalId === "string" && TERMINAL_ID.test(raw.terminalId) ? { kind: "terminal", terminalId: raw.terminalId } : undefined;
  if (raw.kind === "files") return typeof raw.id === "string" && raw.id.trim() && raw.id.length <= 128 && !CONTROL.test(raw.id) ? { kind: "files", id: raw.id } : undefined;
  if (raw.kind === "browser" || raw.kind === "vscode") return { kind: raw.kind };
  return undefined;
}

/** Reads the stored record, dropping garbage, unknown kinds and duplicate tabs instead of failing the whole store. */
export function parseWorkPaneStore(value: unknown, isKnown?: (kind: string) => boolean): Record<string, SessionWorkPane> {
  const store: Record<string, SessionWorkPane> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return store;
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return store;
  for (const [sessionId, raw] of Object.entries(sessions as Record<string, unknown>)) {
    if (!validSessionId(sessionId) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const views: WorkViewRef[] = [];
    const keys = new Set<string>();
    for (const candidate of Array.isArray(entry.views) ? entry.views.slice(0, 64) : []) {
      const ref = parseWorkViewRef(candidate, isKnown);
      if (!ref || keys.has(workViewKey(ref))) continue;
      keys.add(workViewKey(ref));
      views.push(ref);
    }
    const pane: SessionWorkPane = {
      open: entry.open === true,
      width: clampWorkPaneWidth(typeof entry.width === "number" ? entry.width : Number.NaN),
      views,
    };
    const active = typeof entry.active === "string" && keys.has(entry.active) ? entry.active : views[0] && workViewKey(views[0]);
    if (active) pane.active = active;
    store[sessionId] = pane;
  }
  return store;
}

/** The stored shape; conversations still at the default (closed, no views, default width) are left out. */
export function serializeWorkPaneStore(store: WorkPaneStore): { version: 1; sessions: Record<string, SessionWorkPane> } {
  const sessions: Record<string, SessionWorkPane> = {};
  for (const [id, pane] of Object.entries(store)) {
    if (!pane.open && !pane.views.length && pane.width === WORK_PANE_DEFAULT_WIDTH) continue;
    sessions[id] = pane;
  }
  return { version: 1, sessions };
}

/* ── migration from the chat multiplexer ──────────────────────────────────── */

/** Before the Work pane, terminals and the browser view were multiplexer panes (`terminalId` / `browser: true` in
 * the saved split layout). Moves each one into its conversation's Work pane, in layout order, and removes it from the
 * layout; chat panes, splits and tabs are untouched. A conversation whose pane was the visible one gets that view
 * active and its Work pane expanded. */
export function migrateLayoutWorkViews(layout: SessionLayout, store: WorkPaneStore): { layout: SessionLayout; store: WorkPaneStore; moved: number } {
  const work = sessionPanes(layout).filter((pane) => !isChatPane(pane));
  if (!work.length) return { layout, store, moved: 0 };
  const shown = new Set(layout.columns.flatMap((column) => column.panes.map(({ id }) => id)));
  const activeOwner = locateSessionPane(layout, layout.activePaneId)?.pane;
  let next = store;
  for (const pane of work) {
    const ref: WorkViewRef = pane.terminalId ? { kind: "terminal", terminalId: pane.terminalId } : { kind: "browser" };
    const current = sessionWorkPane(next, pane.sessionId);
    // A pane shown in its spot becomes the conversation's active view; a hidden tab joins behind it.
    next = openWorkView(next, pane.sessionId, ref, shown.has(pane.id) || current.open);
    if (!shown.has(pane.id) && current.active) next = activateWorkView(next, pane.sessionId, current.active, false);
  }
  // The focused pane was one of them: it is its conversation's active view.
  if (activeOwner && !isChatPane(activeOwner)) {
    next = activateWorkView(next, activeOwner.sessionId, workViewKey(activeOwner.terminalId ? { kind: "terminal", terminalId: activeOwner.terminalId } : { kind: "browser" }));
  }
  let migrated = layout;
  for (const pane of work) {
    const after = closeSessionPane(migrated, pane.id);
    // The last pane cannot close: it becomes its conversation's chat instead.
    migrated = after === migrated ? replacePaneSession(migrated, pane.id, pane.sessionId) : after;
  }
  // The focused pane was a terminal/browser: focus moves to a chat of the same conversation when one is open.
  if (activeOwner && !isChatPane(activeOwner)) {
    const chat = sessionPanes(migrated).find((pane) => isChatPane(pane) && pane.sessionId === activeOwner.sessionId);
    const spot = chat && migrated.columns.flatMap((column) => column.panes).find((visible) => spotTabs(visible).some(({ id }) => id === chat.id));
    if (chat && spot?.id === chat.id) migrated = { ...migrated, activePaneId: chat.id };
  }
  return { layout: migrated, store: next, moved: work.length };
}
