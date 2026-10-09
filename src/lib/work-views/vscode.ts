/**
 * The VS Code kind of Work view: its launcher entry (label, icon, shortcut, why it cannot launch and the Settings
 * section that fixes it), one view per conversation, and rendering <hui-vscode-view>.
 */
import { html } from "lit";
import { vscodeIcon } from "../../components/vscode-view.ts";
import { knownVscodeStatus, knownVscodeUnavailableReason, loadVscodeStatus, onVscodeStatus } from "../vscode-store.ts";
import type { WorkViewKind } from "../work-pane.ts";
import { WORK_SHORTCUTS } from "../work-shortcuts.ts";

export type VscodeWorkViewRef = { kind: "vscode" };

export const VSCODE_WORK_VIEW_SHORTCUT = WORK_SHORTCUTS.vscode;

export const vscodeWorkViewKind: WorkViewKind<VscodeWorkViewRef> = {
  kind: "vscode",
  label: "VS Code",
  icon: vscodeIcon,
  shortcut: VSCODE_WORK_VIEW_SHORTCUT,
  // Off in Settings or no executable: the launcher says so. A remote conversation is the view's to explain.
  unavailable: () => knownVscodeUnavailableReason(),
  // Both reasons are fixed in Settings → Tools → VS Code (turn it on, or name the executable).
  settingsLink: () => knownVscodeUnavailableReason()
    ? { label: "Open Settings → Tools → VS Code", page: "tools", section: "vscode" }
    : undefined,
  onAvailabilityChange: (listener) => onVscodeStatus(() => listener()),
  // One VS Code per conversation: launching it again focuses the open one.
  single: true,
  create: () => ({ kind: "vscode" }),
  key: () => "vscode",
  title: () => "VS Code",
  render: (_ref, ctx) => html`<hui-vscode-view .sessionId=${ctx.sessionId} .visible=${ctx.visible} .narrow=${ctx.narrow}></hui-vscode-view>`,
};

/** The launcher asks synchronously, so the status is read once as the app registers the kind; Settings and the view
 * refresh it. */
export function loadVscodeAvailability(): void {
  if (!knownVscodeStatus()) void loadVscodeStatus().catch(() => undefined);
}
