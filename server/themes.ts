/**
 * Themes: the built-in ones shipped beside the gateway (`themes/`) merged with the user's in the config directory,
 * where a user theme wins on the same id, and importing a tweakcn theme into the user's. Only files discovered here
 * are ever served, by route key, so a request cannot name a path of its own.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapTheme, type ShadcnTheme } from "../src/lib/shadcn-theme.ts";
import { USER_THEME_DIR } from "./paths.ts";

export const THEME_FILE_ROUTE = "/__hui/themes/file/";

/** Import is the one thing here that reaches the network, so it is tightly
 * bounded: one host, one shape, a size cap and a timeout. */
const TWEAKCN_HOSTS = new Set(["tweakcn.com", "www.tweakcn.com"]);
const TWEAKCN_REGISTRY = "https://tweakcn.com/r/themes/";
const MAX_THEME_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 10_000;
const THEME_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const BUILTIN_THEME_DIR = fileURLToPath(new URL("../themes/", import.meta.url));

type ThemeSource = "builtin" | "user";

export type ThemeEntry = {
  id: string;
  name: string;
  source: ThemeSource;
  /** Filename within the source directory. */
  file: string;
};

type ThemeListing = {
  themes: { id: string; name: string; url: string }[];
  /** Route key -> absolute path. Only files we discovered are ever served, so a
   * request can never name a path of its own. */
  files: Map<string, string>;
};

/** Creating both directories is what gives a fresh install somewhere obvious to
 * drop a theme file. */
export async function ensureConfigDir(): Promise<void> {
  await mkdir(USER_THEME_DIR, { recursive: true });
}

/**
 * A file is a theme if it carries at least one usable mode. Its own `name`
 * labels it, so nothing has to be declared anywhere else.
 */
async function readThemeFile(
  dir: string,
  file: string,
  source: ThemeSource,
): Promise<ThemeEntry | undefined> {
  const id = file.slice(0, -".json".length);
  if (!id) {
    return undefined;
  }
  try {
    const theme = JSON.parse(await readFile(join(dir, file), "utf8")) as ShadcnTheme;
    if (!mapTheme(theme)) {
      return undefined;
    }
    const name = typeof theme.name === "string" && theme.name.trim() ? theme.name.trim() : id;
    return { id, name, source, file };
  } catch {
    // A malformed file is skipped rather than taking the whole list down.
    return undefined;
  }
}

export async function discoverThemes(
  dir: string,
  source: ThemeSource,
): Promise<ThemeEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .toSorted()
      .map((name) => readThemeFile(dir, name, source)),
  );
  return found.filter((entry) => entry !== undefined);
}

/**
 * User themes win on an id collision, which is what makes copying a built-in
 * into the config directory the way to customise one.
 */
export function mergeThemes(
  user: readonly ThemeEntry[],
  builtin: readonly ThemeEntry[],
): ThemeEntry[] {
  const merged: ThemeEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...user, ...builtin]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }
  return merged;
}

export async function listThemes(): Promise<ThemeListing> {
  const [builtin, user] = await Promise.all([
    discoverThemes(BUILTIN_THEME_DIR, "builtin"),
    discoverThemes(USER_THEME_DIR, "user"),
  ]);

  const files = new Map<string, string>();
  const themes: ThemeListing["themes"] = [];
  for (const entry of mergeThemes(user, builtin)) {
    const root = entry.source === "user" ? USER_THEME_DIR : BUILTIN_THEME_DIR;
    const key = `${entry.source}/${entry.file}`;
    files.set(key, join(root, entry.file));
    themes.push({ id: entry.id, name: entry.name, url: `${THEME_FILE_ROUTE}${key}` });
  }
  return { themes, files };
}

/* ── tweakcn import ──────────────────────────────────────────────────────── */

/** Accepts an editor link, a share link, a registry link, a bare theme id, or
 * any of those pasted inside a sentence. */
export function registryUrlFor(input: string): URL {
  // Anything before the link is noise, and a trailing full stop is punctuation.
  const embedded = input.match(/https?:\/\/(?:www\.)?tweakcn\.com\/[^\s<>"')]+/i)?.[0];
  const cleaned = (embedded ?? input).trim().replace(/[.,;:]+$/, "");
  if (!cleaned) {
    throw new Error("Paste a tweakcn theme link or theme id.");
  }
  if (!embedded && THEME_ID.test(cleaned)) {
    return new URL(`${TWEAKCN_REGISTRY}${cleaned}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error("Paste a tweakcn theme link or theme id.");
  }
  if (!TWEAKCN_HOSTS.has(parsed.hostname)) {
    throw new Error("Only tweakcn.com links can be imported.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "editor" && segments[1] === "theme") {
    const editorTheme = parsed.searchParams.get("theme")?.trim() ?? "";
    if (!THEME_ID.test(editorTheme)) {
      throw new Error("That tweakcn editor link does not select a valid theme.");
    }
    return new URL(`${TWEAKCN_REGISTRY}${editorTheme}`);
  }
  const id = segments.at(-1);
  const shaped =
    (segments.length === 2 && segments[0] === "themes") ||
    (segments.length === 3 && segments[0] === "r" && segments[1] === "themes");
  if (!shaped || !id || !THEME_ID.test(id)) {
    throw new Error("That is not a tweakcn theme link.");
  }
  return new URL(`${TWEAKCN_REGISTRY}${id}`);
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("tweakcn returned an empty response.");
  }
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("That theme is too large to import.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** Fetches a tweakcn theme and writes it into the config directory. Returns the
 * id it was stored under. */
export async function importTweakcnTheme(input: string): Promise<string> {
  const url = registryUrlFor(input);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`tweakcn returned HTTP ${response.status} for that theme.`);
  }
  // A redirect is the one way this could be pointed somewhere else.
  if (!TWEAKCN_HOSTS.has(new URL(response.url).hostname)) {
    throw new Error("tweakcn redirected off-site; refusing the import.");
  }

  const item = JSON.parse(await readLimited(response, MAX_THEME_BYTES)) as ShadcnTheme;
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;

  // Stored in the shape we read: both blocks at the top level, no cssVars
  // wrapper, and nothing the app cannot use.
  const stored: ShadcnTheme = { name };
  const light = item.cssVars?.light;
  const dark = item.cssVars?.dark;
  if (light && typeof light === "object") {
    stored.light = light;
  }
  if (dark && typeof dark === "object") {
    stored.dark = dark;
  }
  if (!mapTheme(stored)) {
    throw new Error("That theme has no usable light or dark palette.");
  }

  await ensureConfigDir();
  await writeFile(join(USER_THEME_DIR, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return id;
}
