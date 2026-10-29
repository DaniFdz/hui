/**
 * Client half of the config directory: the settings cache, its revision and the serialized write queue. The server
 * (see `server/hui.ts`) owns `~/.config/hui`; the requests are in `api/settings.ts`.
 *
 * Every call degrades rather than throws: with the backend unreachable the app
 * runs on defaults from tokens.css and simply does not remember anything.
 */
import { applyAppearance } from "../theme/appearance.ts";
import { DEFAULT_SETTINGS, normalizeSettings, routeNameIsValid, type Settings } from "./settings.ts";
import { fetchSettings, saveSettings } from "../../api/settings.ts";

let settings: Settings = DEFAULT_SETTINGS;
let settingsWriteQueue: Promise<void> = Promise.resolve();
let settingsRevision = 0;

function applyUiPreferences(value: Settings): void {
  const root = document.documentElement;
  root.dataset.chatMessageWidth = value.chat.messageWidth;
  root.dataset.chatSendShortcut = value.chat.sendShortcut;
}

export function currentSettings(): Settings {
  return settings;
}

export async function loadSettings(): Promise<Settings> {
  try {
    settings = normalizeSettings(await fetchSettings());
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings);
  applyUiPreferences(settings);
  return settings;
}

/** Reads the settings again, for a change made elsewhere (a VS Code license accepted, say). Unlike `loadSettings`, a
 * failed read changes nothing and resolves undefined. */
export async function refreshSettings(): Promise<Settings | undefined> {
  try {
    settings = normalizeSettings(await fetchSettings());
  } catch {
    return undefined;
  }
  applyAppearance(settings);
  applyUiPreferences(settings);
  return settings;
}

/**
 * Applies immediately and writes in the background, so the UI never waits on
 * disk. Returns whether the write landed: a false lets the caller say so rather
 * than pretending the change was saved.
 */
export async function patchSettings(patch: Partial<Settings>): Promise<boolean> {
  settings = normalizeSettings({ ...settings, ...patch });
  const revision = ++settingsRevision;
  applyAppearance(settings);
  applyUiPreferences(settings);
  let written = false;
  const write = settingsWriteQueue.then(async () => {
    const confirmed = normalizeSettings(await saveSettings(settings));
    written = true;
    if (revision !== settingsRevision) return;
    settings = confirmed;
    applyAppearance(settings);
    applyUiPreferences(settings);
  });
  settingsWriteQueue = write.catch(() => undefined);
  try {
    await write;
    return written;
  } catch {
    return false;
  }
}

export async function saveSubagentRoute(route: Settings["models"]["routes"][number], originalName?: string): Promise<boolean> {
  const write = settingsWriteQueue.then(async () => {
    const routes = settings.models.routes;
    if (!routeNameIsValid(route.name) || (originalName === undefined && routes.length >= 50)
      || (originalName !== undefined && !routes.some((entry) => entry.name === originalName))
      || routes.some((entry) => entry.name !== originalName && entry.name === route.name)) return false;
    const withRoute = (next: typeof route) => originalName === undefined ? [...settings.models.routes, next]
      : settings.models.routes.map((entry) => entry.name === originalName ? next : entry);
    const next = normalizeSettings({ ...settings, models: { ...settings.models, routes: withRoute(route) } });
    if (!next.models.routes.some((entry) => entry.name === route.name)) return false;
    const confirmed = normalizeSettings(await saveSettings(next));
    const saved = confirmed.models.routes.find((entry) => entry.name === route.name);
    if (!saved) return false;
    settings = { ...settings, models: { ...settings.models, routes: withRoute(saved) } };
    return true;
  });
  settingsWriteQueue = write.then(() => undefined, () => undefined);
  return write.catch(() => false);
}
