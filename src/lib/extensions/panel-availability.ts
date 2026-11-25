/**
 * Whether any enabled extension ships a panel. The Work pane lists its Extension panel launcher only when one does;
 * the gateway's extension list is the source, updated whenever a surface reads it and after Settings toggles one.
 */
import type { ExtensionStatus } from "../../api/schema/extensions.ts";

let available = false;

export function notePanelExtensions(extensions: readonly ExtensionStatus[]): void {
  available = extensions.some((extension) => extension.panel !== undefined && extension.state === "loaded");
}

export function panelLauncherAvailable(): boolean {
  return available;
}
