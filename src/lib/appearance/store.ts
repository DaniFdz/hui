/**
 * This device's appearance: the theme, the colour mode, the accent, the typefaces, the text size and the
 * conversation preferences of the screen that shows them. They live in the page's localStorage rather than the
 * gateway's `settings.json`, because one gateway serves many screens and people, and a phone's WebView keeps its
 * own copy per app install. Nothing stored yet reaches these fields: a device starts from HUI's defaults.
 *
 * Reading never throws: absent, unreadable or stale storage reads as the defaults, and every value passes through
 * the validators the Appearance page already uses (`theme/appearance.ts`, `terminal/font.ts`, `theme/theme.ts`).
 */
import { DEFAULT_APPEARANCE, applyAppearance, normalizeAccent, normalizeAppearance, type TextScaleStop, type TypefaceId } from "../theme/appearance.ts";
import { DEFAULT_TERMINAL_FONT, normalizeTerminalFont } from "../terminal/font.ts";
import { normalizeThemeMode, type ThemeMode } from "../theme/theme.ts";

/** Where this device keeps its appearance; `lib/boot-screen.ts` keeps the boot screen's colours beside it. */
export const APPEARANCE_KEY = "hui.appearance.v1";
export const APPEARANCE_VERSION = 1;

export const MESSAGE_WIDTHS = ["compact", "comfortable", "wide"] as const;
export const SEND_SHORTCUTS = ["enter", "modifierEnter"] as const;

export type MessageWidth = (typeof MESSAGE_WIDTHS)[number];
export type SendShortcut = (typeof SEND_SHORTCUTS)[number];

/** What the conversation does with what this device chose. A tool's own mark and icon file stay on the gateway. */
export type ChatAppearance = {
  messageWidth: MessageWidth;
  collapseTaskProgress: boolean;
  sendShortcut: SendShortcut;
  githubEmbeds: boolean;
  datadogEmbeds: boolean;
};

export type DeviceAppearance = {
  theme: string;
  themeMode: ThemeMode;
  accent: string;
  fontUi: TypefaceId;
  fontChat: TypefaceId;
  fontTerminal: string;
  textScale: TextScaleStop;
  chat: ChatAppearance;
};

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  messageWidth: "comfortable",
  collapseTaskProgress: false,
  sendShortcut: "enter",
  // Opt-out: only an explicit false turns the previews off.
  githubEmbeds: true,
  datadogEmbeds: true,
};

export const DEFAULT_DEVICE_APPEARANCE: DeviceAppearance = {
  theme: "claw",
  themeMode: "system",
  accent: "",
  fontUi: DEFAULT_APPEARANCE.fontUi,
  fontChat: DEFAULT_APPEARANCE.fontChat,
  fontTerminal: DEFAULT_TERMINAL_FONT,
  textScale: DEFAULT_APPEARANCE.textScale,
  chat: DEFAULT_CHAT_APPEARANCE,
};

/** The storage this device offers, or nothing when there is none (a server render, or a browser that refuses it). */
export type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeChatAppearance(value: unknown): ChatAppearance {
  const source = isRecord(value) ? value : {};
  const width = MESSAGE_WIDTHS.find((candidate) => candidate === source["messageWidth"]);
  const shortcut = SEND_SHORTCUTS.find((candidate) => candidate === source["sendShortcut"]);
  return {
    messageWidth: width ?? DEFAULT_CHAT_APPEARANCE.messageWidth,
    collapseTaskProgress: source["collapseTaskProgress"] === true,
    sendShortcut: shortcut ?? DEFAULT_CHAT_APPEARANCE.sendShortcut,
    githubEmbeds: source["githubEmbeds"] !== false,
    datadogEmbeds: source["datadogEmbeds"] !== false,
  };
}

/** An unknown theme id is kept: a theme whose file is missing must not lose the choice that names it. */
function normalizeTheme(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  return id || DEFAULT_DEVICE_APPEARANCE.theme;
}

export function normalizeDeviceAppearance(value: unknown): DeviceAppearance {
  const source = isRecord(value) ? value : {};
  const appearance = normalizeAppearance(source["fontUi"], source["fontChat"], source["textScale"]);
  return {
    theme: normalizeTheme(source["theme"]),
    themeMode: normalizeThemeMode(source["themeMode"]),
    accent: normalizeAccent(source["accent"]),
    fontUi: appearance.fontUi,
    fontChat: appearance.fontChat,
    fontTerminal: normalizeTerminalFont(source["fontTerminal"]),
    textScale: appearance.textScale,
    chat: normalizeChatAppearance(source["chat"]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserStorage(): AppearanceStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // A browser that blocks storage throws on the property itself.
    return undefined;
  }
}

/** What this device last chose, or HUI's defaults when it chose nothing yet or the record cannot be read. */
export function readAppearance(storage: AppearanceStorage | undefined = browserStorage()): DeviceAppearance {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(APPEARANCE_KEY) ?? "null");
    // A record written by a newer HUI is not this one's to interpret; defaults are safer than a guess.
    if (!isRecord(raw) || raw["version"] !== APPEARANCE_VERSION) return DEFAULT_DEVICE_APPEARANCE;
    return normalizeDeviceAppearance(raw);
  } catch {
    return DEFAULT_DEVICE_APPEARANCE;
  }
}

/** Whether this device ever stored an appearance: absent, unreadable, or a record that names no field is nothing. */
export function hasStoredAppearance(storage: AppearanceStorage | undefined = browserStorage()): boolean {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(APPEARANCE_KEY) ?? "null");
    if (!isRecord(raw) || raw["version"] !== APPEARANCE_VERSION) return false;
    return Object.keys(DEFAULT_DEVICE_APPEARANCE).some((key) => key in raw);
  } catch {
    return false;
  }
}

/**
 * Saves this device's appearance. A patch merges over what is stored, so a control writes only what it changed.
 * Returns undefined when the write did not land (private mode, a full quota), which lets the page say so rather
 * than pretend the choice was remembered.
 */
export function saveAppearance(
  patch: Partial<DeviceAppearance>,
  storage: AppearanceStorage | undefined = browserStorage(),
): DeviceAppearance | undefined {
  const next = normalizeDeviceAppearance({ ...readAppearance(storage), ...patch });
  try {
    storage?.setItem(APPEARANCE_KEY, JSON.stringify({ version: APPEARANCE_VERSION, ...next }));
  } catch {
    return undefined;
  }
  return next;
}

/**
 * Applies this device's typefaces, text size and conversation preferences, and tells HUI's desktop app the colour
 * mode its window chrome should follow. Colour mode and accent belong to `theme/theme-store.ts`, which applies
 * them against the theme's own tokens.
 */
export function applyDeviceAppearance(value: DeviceAppearance): void {
  const root = document.documentElement;
  root.dataset["chatMessageWidth"] = value.chat.messageWidth;
  root.dataset["chatSendShortcut"] = value.chat.sendShortcut;
  applyAppearance(value);
  reportThemeMode(value.themeMode);
}

/** HUI's desktop app runs this page and follows the mode; a browser has no window chrome of its own to set. */
export function reportThemeMode(mode: ThemeMode): void {
  try {
    (globalThis as { huiDesktop?: { reportThemeMode?: (next: string) => void } }).huiDesktop?.reportThemeMode?.(mode);
  } catch {
    // The shell failing to hear this is not the page's problem.
  }
}
