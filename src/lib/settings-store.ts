/**
 * Client half of the config directory. The server (see `server/hui.ts`) owns
 * `~/.config/hui`; this talks to it.
 *
 * Every call degrades rather than throws: with the backend unreachable the app
 * runs on defaults from tokens.css and simply does not remember anything.
 */
import { applyAppearance } from "./appearance.ts";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "./settings.ts";
import { trackedFetch } from "./ui-errors.ts";

const SETTINGS_URL = "/__hui/settings";

/** The backend refuses requests without this, which no cross-origin page can
 * set without a preflight. */
export const CLIENT_HEADERS = { "x-hui": "1" } as const;

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

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await trackedFetch(url, {
    ...init,
    headers: { ...CLIENT_HEADERS, ...init?.headers },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    // The backend explains its refusals in the body, and that message is worth
    // more to the user than the status code. The import path relies on this.
    const detail = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(detail?.error ?? `${url} returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadSettings(): Promise<Settings> {
  try {
    settings = normalizeSettings(await fetchJson<unknown>(SETTINGS_URL));
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings);
  applyUiPreferences(settings);
  return settings;
}

/** Resolves once every settings write this screen has started has landed or failed: the gateway has what it shows. */
export function settingsWritten(): Promise<void> {
  return settingsWriteQueue;
}

/** Reads the settings again, for a change another screen made (bots turned off there, say). Unlike `loadSettings`, a
 * failed read changes nothing and resolves undefined. */
export async function refreshSettings(): Promise<Settings | undefined> {
  try {
    settings = normalizeSettings(await fetchJson<unknown>(SETTINGS_URL));
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
  const snapshot = settings;
  const revision = ++settingsRevision;
  applyAppearance(settings);
  applyUiPreferences(settings);
  let written = false;
  const write = settingsWriteQueue.then(async () => {
    const confirmed = normalizeSettings(
      await fetchJson<unknown>(SETTINGS_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      }),
    );
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
