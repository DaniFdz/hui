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

## Integrated stack (terminal, Files, VS Code)

Verified on 2026-10-09 on `feat/vscode-view` at `2d0bd2f` (the Work pane, the
Files view and the VS Code view stacked on the binary terminal stream; that
commit was later amended only to unsubscribe the app from launcher availability
changes when it disconnects, as `f9bd9c9`), clean tree, `doctor` passing before and after, driven through the Browser tool in an
owned headless Brave tab against the real Work pane (no harness). Same launcher
and fixture as above; the receipt's workspace was made a small Git repository
(`src/greet.ts`, `README.md`, `package.json`, one commit), and VS Code used a
real openvscode-server 1.109.5 from
`NIX_CONFIG='experimental-features = nix-command flakes' nix build nixpkgs#openvscode-server --no-link --print-out-paths`.

- **Launchers.** The empty pane and the **+** menu list **New terminal**
  `Ctrl+Alt+T`, **Browser** `Ctrl+Alt+B`, **Files** `Ctrl+Alt+F` and **VS Code**
  `Ctrl+Alt+V`, in that order. With VS Code off (the default) its entry is
  disabled with *VS Code is off. Turn it on in Settings → Tools → VS Code.* under
  it, followed by an **Open Settings → Tools → VS Code** entry; the empty pane
  shows the same reason with the link.
- **Settings link.** The menu entry opened `/settings/tools` with the VS Code
  section at the top of the viewport (`top = 0`) and still there 3.5 s later,
  after the Browser section above it (447 px) had loaded. Saving the
  openvscode-server path read *Using OpenVSCode Server 1.109.5 · <path>*; turning
  the view on read **Ready**. Back in the conversation the **VS Code** launcher
  was enabled without a reload.
- **Terminal.** **New terminal** opened *Terminal 1* in the workspace
  (`Shared · Connected`); a typed `printf` with ANSI colours and
  `ls --color=always` rendered green, blue and red text and a blue `src`.
- **Files.** `Ctrl+Alt+F` (pressed with focus inside the terminal) opened a
  Files tab; opening `src` → `greet.ts` changed the tab caption from *Files* to
  *greet.ts*. Typing a line showed **Saved** within ~2 s and `git diff` held
  exactly that line. Closing the tab removed its
  `hui.files-view.v1:<id>` record and left no `hui.file-draft.v1:` entry.
- **VS Code.** **+** → **VS Code** opened one *VS Code* tab on
  `/tmp/…/workspace/`: Explorer listed `src`, `fixture.txt`, `package.json`,
  `README.md`; `greet.ts` opened with the Files edit and an *M* badge, the status
  bar read `main*`.
- **Kept mounted.** After switching Terminal 1 → greet.ts → VS Code → Terminal 1,
  collapsing the pane to its rail (four buttons: expand plus one per view) and
  reopening it from the rail's VS Code button, the terminal was the same element
  (a marker set on it survived, status Connected, no replay) and the VS Code frame
  the same window (a value set on its `contentWindow` survived, `greet.ts` still
  open).
- **Split chats.** Splitting the chat right gave two 417 px columns and a 342 px
  pane (row 1182 px), with no horizontal scroll. A third column collapsed the pane
  to its 44 px rail with its views still mounted; **Show Work pane** then showed it
  at its 320 px minimum beside three 320 px columns (multiplexer width equals its
  client width). Closing the third column gave the pane its 342 px back. The two
  remaining columns kept the multiplexer's own ratio (514/320 px): the pane
  reserves 420 px per column in total and leaves their split to the multiplexer.
  (Since fixed: the splitter keeps 420 px per column too; see the next section.)
- **390×844.** The panel selector listed *Chat*, *Terminal 1 · Work*,
  *greet.ts · Work*, *VS Code · Work*, then *New terminal*, *Browser* and *Files*
  as launchers (VS Code's launcher left out while its view is open). Choosing
  *greet.ts* showed the full-screen destination with the tab strip and the
  editor at 16 px; document width 390.
- Page errors: 0. Console errors: 2, VS Code's optional `vsda` files
  (`vsda_bg.wasm`, `vsda.js`, 404 in every openvscode-server).

Limits of this run: the managed browser view and Files' conflict, upload and
delete flows were not repeated (see above and `e2e/files-view.browser.md`);
macOS shortcuts and the Electron window were not run; the VS Code frame's own
controls were driven with coordinate clicks.

## Shortcut scheme, chat rebalance and Settings link

Verified on 2026-10-09 on `feat/vscode-view` at `d5115e6` (clean tree, `doctor`
passing before and after; this section was written afterwards), same launcher and
fixture, the workspace a small Git repository, driven through the Browser tool in
an owned headless Brave tab at 1440×900 and 390×844. Keys were sent with the
Browser tool's key presses (CDP), so desktop and browser grabs (GNOME, macOS,
Safari) are not exercised here; SPEC.md, *Work pane shortcuts*, has the research.
A capture-phase `keydown` recorder on `window` read `defaultPrevented` after
each press.

- **Matrix.** Each of `Ctrl+Alt+Shift+T/B/F/C` was pressed with focus in the chat
  composer, inside Terminal 1 and inside the Files editor (`greet.ts`), 12
  presses: every one was `defaultPrevented`, T added a terminal tab, B showed the
  single Browser tab, F added a Files tab, and C (VS Code off) showed *VS Code is
  off. Turn it on in Settings → Tools → VS Code.* with no tab. The composer stayed
  empty and `git status` in the workspace stayed clean (no key reached the
  editor or the file). `Ctrl+Alt+Shift+P` from each of the three hid the pane
  (focus to the composer) and showed it again (focus on the active tab), all
  `defaultPrevented`. The old `Ctrl+Alt+T` no longer opens anything.
- **VS Code on** (run on `1fb8f0e`, the same shortcut code, with
  openvscode-server 1.109.5): C from the composer opened the VS Code tab; from
  the terminal and from Files it showed that one tab again. With focus inside the
  VS Code frame, `Ctrl+Alt+Shift+P` never reached HUI's document (the recorder
  saw nothing) and the pane stayed open, as SPEC.md describes.
- **Labels.** The **+** menu lists *New terminal* `Ctrl+Alt+Shift+T`, *Browser*
  `Ctrl+Alt+Shift+B`, *Files* `Ctrl+Alt+Shift+F`, *VS Code* `Ctrl+Alt+Shift+C`;
  **Hide Work pane** reads *Hide Work pane (Ctrl+Alt+Shift+P)* with
  `aria-keyshortcuts="Control+Alt+Shift+P"`.
- **Rebalance.** One chat beside the pane: 622 px chat, 560 px pane (row 1182 px).
  **Open split view**: two 420 px columns and a 336 px pane, no horizontal
  scroll. **Split right** to three columns: the pane collapsed to its 44 px rail
  and the columns shared the room equally (376/375/375 px). Closing the third
  column left weights 2:1 (the case that gave 514/320 px before) and showed two
  420 px columns, the pane back at 336 px and the divider at
  `aria-valuemin/now/max` 50/50/50. With the pane hidden the same divider moved
  between 320 px columns (Home: 320/812, End: 812/320); showing the pane again
  rebalanced them to 420/420.
- **Settings link.** **Open Settings → Tools → VS Code** landed with the VS Code
  section 24 px below the top of the settings scroller (`scroll-margin-top`
  24 px, `--space-6`), at 1440×900 and at 390×844 (there below the sticky
  header).
- Page errors: 0. While the split was created the columns showed 320/320 px for
  well under a second before 420/420: the multiplexer still measured its old
  width until its ResizeObserver frame ran (the same frame showed 320 px columns
  before this change).
