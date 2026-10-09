# Work pane journey

Verified on 2026-10-09 with the visual-verification launcher (isolated HUI and PI
state, deterministic provider fixture, real PI Durable runtime, gateway-owned
PTYs and HUI's managed headless browser), driven through the Browser tool in an
owned headless Brave tab. The full journey ran on commit `e753736`; the
screenshots were captured again on `d79d693` (which only changes which launchers
the narrow selector lists), repeating the empty state, terminal and browser
views, **+** menu, collapsed rail and 390×844 steps. Both runs had a clean tree
and `doctor` passed before and after; this file was written afterwards.
Screenshots stay outside Git and go into the PR description.

## Reproduction

1. `npm ci`, then without the agent shell's proxy
   (`env -u NODE_USE_ENV_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy`)
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`
   and `doctor --receipt <receipt>`.
2. Open the receipt's `browserUrl` at 1440×900. On New Session set the working
   directory to the receipt's `workspace` and send `E2E_RICH`.
3. Exercise the pane as below, then send `E2E_BROWSER` for the browser view.
4. Resize to 390×844 and use the panel selector.
5. For the migration, open `/__hui/health` in the same tab (same origin, no app
   running that could rewrite storage), write a pre-Work-pane layout to
   `localStorage["hui.chat-split-layout.v1"]` with a terminal pane and a hidden
   `browser: true` tab, remove `hui.work-pane.v1`, then open the session URL.
6. `cleanup --receipt <receipt>`.

## Observed

- A new conversation shows the collapsed rail (one **Show Work pane** button).
  Expanding it shows the empty state: "Open a view beside this conversation.",
  **New terminal** `Ctrl+Alt+T` and **Browser** `Ctrl+Alt+B`, and "`Ctrl+Alt+W`
  shows or hides this pane."; focus moves to the first launcher.
- `Ctrl+Alt+T` opened a "Terminal 1" tab in the workspace, "Shared · Connected",
  with keyboard focus in the terminal; typed `echo work-pane-ok; ls` printed its
  output. The chat composer kept working beside it.
- After `E2E_BROWSER` the agent's real browser calls finished ("The headless
  browser rendered: **Hello, HUI agent!…**"). The inline preview's **Open browser
  view** opened a "Browser" tab streaming the page ("Live · headless", watched-tab
  picker); the conversation header gained the globe button.
- The **+** menu lists both launchers with their shortcuts. Terminal 1's
  element and PTY were the same after opening the browser view and switching
  tabs (a DOM marker set on it survived; status stayed Connected, no replay).
  A second `Ctrl+Alt+T` adds another terminal tab (seen on the pre-commit tree).
- The header's **Open terminal** activated the open terminal tab and the globe
  activated the browser tab instead of adding panes. ArrowLeft/ArrowRight move
  between tabs with automatic activation.
- Escape inside the pane first closed the tab tooltip, then returned focus to
  the chat composer; the session stayed Idle (no abort).
- The resizer took focus on click; ArrowLeft ×2 and Shift+ArrowLeft grew the
  pane 560 → 664 px, End to 762 px (the row minus 420 px for the chat), Home to
  320 px; the width persisted in `hui.work-pane.v1`.
- **Hide Work pane** collapsed it to the rail (expand, Terminal 1 marked
  current, Browser) with focus on **Show Work pane**; the views stayed mounted.
  A rail view button reopened the pane on that view; `Ctrl+Alt+W` hid it (focus
  to the composer) and showed it again (focus on the active tab).
- With a second conversation split beside the first, focusing either chat pane
  switched the Work pane between that conversation's views (empty and collapsed
  for the new one, its own terminal once launched from the empty state); both
  conversations' terminals stayed mounted across the switches.
- A reload restored the split, the focused conversation's tabs and active view;
  terminals reconnected (Connected). Page errors: 0; console errors: 0.
- Migration: the saved layout loaded as the same two chat columns without the
  terminal and browser panes; the terminal's conversation got a Work pane with
  "Browser" and "Terminal 1" (the focused terminal active, pane expanded), and
  the rewritten layout no longer holds `terminalId` or `browser`.
- 390×844: the panel selector lists "Chat", "Terminal 1 · Work", "Browser ·
  Work" and the launcher "New terminal · Open" (the browser launcher is left out
  while its view is open). Choosing the terminal showed the full-screen
  destination with Back to chat, the tab strip, **+**, the terminal and its key
  row; no horizontal overflow (document width 390). **Back to chat**,
  `Ctrl+Alt+W` and Escape return to the chat.

## Limits

- Pointer dragging of the resizer and of tabs (reorder) was not driven: the
  Browser tool here offers coordinate clicks but no coordinate drag. Keyboard
  resize and tab movement were verified; reorder logic is unit-tested.
- The journey above pressed the first scheme's chords (`Ctrl+Alt+T/B/W`). They
  have since moved to `Ctrl+Alt+Shift+T/B/P` (⌥⇧⌘ on macOS) because GNOME takes
  `Ctrl+Alt+T` before the page sees it and macOS, Safari and Chrome take
  ⌥⌘T/⌥⌘W/⌥⌘B (SPEC.md, *Work pane shortcuts*); read the steps with the new
  chords. The new ones were pressed again on the integrated stack (Files and VS
  Code), whose journey records them. macOS and the Electron window were not run
  here (Linux headless browser).
- A theme switch does not recolour an already-open terminal's background (it is
  read when the terminal starts); this predates the Work pane.
