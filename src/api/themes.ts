/** Browser client for themes: the list the gateway merges from built-ins and `~/.config/hui/themes/`, one theme's
 * file, and a tweakcn import. Applying a theme is lib/theme/theme-store.ts's job. */
import type { ShadcnTheme } from "../lib/shadcn-theme.ts";
import { fetchJson } from "./request.ts";

const THEMES_URL = "/__hui/themes";
const IMPORT_URL = "/__hui/themes/import";

export type ThemeRef = {
  id: string;
  name: string;
  /** URL served by the backend. */
  url: string;
};

export function fetchThemeList(): Promise<{ themes?: ThemeRef[] }> {
  return fetchJson<{ themes?: ThemeRef[] }>(THEMES_URL);
}

export function fetchThemeFile(theme: ThemeRef): Promise<ShadcnTheme> {
  return fetchJson<ShadcnTheme>(theme.url);
}

export function postThemeImport(url: string): Promise<{ id?: string; themes?: ThemeRef[] }> {
  return fetchJson<{ id?: string; themes?: ThemeRef[] }>(IMPORT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}
