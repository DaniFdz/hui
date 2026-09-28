# Reposition live chat and terminal panes

Verified on 2026-09-25 with the Browser tool and the real SDK/PTY fixture.
All sessions, commands and paths were disposable test data. Keep fresh
screenshots outside Git and include them in the PR description.

## Reproduction

1. In an isolated checkout, run `npm ci`, then
   `HUI_E2E_PORT=43340 NO_PROXY=localhost,127.0.0.1 npm run e2e:sdk`.
2. Open the printed fixture URL in a dedicated Browser tab at 1440×1000.
   Create a session using the printed workspace path and a long title.
3. Click **Open split view**, then type a draft in one view. Drag its **Move
   panel** handle onto the other transcript's center, then its header and
   composer regions to exercise swapping and vertical edge movement.
4. Open a second fixture session, send `E2E_COMMAND_RUNNING`, and open its
   terminal. The provider's `/control/wait-command` keeps a real tool turn
   active until `POST /control/release-replay` releases it.
5. In the visible **Terminal input**, use Browser `type` with `slowly: true`
   (native keystrokes, not contenteditable replacement), then Enter:
   `panel_move_marker=still_here; echo TERMINAL_MARKER_READY`.
   Move that terminal between columns/stacks and run
   `echo AFTER_MOVE:$panel_move_marker` in the same input.
6. Focus **Move panel** and use arrow keys. Exercise both row/column separators,
   minimum pane widths, reload, and the 390×844 active-panel selector.

## Observed Browser results

- Native center drops swapped two existing pane IDs without changing their
  count. Native top/bottom drops moved views between columns and stacks.
  Duplicate-session panes retained independent editors and the typed draft.
- Retained references to every embedded application and editor remained
  connected. Terminal moves preserved the exact element, emulator and open
  WebSocket objects; output after the move included `AFTER_MOVE:still_here`.
  Swapping the scrolled chat with a same-height terminal retained its exact
  217px scroll offset and the same transcript element.
- A real command remained Running while its terminal moved; releasing the
  provider gate produced the normal tool-completion response.
- Arrow-key movement moved panes between stacks/columns while leaving focus
  on the same handle. Geometry updates never reparent the pane content.
- Pointer resizing and keyboard Home changed persisted adjacent weights.
  At the 320px floor, the long-title header's width and scroll width were both
  320px; hit-testing confirmed its close button remained reachable.
- Dragging from the close button did not move or close a panel. Ordinary
  header controls remain separate from the drag surface.
- Mobile showed one active pane and no move handles. Switching chat/terminal
  retained the chat draft and terminal connection; document width stayed 390px.
  The mobile pass also caught a topbar selector invalidated by the hovercard
  provider wrapper; the merged chat header now hides that duplicate chrome.
- Reload restored pane IDs, weights, the draft, terminal ID and active chat.
  Ghostty's automatic focus-on-open is suppressed for background panes, so
  terminal initialization no longer silently selects its owner session.
- The final Browser tab had zero page errors and zero error-level console
  entries. After rebasing onto the concurrent sidebar-tree update, Vite held
  an old stylesheet transform; invalidating that dev cache and reloading
  restored the current rules, and the integrated visible checks were repeated.
- Vite's forwarded window-error log exposed `ResizeObserver loop completed
  with undelivered notifications` during responsive checks even though the
  Browser page/console collectors reported no errors. Viewport geometry writes
  now coalesce into an animation frame outside observer delivery to avoid
  same-cycle scrollbar feedback. The follow-up native terminal move and
  1120x350, 1440x1000, and 390x844 resize checks retained the terminal
  objects/socket. Both the Browser collectors and Vite log were error-free
  after that change.

## Reference scope and implementation boundary

The inspected reference is the installed OpenClaw 2026.9.5 `ec9c1a13` bundle:
`control-ui-boot-chat-CLUFzlXZ.js`, its shared layout functions, and
`panel-tab-strip-BIRzRpfc.js`. HUI retains the original columns/stacks, 30% edge
bands, nearest-edge corner resolution, and preview geometry. Whole-pane header
movement is an adaptation to HUI's combined chat/PTY workspace, not a claim of
identical markup or all-application pixel parity.

Pane moves reuse IDs and the existing localStorage/history schema. Center
means swap for pane moves, but still means replacement for sidebar-session
drops. Minimum sizes remain 320px for desktop columns and 200px for rows;
insufficient space scrolls instead of overlapping views. A stable flat content
host avoids custom-element disconnect callbacks when the visual order changes.
No server route, dependency or PI transcript mutation is involved.

## Automated checks

- Focused layout, geometry and drag-payload tests: 20 passed.
- Integrated full `NO_PROXY=localhost,127.0.0.1 npm test`: 594 passed.
  `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- The existing independent reference oracle passed 1,000 layout transitions
  and 10,201 drop positions. Move tests additionally cover terminal ownership,
  duplicate sessions, stale/self drops, all four edges and 300 repeated moves.
- Full-suite attempts exposed the existing native PTY Ctrl+C output race
  (`AFTER_INTERRUPT`). The test now waits for foreground-job readiness and a
  fresh shell prompt before sending the post-interrupt command. No assertion
  was weakened, timeout extended or sleep added.

Native pointer and keyboard proof ran in Chromium on Linux. Physical touch
dragging is not implemented; narrow screens intentionally retain their existing
single-active-pane presentation. Stop only this fixture launcher after handoff.
