/**
 * The terminal Work view kind: one tab per shared terminal of the conversation, drawn by `<hui-terminal-pane>`.
 * "New terminal" creates a PTY in the gateway; closing the tab only hides it (the shell keeps running and can be
 * reopened from the launcher menu); "End terminal" inside the view stops it. A new tab takes a name no other tab of
 * the conversation already shows. The PTYs and the agent's terminal tool belong to the gateway
 * (`server/terminals/terminals.ts`), which also serves a conversation on a remote worker through that worker's
 * connect command.
 */
import { html, svg } from "lit";
import { createTerminal, listTerminals } from "../../api/terminals.ts";
import type { TerminalView } from "../../api/schema/terminals.ts";
import type { WorkViewKind } from "../../lib/work-pane.ts";
import { WORK_SHORTCUTS } from "../../lib/work-shortcuts.ts";

export type TerminalWorkViewRef = { kind: "terminal"; terminalId: string };

export type TerminalWorkViewEnvironment = {
  /** The Appearance → terminal font. */
  fontFamily(): string;
};

export const TERMINAL_WORK_VIEW_SHORTCUT = WORK_SHORTCUTS.terminal;

/**
 * A new tab's default name: "Terminal 1", or the first number no tab of this conversation already shows. The gateway
 * names a shell after how many it holds, so after a restart it would hand a fresh shell the name of the tab that lost
 * its own (`Terminal 1` twice); only the page still knows the names those lost tabs carry.
 */
export function nextTerminalTitle(taken: Iterable<string>): string {
  const shown = new Set(taken);
  let number = 1;
  while (shown.has(`Terminal ${number}`)) number += 1;
  return `Terminal ${number}`;
}

/** Lucide square-terminal, the shape of `icons.squareTerminal`, at 16px. */
export const terminalWorkViewIcon = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg`<path d="m7 11 2-2-2-2M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" />`}</svg>`;

export function terminalWorkViewKind(env: TerminalWorkViewEnvironment): WorkViewKind<TerminalWorkViewRef> {
  // The gateway names terminals ("Terminal 2"); tab captions read the last name seen, and a new tab avoids the names
  // its conversation already shows, the ones whose shell a restart took away included.
  const titles = new Map<string, string>();
  const shown = new Map<string, Set<string>>();
  /** Told when a ref's caption changes, so a tab and the narrow destination chooser can be redrawn: a reload keeps a
   * tab's ref and not its terminal's name, which only `existing` reads back. */
  const listeners = new Set<() => void>();
  const remember = (view: TerminalView) => {
    const renamed = titles.get(view.id) !== view.title;
    titles.set(view.id, view.title);
    const names = shown.get(view.ownerSessionId) ?? new Set<string>();
    names.add(view.title);
    shown.set(view.ownerSessionId, names);
    if (renamed) for (const listener of listeners) listener();
  };
  return {
    kind: "terminal",
    label: "New terminal",
    icon: terminalWorkViewIcon,
    shortcut: TERMINAL_WORK_VIEW_SHORTCUT,
    onTitleChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async create(sessionId) {
      const view = await createTerminal(sessionId, nextTerminalTitle(shown.get(sessionId) ?? []));
      remember(view);
      return { kind: "terminal", terminalId: view.id };
    },
    key: (ref) => `terminal:${ref.terminalId}`,
    title: (ref) => titles.get(ref.terminalId) ?? "Terminal",
    render: (ref, ctx) => html`<hui-terminal-pane
      .fontFamily=${env.fontFamily()}
      .ownerSessionId=${ctx.sessionId}
      .terminalId=${ref.terminalId}
      .visible=${ctx.visible}
      .active=${ctx.autofocus}
      .onEnded=${ctx.close}
      .onTerminalView=${(view: TerminalView) => {
        if (titles.get(view.id) === view.title) return;
        remember(view);
        ctx.invalidate();
      }}
    ></hui-terminal-pane>`,
    async existing(sessionId) {
      const views = await listTerminals(sessionId);
      views.forEach(remember);
      return views.filter(({ status }) => status === "running").map((view) => ({ ref: { kind: "terminal", terminalId: view.id }, title: view.title }));
    },
  };
}
