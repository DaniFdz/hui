/**
 * Keyboard bindings written as `Mod+Alt+KeyT`: matching a keydown against one and showing it as text. `Mod` is ⌘ on
 * Apple platforms and Ctrl elsewhere; the key part is a physical `KeyboardEvent.code`, so layouts that type another
 * character with Alt still match. Which bindings exist belongs to their owners (the Work pane's launchers).
 */

export type ShortcutEvent = Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "defaultPrevented" | "isComposing" | "metaKey" | "repeat" | "shiftKey"> & {
  getModifierState?: (key: string) => boolean;
};

export const APPLE_PLATFORM = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/u.test(navigator.platform);

type Parsed = { mod: boolean; alt: boolean; shift: boolean; code: string };

function parseBinding(binding: string): Parsed | undefined {
  const parts = binding.split("+");
  const code = parts.pop();
  if (!code) return undefined;
  if (parts.some((part) => part !== "Mod" && part !== "Alt" && part !== "Shift")) return undefined;
  return { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), code };
}

/** True when `event` presses exactly `binding`. Off Apple platforms Windows reports AltGr as Ctrl+Alt; those presses
 * type characters, so they never match. */
export function matchesShortcut(event: ShortcutEvent, binding: string, isApplePlatform = APPLE_PLATFORM): boolean {
  const parsed = parseBinding(binding);
  if (!parsed || event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.code !== parsed.code || event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) return false;
  if (!isApplePlatform && event.getModifierState?.("AltGraph")) return false;
  const mod = isApplePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return parsed.mod ? mod : !event.metaKey && !event.ctrlKey;
}

const KEY_LABELS: Record<string, string> = {
  Backslash: "\\", BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Quote: "'", Semicolon: ";", Backquote: "`",
};

function keyLabel(code: string): string {
  return KEY_LABELS[code] ?? code.replace(/^Key|^Digit/u, "");
}

/** `⌥⌘T` on Apple platforms, `Ctrl+Alt+T` elsewhere. */
export function formatShortcut(binding: string, isApplePlatform = APPLE_PLATFORM): string {
  const parsed = parseBinding(binding);
  if (!parsed) return binding;
  if (isApplePlatform) return `${parsed.shift ? "⇧" : ""}${parsed.alt ? "⌥" : ""}${parsed.mod ? "⌘" : ""}${keyLabel(parsed.code)}`;
  return [parsed.mod ? "Ctrl" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", keyLabel(parsed.code)].filter(Boolean).join("+");
}

/** The `aria-keyshortcuts` value for `binding`. */
export function ariaShortcut(binding: string, isApplePlatform = APPLE_PLATFORM): string {
  const parsed = parseBinding(binding);
  if (!parsed) return "";
  return [parsed.mod ? isApplePlatform ? "Meta" : "Control" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", keyLabel(parsed.code)].filter(Boolean).join("+");
}
