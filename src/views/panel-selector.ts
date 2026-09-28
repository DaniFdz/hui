import { html, nothing } from "lit";
import { icons } from "../lib/icons.ts";
import type { SessionPane } from "../lib/session-multiplexer.ts";
import { renderPicker, type PickerOption } from "./settings-picker.ts";

type PanelOption = PickerOption & { kind: "chat" | "terminal" | "browser" };

const PANEL_LABELS = { chat: "Chat", terminal: "Terminal", browser: "Browser" } as const;

/** Narrow-layout switcher for split workspaces that include a terminal or browser pane. */
export function renderPanelSelector(
  panes: readonly SessionPane[],
  activePaneId: string,
  sessionTitle: (sessionId: string) => string | undefined,
  onSelect: (paneId: string) => void,
) {
  if (panes.length < 2 || !panes.some(({ terminalId, browser }) => terminalId || browser)) return nothing;
  const options: PanelOption[] = panes.map((pane, index) => {
    const kind = pane.terminalId ? "terminal" : pane.browser ? "browser" : "chat";
    return {
      value: pane.id,
      kind,
      label: `${index + 1} · ${PANEL_LABELS[kind]}`,
      description: sessionTitle(pane.sessionId) ?? "Session",
    };
  });
  return html`<div class="hui-panel-selector">
    ${renderPicker({
      label: "Active panel",
      value: activePaneId,
      options,
      className: "hui-panel-selector__picker",
      showSelectedDescription: true,
      showOptionTooltips: false,
      renderLeading: (option) => {
        const kind = (option as PanelOption).kind;
        return kind === "terminal" ? icons.squareTerminal : kind === "browser" ? icons.globe : icons.messageSquare;
      },
      onChange: onSelect,
    })}
  </div>`;
}
