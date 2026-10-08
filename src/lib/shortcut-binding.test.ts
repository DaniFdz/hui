import assert from "node:assert/strict";
import test from "node:test";
import { ariaShortcut, formatShortcut, matchesShortcut, type ShortcutEvent } from "./shortcut-binding.ts";

const press = (code: string, modifiers: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, repeat: false, ...modifiers,
});

test("Mod is Command on Apple platforms and Ctrl elsewhere; the key matches by position", () => {
  assert.equal(matchesShortcut(press("KeyT", { metaKey: true, altKey: true }), "Mod+Alt+KeyT", true), true);
  assert.equal(matchesShortcut(press("KeyT", { ctrlKey: true, altKey: true }), "Mod+Alt+KeyT", true), false);
  assert.equal(matchesShortcut(press("KeyT", { ctrlKey: true, altKey: true }), "Mod+Alt+KeyT", false), true);
  assert.equal(matchesShortcut(press("KeyT", { metaKey: true, altKey: true }), "Mod+Alt+KeyT", false), false);
  // Exact modifiers only: no extra Shift, no missing Alt, no both Ctrl and Command.
  assert.equal(matchesShortcut(press("KeyT", { metaKey: true, altKey: true, shiftKey: true }), "Mod+Alt+KeyT", true), false);
  assert.equal(matchesShortcut(press("KeyT", { metaKey: true }), "Mod+Alt+KeyT", true), false);
  assert.equal(matchesShortcut(press("KeyT", { metaKey: true, ctrlKey: true, altKey: true }), "Mod+Alt+KeyT", true), false);
  assert.equal(matchesShortcut(press("KeyB", { metaKey: true, altKey: true }), "Mod+Alt+KeyT", true), false);
});

test("AltGr, repeats, composition and handled presses never trigger a shortcut", () => {
  const altGr = press("KeyT", { ctrlKey: true, altKey: true, getModifierState: (key: string) => key === "AltGraph" });
  assert.equal(matchesShortcut(altGr, "Mod+Alt+KeyT", false), false);
  assert.equal(matchesShortcut(press("KeyT", { ctrlKey: true, altKey: true, repeat: true }), "Mod+Alt+KeyT", false), false);
  assert.equal(matchesShortcut(press("KeyT", { ctrlKey: true, altKey: true, isComposing: true }), "Mod+Alt+KeyT", false), false);
  assert.equal(matchesShortcut(press("KeyT", { ctrlKey: true, altKey: true, defaultPrevented: true }), "Mod+Alt+KeyT", false), false);
  assert.equal(matchesShortcut(press("KeyT"), "Hyper+KeyT", false), false, "unknown modifiers never match");
});

test("bindings read as each platform writes them", () => {
  assert.equal(formatShortcut("Mod+Alt+KeyT", true), "⌥⌘T");
  assert.equal(formatShortcut("Mod+Alt+KeyT", false), "Ctrl+Alt+T");
  assert.equal(formatShortcut("Mod+Shift+Comma", true), "⇧⌘,");
  assert.equal(formatShortcut("Mod+Alt+Digit1", false), "Ctrl+Alt+1");
  assert.equal(ariaShortcut("Mod+Alt+KeyW", true), "Meta+Alt+W");
  assert.equal(ariaShortcut("Mod+Alt+KeyW", false), "Control+Alt+W");
});
