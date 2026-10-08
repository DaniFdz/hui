/**
 * The VS Code kind of Work view: its launcher entry (label, icon, shortcut, why it cannot launch), one view per
 * conversation, and rendering <hui-vscode-view>. It is typed against a local structural copy of the Work pane's
 * contract (src/lib/work-pane.ts) until that module lands; registering it is then one line.
 */
import { html, type TemplateResult } from "lit";
import { vscodeIcon } from "../../components/vscode-view.ts";
import { knownVscodeUnavailableReason, loadVscodeStatus } from "../vscode-store.ts";

/** Structural copy of the Work pane contract's types this kind needs. */
export type VscodeWorkViewRef = { kind: "vscode" };
export type VscodeWorkViewContext = { sessionId: string; visible: boolean; narrow: boolean; close(): void };
export type VscodeWorkViewKind = {
  kind: "vscode";
  label: string;
  icon: TemplateResult;
  shortcut?: string;
  unavailable?(): string | undefined;
  create(sessionId: string): Promise<VscodeWorkViewRef> | VscodeWorkViewRef;
  key(ref: VscodeWorkViewRef): string;
  title(ref: VscodeWorkViewRef): string;
  render(ref: VscodeWorkViewRef, ctx: VscodeWorkViewContext): TemplateResult;
};

export const vscodeWorkViewKind: VscodeWorkViewKind = {
  kind: "vscode",
  label: "VS Code",
  icon: vscodeIcon,
  shortcut: "Mod+Alt+KeyV",
  // Off in Settings or no executable: the launcher says so. A remote conversation is the view's to explain.
  unavailable: () => knownVscodeUnavailableReason(),
  // One VS Code per conversation: launching it again focuses the open one.
  create: () => ({ kind: "vscode" }),
  key: () => "vscode",
  title: () => "VS Code",
  render: (_ref, ctx) => html`<hui-vscode-view .sessionId=${ctx.sessionId} .visible=${ctx.visible} .narrow=${ctx.narrow}></hui-vscode-view>`,
};

// The launcher asks synchronously, so the status is read once as the app loads; Settings and the view refresh it.
if (typeof document !== "undefined") void loadVscodeStatus().catch(() => undefined);
