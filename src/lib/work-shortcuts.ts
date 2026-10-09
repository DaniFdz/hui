/**
 * The Work pane's keyboard shortcuts in one table, and the chords the scheme stays clear of. Every Work pane binding is
 * `Mod+Alt+Shift` (⌥⇧⌘ on Apple platforms, Ctrl+Alt+Shift elsewhere) plus the initial of what it opens. The plain
 * ⌥⌘/Ctrl+Alt letters are taken: Apple's standard keys (⌥⌘T toolbar, ⌥⌘F search field, ⌥⌘V apply style, ⌥⌘W close
 * all windows), browser menus (⌥⌘B bookmarks, ⌥⌘F web search) and desktops (Ctrl+Alt+T opens GNOME's terminal before
 * the page sees it). With Shift added only two letters are standard on macOS (⌥⇧⌘Q, ⌥⇧⌘V), none on the Linux desktops,
 * and neither terminals nor CodeMirror bind Ctrl+Alt+Shift letters. The views own their actions; this module owns
 * which keys they answer to. SPEC.md (Work pane) lists the sources for the avoided chords.
 */
import { shortcutChord } from "./shortcut-binding.ts";

/** Binding per Work pane action. View kinds read their entry; tests check the whole table against `AVOIDED_SHORTCUTS`. */
export const WORK_SHORTCUTS = {
  /** Show or hide the Work pane: P for pane (W is Safari's Close All Windows with or without Shift). */
  togglePane: "Mod+Alt+Shift+KeyP",
  terminal: "Mod+Alt+Shift+KeyT",
  browser: "Mod+Alt+Shift+KeyB",
  files: "Mod+Alt+Shift+KeyF",
  /** C for Code: ⌥⇧⌘V is Paste and Match Style in every Mac browser. */
  vscode: "Mod+Alt+Shift+KeyC",
} as const;

export type AvoidedShortcut = {
  /** `shortcutChord` form: `Meta+Alt+KeyW` on Apple platforms, `Control+Alt+KeyT` elsewhere. */
  chord: string;
  platform: "apple" | "other";
  /** Who takes it, and what pressing it there does. */
  taken: string;
};

const apple = (chord: string, taken: string): AvoidedShortcut => ({ chord, platform: "apple", taken });
const other = (chord: string, taken: string): AvoidedShortcut => ({ chord, platform: "other", taken });

/** Chords a Work pane binding must never use: the browser, desktop or HUI acts on them first or instead. */
export const AVOIDED_SHORTCUTS: readonly AvoidedShortcut[] = [
  // Apple's standard keys (Human Interface Guidelines, Keyboards), which Safari and most Mac apps follow.
  apple("Meta+Alt+KeyC", "macOS: copy style"),
  apple("Meta+Alt+KeyD", "macOS: show or hide the Dock"),
  apple("Meta+Alt+KeyF", "macOS: jump to the search field; Chrome: search the web; Firefox: focus web search"),
  apple("Meta+Alt+KeyH", "macOS: hide other apps"),
  apple("Meta+Alt+KeyI", "macOS: inspector; Chrome, Safari and Firefox: developer tools"),
  apple("Meta+Alt+KeyM", "macOS: minimize all windows"),
  apple("Meta+Alt+KeyT", "macOS: show or hide the toolbar"),
  apple("Meta+Alt+KeyV", "macOS: apply style"),
  apple("Meta+Alt+KeyW", "macOS: close all windows; Safari: Close Other Tabs"),
  apple("Meta+Alt+Shift+KeyQ", "macOS: log out without confirmation"),
  apple("Meta+Alt+Shift+KeyV", "macOS, Chrome, Safari and Firefox: Paste and Match Style"),
  apple("Meta+Alt+Escape", "macOS: Force Quit"),
  apple("Meta+Alt+Space", "macOS: Spotlight results window"),
  // Browser menus and developer tools.
  apple("Meta+Alt+KeyB", "Chrome: Bookmark Manager; Safari: Edit Bookmarks"),
  apple("Meta+Alt+KeyJ", "Chrome and Firefox: JavaScript console"),
  apple("Meta+Alt+KeyU", "Chrome, Safari and Firefox: page source"),
  apple("Meta+Alt+KeyL", "Safari: downloads"),
  apple("Meta+Alt+KeyR", "Firefox: Reader View"),
  apple("Meta+Alt+KeyK", "Firefox: web console"),
  apple("Meta+Alt+KeyE", "Firefox: network monitor"),
  apple("Meta+Alt+KeyZ", "Firefox: debugger"),
  apple("Meta+Alt+KeyP", "Chrome: page setup"),
  apple("Meta+Alt+KeyN", "Chrome: split view"),
  apple("Meta+Alt+ArrowLeft", "Chrome: previous tab (reserved: never reaches the page)"),
  apple("Meta+Alt+ArrowRight", "Chrome: next tab (reserved: never reaches the page)"),
  apple("Meta+Alt+Shift+KeyI", "Chrome: feedback form; Firefox: Browser Toolbox"),
  apple("Meta+Alt+Shift+BracketRight", "Firefox: picture-in-picture"),
  // Linux desktops and browsers. On Windows, Ctrl+Alt is AltGr on many layouts; matchesShortcut lets those presses type.
  other("Control+Alt+KeyT", "GNOME/Ubuntu and Xfce: open a terminal (the desktop takes it before the page)"),
  other("Control+Alt+KeyL", "KDE Plasma and Xfce: lock the screen"),
  other("Control+Alt+KeyD", "Xfce: show the desktop"),
  other("Control+Alt+Delete", "GNOME: power off dialog; Windows: security screen"),
  other("Control+Alt+Escape", "GNOME: switch desktop controls; KDE Plasma: kill a window"),
  other("Control+Alt+Tab", "GNOME: switch desktop controls"),
  other("Control+Alt+KeyR", "Firefox: Reader View"),
  other("Control+Alt+KeyX", "Firefox: AI chatbot sidebar"),
  other("Control+Alt+KeyZ", "Firefox: toggle the sidebar"),
  other("Control+Alt+Shift+KeyR", "GNOME: screen recording"),
  other("Control+Alt+Shift+KeyI", "Firefox: Browser Toolbox"),
  // HUI's own shortcuts.
  apple("Meta+KeyK", "HUI: command palette"),
  other("Control+KeyK", "HUI: command palette"),
  apple("Meta+Shift+Comma", "HUI: bot settings"),
  other("Control+Shift+Comma", "HUI: bot settings"),
  // CodeMirror (the Files editor) default keymap.
  apple("Meta+Alt+KeyG", "CodeMirror: go to line"),
  other("Control+Alt+KeyG", "CodeMirror: go to line"),
  apple("Meta+Alt+Backslash", "CodeMirror: indent selection"),
  other("Control+Alt+Backslash", "CodeMirror: indent selection"),
];

/** What already takes `binding` on that platform, or undefined when a Work pane shortcut may use it. */
export function avoidedShortcut(binding: string, isApplePlatform: boolean): AvoidedShortcut | undefined {
  const chord = shortcutChord(binding, isApplePlatform);
  const platform = isApplePlatform ? "apple" : "other";
  return AVOIDED_SHORTCUTS.find((entry) => entry.platform === platform && entry.chord === chord);
}
