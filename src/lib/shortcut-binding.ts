/**
 * Keyboard bindings written as `Mod+Alt+Shift+KeyT`: matching a keydown against one and showing it as text. `Mod` is
 * ⌘ on Apple platforms and Ctrl elsewhere; the key part is a physical `KeyboardEvent.code`, so layouts that type
 * another character with Alt still match. Which bindings exist belongs to their owners (the Work pane's table in
 * `work-shortcuts.ts`).
 */

export type ShortcutEvent = Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "defaultPrevented" | "isComposing" | "metaKey" | "repeat" | "shiftKey"> & {
  key?: string;
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

/** Off Apple platforms, on layouts with AltGr, Windows reports AltGr as Ctrl+Alt and Ctrl+Alt as AltGr. A press that
 * types a character there (€ for AltGr+E on a Spanish layout) is text; one that types nothing is still a shortcut. */
function typesCharacter(event: ShortcutEvent, code: string): boolean {
  if (event.key === undefined || event.key === "Dead") return true;
  return [...event.key].length === 1 && event.key.toLocaleLowerCase() !== keyLabel(code).toLocaleLowerCase();
}

/** True when `event` presses exactly `binding`. AltGr presses that type a character never match. */
export function matchesShortcut(event: ShortcutEvent, binding: string, isApplePlatform = APPLE_PLATFORM): boolean {
  const parsed = parseBinding(binding);
  if (!parsed || event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.code !== parsed.code || event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) return false;
  if (!isApplePlatform && event.getModifierState?.("AltGraph") && typesCharacter(event, parsed.code)) return false;
  const mod = isApplePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return parsed.mod ? mod : !event.metaKey && !event.ctrlKey;
}

const KEY_LABELS: Record<string, string> = {
  Backslash: "\\", BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Quote: "'", Semicolon: ";", Backquote: "`",
};

function keyLabel(code: string): string {
  return KEY_LABELS[code] ?? code.replace(/^Key|^Digit/u, "");
}

/** `⌥⇧⌘T` on Apple platforms (Apple's ⌃⌥⇧⌘ order), `Ctrl+Alt+Shift+T` elsewhere. */
export function formatShortcut(binding: string, isApplePlatform = APPLE_PLATFORM): string {
  const parsed = parseBinding(binding);
  if (!parsed) return binding;
  if (isApplePlatform) return `${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${parsed.mod ? "⌘" : ""}${keyLabel(parsed.code)}`;
  return [parsed.mod ? "Ctrl" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", keyLabel(parsed.code)].filter(Boolean).join("+");
}

/** The physical chord `binding` asks for on a platform, as `Meta+Alt+Shift+KeyT` (Control instead of Meta off Apple
 * platforms): two bindings clash on a platform exactly when their chords are equal. */
export function shortcutChord(binding: string, isApplePlatform = APPLE_PLATFORM): string {
  const parsed = parseBinding(binding);
  if (!parsed) return "";
  return [parsed.mod ? isApplePlatform ? "Meta" : "Control" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", parsed.code].filter(Boolean).join("+");
}

/** The `aria-keyshortcuts` value for `binding`. */
export function ariaShortcut(binding: string, isApplePlatform = APPLE_PLATFORM): string {
  const parsed = parseBinding(binding);
  if (!parsed) return "";
  return [parsed.mod ? isApplePlatform ? "Meta" : "Control" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", keyLabel(parsed.code)].filter(Boolean).join("+");
}
