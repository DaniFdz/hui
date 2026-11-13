/**
 * Adopting the look `hui doctor --fix` exported for HUI's desktop app: the theme, color mode, accent, typefaces,
 * terminal font and text size an older settings.json held, written to `desktop-appearance.json` on the gateway's
 * machine. The shell hands it over once, and it applies to a device that stored no appearance of its own — never over
 * a choice the operator made here — and is marked consumed so a later launch cannot re-apply it.
 *
 * Only the look is read from the seed: the chat preferences are habits, not how a screen looks, and stay out of it.
 */
import { hasStoredAppearance, saveAppearance, type AppearanceStorage, type DeviceAppearance } from "./store.ts";

/** The seed's body, as the shell reads it from the gateway's config directory. */
export type AppearanceSeed = { appearance?: unknown };

/** What the desktop preload exposes. A browser has no shell, and nothing happens there. */
export type AppearanceSeedBridge = {
  appearanceSeed?(): Promise<unknown>;
  markAppearanceSeedConsumed?(): void;
};

const LOOK_KEYS = ["theme", "themeMode", "accent", "fontUi", "fontChat", "fontTerminal", "textScale"] as const;

function bridge(): AppearanceSeedBridge | undefined {
  return (globalThis as { huiDesktop?: AppearanceSeedBridge }).huiDesktop;
}

/** The look a seed names, or nothing when it names none: a seed's chat block, or anything else, is ignored. */
export function seededLook(seed: unknown): Partial<DeviceAppearance> | undefined {
  const appearance = seed && typeof seed === "object" ? (seed as { appearance?: unknown }).appearance : undefined;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) return undefined;
  const source = appearance as Record<string, unknown>;
  const look: Record<string, unknown> = {};
  for (const key of LOOK_KEYS) if (key in source) look[key] = source[key];
  return Object.keys(look).length ? look as Partial<DeviceAppearance> : undefined;
}

/**
 * Applies the exported look to a device that stored nothing, and says whether it did. A shell that offers no seed, a
 * device that already chose, a seed that names no look and a storage that refuses the write all leave the device as
 * it was — and the seed unconsumed, so a later launch may still use it.
 */
export async function adoptAppearanceSeed(
  storage: AppearanceStorage | undefined = undefined,
  shell: AppearanceSeedBridge | undefined = bridge(),
): Promise<boolean> {
  if (!shell?.appearanceSeed) return false;
  if (hasStoredAppearance(storage)) return false;
  let seed: unknown;
  try {
    seed = await shell.appearanceSeed();
  } catch {
    return false;
  }
  const look = seededLook(seed);
  if (!look) return false;
  if (!saveAppearance(look, storage)) return false;
  try {
    shell.markAppearanceSeedConsumed?.();
  } catch {
    // Unmarked, the seed still cannot override the choice this device now holds.
  }
  return true;
}
