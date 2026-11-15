/**
 * The look an older HUI kept in the gateway's `settings.json`, written as a seed for HUI's desktop app when
 * `hui doctor --fix` finds one: `{ format: 1, gateway, exportedAt, appearance }`. Only the look travels — theme,
 * color mode, accent, typefaces, terminal font and text size — because the chat preferences beside them are habits,
 * not how a screen looks. The desktop app reads the seed on launch and applies it to a device that stored nothing of
 * its own, then marks it consumed.
 *
 * The validators are the device store's own (`src/lib/appearance/store.ts`), restated here because `cli/` may not
 * import `src/` (rule R2 in docs/map.md); `desktop-appearance-seed.test.ts` fails if the two ever disagree.
 */
import { hostname } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR } from "../server/paths.ts";

export const DESKTOP_APPEARANCE_FILE = join(CONFIG_DIR, "desktop-appearance.json");
export const DESKTOP_APPEARANCE_FORMAT = 1;

const TYPEFACES = [
  "instrument-sans", "geist", "dm-sans", "ibm-plex-sans", "space-grotesk", "atkinson-hyperlegible",
  "fraunces", "lora", "jetbrains-mono", "system",
] as const;
const TEXT_SCALE_STOPS = [90, 100, 110, 125, 140] as const;
const THEME_MODES = ["system", "light", "dark"] as const;
const TERMINAL_FONT = "JetBrains Mono";

export type AppearanceLook = {
  theme: string;
  themeMode: (typeof THEME_MODES)[number];
  accent: string;
  fontUi: (typeof TYPEFACES)[number];
  fontChat: (typeof TYPEFACES)[number];
  fontTerminal: string;
  textScale: (typeof TEXT_SCALE_STOPS)[number];
};

/** What a device shows before anyone chose: exporting this would seed nothing. */
export const DEFAULT_LOOK: AppearanceLook = {
  theme: "claw",
  themeMode: "system",
  accent: "",
  fontUi: "instrument-sans",
  fontChat: "instrument-sans",
  fontTerminal: TERMINAL_FONT,
  textScale: 100,
};

export type DesktopAppearanceSeed = {
  format: typeof DESKTOP_APPEARANCE_FORMAT;
  gateway: string;
  exportedAt: string;
  appearance: AppearanceLook;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeface(value: unknown): (typeof TYPEFACES)[number] {
  return TYPEFACES.find((id) => id === value) ?? DEFAULT_LOOK.fontUi;
}

function accent(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/u.test(normalized) ? normalized : "";
}

function terminalFont(value: unknown): string {
  if (typeof value !== "string") return TERMINAL_FONT;
  const name = value.trim();
  return name.length > 0 && name.length <= 128 && !/[\p{Cc}"'\\;,{}<>]/u.test(name) ? name : TERMINAL_FONT;
}

/** The look a settings file names, normalized; no chat preference is read. */
export function lookFromSettings(raw: unknown): AppearanceLook {
  const source = isRecord(raw) ? raw : {};
  const scale = Number(source["textScale"]);
  const theme = typeof source["theme"] === "string" ? source["theme"].trim() : "";
  return {
    // An unknown theme id is kept, as the device store keeps it: its file may simply be missing.
    theme: theme || DEFAULT_LOOK.theme,
    themeMode: THEME_MODES.find((mode) => mode === source["themeMode"]) ?? DEFAULT_LOOK.themeMode,
    accent: accent(source["accent"]),
    fontUi: typeface(source["fontUi"]),
    fontChat: source["fontChat"] === undefined ? typeface(source["fontUi"]) : typeface(source["fontChat"]),
    fontTerminal: terminalFont(source["fontTerminal"]),
    textScale: TEXT_SCALE_STOPS.find((stop) => stop === scale) ?? DEFAULT_LOOK.textScale,
  };
}

/** Whether the look says anything a fresh device would not already show. */
export function lookIsDefault(look: AppearanceLook): boolean {
  return (Object.keys(DEFAULT_LOOK) as (keyof AppearanceLook)[]).every((key) => look[key] === DEFAULT_LOOK[key]);
}

export function desktopAppearanceSeed(look: AppearanceLook, options: { gatewayName?: string; machineHostname?: string; exportedAt?: Date } = {}): DesktopAppearanceSeed {
  return {
    format: DESKTOP_APPEARANCE_FORMAT,
    // The name this gateway reports on `GET /__hui/health` (server/control-surfaces.ts): its own, or the machine's.
    gateway: (options.gatewayName ?? "").trim() || (options.machineHostname ?? hostname()).trim() || "HUI",
    exportedAt: (options.exportedAt ?? new Date()).toISOString(),
    appearance: look,
  };
}
