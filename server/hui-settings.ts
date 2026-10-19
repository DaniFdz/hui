/**
 * HUI's own settings file in its config directory: reading and writing it, always normalized, and whether bots are on.
 * A missing or malformed file reads as the defaults instead of an error.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { botsEnabled, normalizeSettings, type Settings } from "../src/lib/settings.ts";
import { CONFIG_DIR } from "./paths.ts";

export const HUI_SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export async function readHuiSettingsAt(path: string): Promise<Settings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return normalizeSettings(undefined);
  }
}

export function readHuiSettings(): Promise<Settings> {
  return readHuiSettingsAt(HUI_SETTINGS_FILE);
}

/** Settings → Labs → Bots, read at each use, so turning bots on or off applies without a restart. */
export async function botsOn(): Promise<boolean> {
  return botsEnabled(await readHuiSettings());
}

export async function writeHuiSettings(raw: unknown): Promise<Settings> {
  const settings = normalizeSettings(raw);
  await writeFile(HUI_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}
