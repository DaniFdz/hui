/**
 * Read access to HUI's own settings file in its config directory. A missing or malformed file yields the
 * normalized defaults instead of an error.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeSettings, type Settings } from "../src/lib/settings.ts";
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
