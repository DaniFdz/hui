/**
 * Shape, defaults and normalisation of HUI's user settings. Every value passes through here on the way in and
 * out, so a stale or hand-edited file degrades to defaults instead of reaching CSS or the gateway. Loading
 * and saving them through the gateway is `settings-store.ts`'s job.
 */
import { DEFAULT_GPT_LIVE_VOICE, gptLiveVoice, type GptLiveVoice } from "../../shared/calls.ts";
import { normalizeAppearance, DEFAULT_APPEARANCE, type Appearance } from "./appearance.ts";
import { DEFAULT_TERMINAL_FONT, normalizeTerminalFont } from "./terminal-font.ts";
import { normalizeThemeMode, type ThemeMode } from "./theme.ts";
import type { VscodeProviderPreference } from "../../shared/vscode.ts";

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
  /** Settings → Tools → VS Code: how the Work pane's VS Code view runs VS Code on this machine. */
  vscode: VscodeSettings;
  /** Settings → Gateway → Power (macOS). Lid-close prevention is deliberately not
   * saved: it lasts one gateway run (`/__hui/power`). */
  power: {
    /** Prevent idle sleep while the gateway runs, like `caffeinate -i`. */
    keepAwake: boolean;
  };
  /** HUI-owned model routing. Empty values inherit PI's configured default. */
  models: {
    primary: string;
    fallback: string;
    utility: string;
  };
  /** Settings → Models → Calls: calls with bots talk through GPT-Live over the ChatGPT login saved in Settings → Models.
   * `voice` is the GPT-Live voice of a bot that has none of its own. */
  calls: { voice: GptLiveVoice };
  /** PI skills hidden from HUI-owned runtimes without changing PI's installation. */
  disabledSkills: readonly { name: string; path: string }[];
  /** PI packages/extensions excluded before HUI's SDK worker discovers resources. */
  disabledPlugins: readonly { id: string; name: string; kind: "package" | "extension" }[];
  labs: {
    denseObservability: boolean;
    detailedDebug: boolean;
    /** Settings → Labs → Bots, the one switch for bots (HUI-18), a preview: off until the operator turns it on. On, the
     * sidebar gets its Agents | Bots switch. Off, bots are dormant everywhere: the gateway refuses their routes and
     * calls, skips their routines and starts none of their turns, and no screen shows them. Nothing is deleted, and
     * turning it on brings them back as they were, without a restart. */
    bots: boolean;
  };
};

export type BrowserSettings = {
  /** Offer the agent `browser` tool; off also refuses calls from running sessions. */
  enabled: boolean;
  /** No window, Dock icon or focus change. Off shows a visible browser window. */
  headless: boolean;
  /** Absolute Chromium-family executable. Empty auto-detects Chrome, Brave, Edge or Chromium. */
  executablePath: string;
};

/** Which VS Code the view runs: `auto` takes the first that can run, in the order of the other values. */
export type { VscodeProviderPreference };

export type VscodeSettings = {
  /** The opt-in switch of the first VS Code view. Kept as saved so an older HUI reading this file still works; it no
   * longer gates anything (the launcher is always there and nothing starts before it is used). */
  enabled: boolean;
  /** Absolute VS Code server (or VS Code `code` CLI) executable. Empty finds one. */
  executable: string;
  provider: VscodeProviderPreference;
  /** When the operator accepted Microsoft's VS Code Server license for `code serve-web`, ISO time; empty: not
   * accepted, and HUI never runs serve-web. */
  licenseAcceptedAt: string;
};

export const DEFAULT_BRANCH_PREFIX = "feature/";
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { enabled: true, headless: true, executablePath: "" };
export const DEFAULT_VSCODE_SETTINGS: VscodeSettings = { enabled: false, executable: "", provider: "auto", licenseAcceptedAt: "" };
const VSCODE_PROVIDERS: readonly VscodeProviderPreference[] = ["auto", "configured", "desktop", "managed", "path"];

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
  vscode: DEFAULT_VSCODE_SETTINGS,
  power: { keepAwake: true },
  models: { primary: "", fallback: "", utility: "" },
  calls: { voice: DEFAULT_GPT_LIVE_VOICE },
  disabledSkills: [],
  disabledPlugins: [],
  labs: { denseObservability: false, detailedDebug: false, bots: false },
};

/** Settings → Labs → Bots: whether bots exist at all, on the gateway and on every screen (the sidebar's Agents | Bots
 * switch included). */
export function botsEnabled(settings: Pick<Settings, "labs">): boolean {
  return settings.labs.bots;
}

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
    vscode: normalizeVscodeSettings(source["vscode"]),
    power: normalizePower(source["power"]),
    // VoiceStudio's `voice` (its voice-notes switch) is not read either: the next save leaves it out.
    models: normalizeModels(source["models"]),
    calls: normalizeCalls(source["calls"]),
    disabledSkills: normalizeDisabledSkills(source["disabledSkills"]),
    disabledPlugins: normalizeDisabledPlugins(source["disabledPlugins"]),
    labs: normalizeLabs(source["labs"], source["bots"]),
  };
}

/** An unknown voice is GPT-Live's default. A file saved while VoiceStudio could run calls also holds an `engine` here:
 * it is not read, so the next save leaves it out. */
export function normalizeCalls(value: unknown): Settings["calls"] {
  const source = isRecord(value) ? value : {};
  return { voice: gptLiveVoice(source["voice"]) ?? DEFAULT_GPT_LIVE_VOICE };
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

/** Opt-in: only an explicit true turns the VS Code view on. The path is kept as typed, like the browser's; the gateway
 * validates it and reports what it found. */
export function normalizeVscodeSettings(value: unknown): VscodeSettings {
  const source = isRecord(value) ? value : {};
  const path = typeof source["executable"] === "string" ? source["executable"].trim() : "";
  const provider = VSCODE_PROVIDERS.find((value) => value === source["provider"]) ?? "auto";
  const accepted = typeof source["licenseAcceptedAt"] === "string" ? source["licenseAcceptedAt"].trim() : "";
  return {
    enabled: source["enabled"] === true,
    executable: path.length <= 4_096 && !/[\p{Cc}]/u.test(path) ? path : "",
    provider,
    licenseAcceptedAt: accepted.length <= 64 && !Number.isNaN(Date.parse(accepted)) ? accepted : "",
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

/** Every Labs flag is opt-in: only an explicit true turns one on. Bots also stay on for a file from before Labs →
 * Bots that had Settings → Sessions → Show the Bots tab on (`bots.showTab`, `legacyBots` here) while it has no
 * `labs.bots`: an operator who had the tab keeps bots. The next save writes only `labs.bots`. */
function normalizeLabs(value: unknown, legacyBots: unknown): Settings["labs"] {
  const source = isRecord(value) ? value : {};
  return {
    denseObservability: source["denseObservability"] === true,
    detailedDebug: source["detailedDebug"] === true,
    bots: source["bots"] === true || (source["bots"] === undefined && isRecord(legacyBots) && legacyBots["showTab"] === true),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
