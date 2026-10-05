import { normalizeAppearance, DEFAULT_APPEARANCE, type Appearance } from "./appearance.ts";
import { DEFAULT_TERMINAL_FONT, normalizeTerminalFont } from "./terminal-font.ts";
import { normalizeThemeMode, type ThemeMode } from "./theme.ts";

/** The whole of what the app remembers. Written to `~/.config/hui/settings.json`
 * as flat, hand-editable JSON, and normalised on the way in and out so a stale
 * or hand-edited file can never put an unknown value into CSS. */
export type Settings = {
  /** Theme id. Empty means "whatever the first available theme is". */
  theme: string;
  themeMode: ThemeMode;
  /** Empty inherits the active theme. Otherwise a validated #rrggbb override. */
  accent: string;
  fontUi: Appearance["fontUi"];
  fontChat: Appearance["fontChat"];
  fontTerminal: string;
  textScale: Appearance["textScale"];
  chat: {
    messageWidth: "compact" | "comfortable" | "wide";
    collapseTaskProgress: boolean;
    sendShortcut: "enter" | "modifierEnter";
    /** Unfurl GitHub repositories, pull requests and issues after chat messages. */
    githubEmbeds: boolean;
  };
  profileName: string;
  profileHandle: string;
  /** Prefix for branches created by New Session worktrees. Always ends in `/`. */
  branchPrefix: string;
  /** Settings → Tools → Browser: HUI's managed, agent-only browser profile. */
  browser: BrowserSettings;
  /** Settings → Gateway → Power (macOS). Lid-close prevention is deliberately not
   * saved: it lasts one gateway run (`/__hui/power`). */
  power: {
    /** Prevent idle sleep while the gateway runs, like `caffeinate -i`. */
    keepAwake: boolean;
  };
  /** Settings → Integrations → VoiceStudio. A bot chat's voice note lands in the
   * composer for review unless this sends it at once (marked `[voice] `). The
   * connection itself is the gateway's (`/__hui/voice`). */
  voice: { sendNotesImmediately: boolean };
  /** HUI-owned model routing. Empty values inherit PI's configured default. */
  models: {
    primary: string;
    fallback: string;
    utility: string;
  };
  /** PI skills hidden from HUI-owned runtimes without changing PI's installation. */
  disabledSkills: readonly { name: string; path: string }[];
  /** PI packages/extensions excluded before HUI's SDK worker discovers resources. */
  disabledPlugins: readonly { id: string; name: string; kind: "package" | "extension" }[];
  labs: { denseObservability: boolean; detailedDebug: boolean };
  /** Settings → Sessions → Bots. The sidebar's Sessions | Bots tab strip is
   * opt-in, so a machine that never asks for it keeps today's sidebar; hiding
   * the tab never stops bots or their routines, which the gateway owns. */
  bots: { showTab: boolean };
};

export type BrowserSettings = {
  /** Offer the agent `browser` tool; off also refuses calls from running sessions. */
  enabled: boolean;
  /** No window, Dock icon or focus change. Off shows a visible browser window. */
  headless: boolean;
  /** Absolute Chromium-family executable. Empty auto-detects Chrome, Brave, Edge or Chromium. */
  executablePath: string;
};

export const DEFAULT_BRANCH_PREFIX = "feature/";
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { enabled: true, headless: true, executablePath: "" };

export const DEFAULT_SETTINGS: Settings = {
  theme: "claw",
  themeMode: "system",
  accent: "",
  fontUi: DEFAULT_APPEARANCE.fontUi,
  fontChat: DEFAULT_APPEARANCE.fontChat,
  fontTerminal: DEFAULT_TERMINAL_FONT,
  textScale: DEFAULT_APPEARANCE.textScale,
  chat: {
    messageWidth: "comfortable",
    collapseTaskProgress: false,
    sendShortcut: "enter",
    githubEmbeds: true,
  },
  profileName: "HUI Operator",
  profileHandle: "",
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  browser: DEFAULT_BROWSER_SETTINGS,
  power: { keepAwake: true },
  voice: { sendNotesImmediately: false },
  models: { primary: "", fallback: "", utility: "" },
  disabledSkills: [],
  disabledPlugins: [],
  labs: { denseObservability: false, detailedDebug: false },
  bots: { showTab: false },
};

export function normalizeSettings(raw: unknown): Settings {
  const source = isRecord(raw) ? raw : {};
  const appearance = normalizeAppearance(source["fontUi"], source["fontChat"], source["textScale"]);
  const theme = source["theme"];
  const normalizedTheme = typeof theme === "string" ? theme.trim() : "";
  return {
    theme: normalizedTheme || DEFAULT_SETTINGS.theme,
    themeMode: normalizeThemeMode(source["themeMode"]),
    accent: normalizeAccent(source["accent"]),
    fontUi: appearance.fontUi,
    fontChat: appearance.fontChat,
    fontTerminal: normalizeTerminalFont(source["fontTerminal"]),
    textScale: appearance.textScale,
    chat: normalizeChat(source["chat"]),
    profileName: boundedText(source["profileName"], DEFAULT_SETTINGS.profileName, 80),
    profileHandle: boundedText(source["profileHandle"], "", 80),
    branchPrefix: normalizeBranchPrefix(source["branchPrefix"]),
    browser: normalizeBrowserSettings(source["browser"]),
    power: normalizePower(source["power"]),
    voice: { sendNotesImmediately: isRecord(source["voice"]) && source["voice"]["sendNotesImmediately"] === true },
    models: normalizeModels(source["models"]),
    disabledSkills: normalizeDisabledSkills(source["disabledSkills"]),
    disabledPlugins: normalizeDisabledPlugins(source["disabledPlugins"]),
    labs: normalizeLabs(source["labs"]),
    bots: normalizeBots(source["bots"]),
  };
}

/** Opt-in: only an explicit true shows the Bots tab. */
function normalizeBots(value: unknown): Settings["bots"] {
  return { showTab: isRecord(value) && value["showTab"] === true };
}

/** Both switches are opt-out: only an explicit false changes the default. The
 * path is kept as typed (bounded, no control characters); the gateway validates
 * and reports it rather than guessing. */
export function normalizeBrowserSettings(value: unknown): BrowserSettings {
  const source = isRecord(value) ? value : {};
  const path = typeof source["executablePath"] === "string" ? source["executablePath"].trim() : "";
  return {
    enabled: source["enabled"] !== false,
    headless: source["headless"] !== false,
    executablePath: path.length <= 4_096 && !/[\p{Cc}]/u.test(path) ? path : "",
  };
}

/** Opt-out: only an explicit false lets the Mac idle-sleep. */
function normalizePower(value: unknown): Settings["power"] {
  return { keepAwake: !(isRecord(value) && value["keepAwake"] === false) };
}

function normalizeModelRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const ref = value.trim();
  return ref.length <= 200 && /^[^/\s]+\/\S+$/u.test(ref) ? ref : "";
}

function normalizeModels(value: unknown): Settings["models"] {
  const source = isRecord(value) ? value : {};
  return {
    primary: normalizeModelRef(source["primary"]),
    fallback: normalizeModelRef(source["fallback"]),
    utility: normalizeModelRef(source["utility"]),
  };
}

function normalizeDisabledPlugins(value: unknown): Settings["disabledPlugins"] {
  if (!Array.isArray(value)) return [];
  const plugins = new Map<string, Settings["disabledPlugins"][number]>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = boundedText(item["id"], "", 64);
    const name = boundedText(item["name"], "", 200);
    const kind = item["kind"];
    if (!/^[a-f0-9]{24}$/u.test(id) || !name || (kind !== "package" && kind !== "extension")) continue;
    if (!plugins.has(id)) plugins.set(id, { id, name, kind });
    if (plugins.size >= 1_000) break;
  }
  return [...plugins.values()];
}

function normalizeDisabledSkills(value: unknown): Settings["disabledSkills"] {
  if (!Array.isArray(value)) return [];
  const skills = new Map<string, { name: string; path: string }>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = boundedText(item["name"], "", 64);
    const path = boundedText(item["path"], "", 4_096);
    if (!name || !path || /[\p{Cc}]/u.test(path)) continue;
    if (!skills.has(path)) skills.set(path, { name, path });
    if (skills.size >= 1_000) break;
  }
  return [...skills.values()];
}

function normalizeChat(value: unknown): Settings["chat"] {
  const source = isRecord(value) ? value : {};
  const width = source["messageWidth"];
  const shortcut = source["sendShortcut"];
  return {
    messageWidth: width === "compact" || width === "wide" ? width : "comfortable",
    collapseTaskProgress: source["collapseTaskProgress"] === true,
    sendShortcut: shortcut === "modifierEnter" ? shortcut : "enter",
    // Opt-out: only an explicit false disables previews.
    githubEmbeds: source["githubEmbeds"] !== false,
  };
}

/** Keep the configurable part a Git-ref prefix rather than accepting arbitrary
 * command/path syntax. The complete branch still passes git check-ref-format. */
export function normalizeBranchPrefix(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BRANCH_PREFIX;
  const raw = value.trim();
  if (!raw) return DEFAULT_BRANCH_PREFIX;
  const prefix = raw.endsWith("/") ? raw : `${raw}/`;
  if (
    prefix.length > 80 ||
    prefix.startsWith("/") ||
    prefix.includes("//") ||
    prefix.includes("..") ||
    prefix.includes("@{") ||
    /[\\\s~^:?*[\]]/u.test(prefix)
  ) return DEFAULT_BRANCH_PREFIX;
  const parts = prefix.slice(0, -1).split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) {
    return DEFAULT_BRANCH_PREFIX;
  }
  return prefix;
}

function normalizeAccent(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maximum);
}

function normalizeLabs(value: unknown): Settings["labs"] {
  const source = isRecord(value) ? value : {};
  return {
    denseObservability: source["denseObservability"] === true,
    detailedDebug: source["detailedDebug"] === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
