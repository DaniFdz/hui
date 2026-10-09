import assert from "node:assert/strict";
import test from "node:test";
import { ariaShortcut, formatShortcut, shortcutChord } from "./shortcut-binding.ts";
import { AVOIDED_SHORTCUTS, avoidedShortcut, WORK_SHORTCUTS } from "./work-shortcuts.ts";
import { WORK_PANE_TOGGLE_SHORTCUT } from "./work-pane.ts";
import { BROWSER_WORK_VIEW_SHORTCUT } from "./work-views/browser.ts";
import { FILES_WORK_VIEW_SHORTCUT, filesWorkViewKind } from "./work-views/files.ts";
import { VSCODE_WORK_VIEW_SHORTCUT } from "./work-views/vscode.ts";
import { TERMINAL_WORK_VIEW_SHORTCUT } from "./work-views/terminal.ts";

const bindings = Object.entries(WORK_SHORTCUTS);

test("every Work pane shortcut is Mod+Alt+Shift plus a letter, and no two share one", () => {
  for (const [action, binding] of bindings) assert.match(binding, /^Mod\+Alt\+Shift\+Key[A-Z]$/u, action);
  assert.equal(new Set(bindings.map(([, binding]) => binding)).size, bindings.length);
});

test("no Work pane shortcut uses a chord a browser, desktop, editor or HUI already takes", () => {
  for (const [action, binding] of bindings) {
    for (const apple of [true, false]) {
      const taken = avoidedShortcut(binding, apple);
      assert.equal(taken, undefined, `${action} (${formatShortcut(binding, apple)}) is taken: ${taken?.taken}`);
    }
  }
});

test("the avoided table catches the chords that broke the old Mod+Alt scheme", () => {
  assert.match(avoidedShortcut("Mod+Alt+KeyW", true)?.taken ?? "", /Safari/u);
  assert.match(avoidedShortcut("Mod+Alt+KeyB", true)?.taken ?? "", /Chrome/u);
  assert.match(avoidedShortcut("Mod+Alt+KeyT", false)?.taken ?? "", /GNOME/u);
  assert.match(avoidedShortcut("Mod+Alt+KeyF", true)?.taken ?? "", /search/u);
  assert.match(avoidedShortcut("Mod+Alt+Shift+KeyV", true)?.taken ?? "", /Paste and Match Style/u);
  assert.equal(avoidedShortcut("Mod+Alt+KeyT", true)?.platform, "apple", "each platform is checked against its own chords");
  assert.equal(avoidedShortcut("Mod+Alt+KeyB", false), undefined);
  for (const entry of AVOIDED_SHORTCUTS) assert.match(entry.chord, /^(Meta|Control)(\+Alt)?(\+Shift)?\+[A-Z]\w+$/u, entry.chord);
});

test("the views and the pane toggle read their binding from the table", () => {
  assert.equal(WORK_PANE_TOGGLE_SHORTCUT, WORK_SHORTCUTS.togglePane);
  assert.equal(TERMINAL_WORK_VIEW_SHORTCUT, WORK_SHORTCUTS.terminal);
  assert.equal(BROWSER_WORK_VIEW_SHORTCUT, WORK_SHORTCUTS.browser);
  assert.equal(FILES_WORK_VIEW_SHORTCUT, WORK_SHORTCUTS.files);
  assert.equal(filesWorkViewKind.shortcut, WORK_SHORTCUTS.files);
  assert.equal(VSCODE_WORK_VIEW_SHORTCUT, WORK_SHORTCUTS.vscode);
});

test("the scheme reads as each platform writes it", () => {
  assert.equal(formatShortcut(WORK_SHORTCUTS.terminal, true), "⌥⇧⌘T");
  assert.equal(formatShortcut(WORK_SHORTCUTS.terminal, false), "Ctrl+Alt+Shift+T");
  assert.equal(formatShortcut(WORK_SHORTCUTS.togglePane, true), "⌥⇧⌘P");
  assert.equal(formatShortcut(WORK_SHORTCUTS.files, false), "Ctrl+Alt+Shift+F");
  assert.equal(formatShortcut(WORK_SHORTCUTS.vscode, true), "⌥⇧⌘C");
  assert.equal(ariaShortcut(WORK_SHORTCUTS.browser, true), "Meta+Alt+Shift+B");
  assert.equal(ariaShortcut(WORK_SHORTCUTS.browser, false), "Control+Alt+Shift+B");
  assert.equal(shortcutChord(WORK_SHORTCUTS.browser, false), "Control+Alt+Shift+KeyB");
});
