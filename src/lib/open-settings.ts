/**
 * Asking the app to open a Settings page from inside it (the Work pane's launchers, the VS Code view): the
 * `hui-open-settings` page event and its detail. `hui-app.ts` handles it by navigating in place and cancelling the
 * event; an uncancelled request (a page without the app) leaves the link to load Settings itself.
 */
export const OPEN_SETTINGS_EVENT = "hui-open-settings";

/** A Settings page (its route segment, e.g. "tools") and optionally the `data-settings-section` to scroll to. */
export type OpenSettingsDetail = { page: string; section?: string };

/** The link a request falls back to. */
export function settingsHref(detail: OpenSettingsDetail): string {
  return `/settings/${encodeURIComponent(detail.page)}`;
}

/** Dispatches the request from `from` (it bubbles out of shadow roots); true when the app took it. */
export function requestOpenSettings(from: EventTarget, detail: OpenSettingsDetail): boolean {
  return !from.dispatchEvent(new CustomEvent<OpenSettingsDetail>(OPEN_SETTINGS_EVENT, { bubbles: true, composed: true, cancelable: true, detail }));
}
