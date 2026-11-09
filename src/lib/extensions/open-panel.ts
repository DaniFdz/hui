/**
 * Asking the app to show an extension's panel in its Work pane. The Settings page raises it; the app owns the Work
 * layout and answers only when a conversation is there to show it in.
 */
export const OPEN_EXTENSION_PANEL_EVENT = "hui-open-extension-panel";

export type OpenExtensionPanelDetail = { id?: string; icon?: string };

/** Returns true when the app accepted the request (the event was handled). */
export function requestOpenExtensionPanel(from: EventTarget, detail: OpenExtensionPanelDetail): boolean {
  return !from.dispatchEvent(new CustomEvent<OpenExtensionPanelDetail>(OPEN_EXTENSION_PANEL_EVENT, {
    bubbles: true, composed: true, cancelable: true, detail,
  }));
}
