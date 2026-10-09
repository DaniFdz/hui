# Shared terminal browser journey

Verified on 2026-09-25 with the real PI SDK runtime, native PTYs and the local
deterministic provider. User sessions, credentials and configuration were not
used. Keep fresh screenshots outside Git and include them in the PR description.

Terminals have since moved from chat panels into the conversation's Work pane:
the split, picker, panel-separator and hide/reopen steps below describe the
earlier panel layout. The current tab, launcher and narrow-destination journey
is recorded in `e2e/work-pane.browser.md`; the sharing, replay, reconnect and
termination results below still apply.

## Reproduction

1. Run `npm ci` and `HUI_E2E_PORT=43310 NO_PROXY=localhost,127.0.0.1 npm run e2e:sdk`.
   The launcher creates disposable HUI/PI state and a workspace, prints their
   paths, and starts the real app at `http://localhost:43310`.
2. Use the Browser tool with a dedicated labeled tab. Create a session through
   **New session**, send `Shared terminal check`, and click **Open terminal**.
3. Type into the visible **Terminal input** control, not its hidden textarea:
   `shared_from_user=human; printf 'USER_READY\n'; pwd`, then press Enter.
4. Submit `E2E_SHARED_TERMINAL` in the chat. The fixture requests `terminal`
   actions `list`, `read`, then `input` from the real PI extension. It writes a
   command that prints `PI_SHARED_TERMINAL` and reads `$shared_from_user`.
5. Exercise the terminal toolbar, panel separators and mobile panel selector as
   below. Stop only this fixture's launcher afterward; it owns its subprocesses.

## Reference and implementation scope

The reference is installed OpenClaw 2026.9.5's terminal implementation and tool
schema: Ghostty Web, `@lydell/node-pty`, and the five actions `list`, `read`,
`input`, `resize`, `close`. HUI implements all five against the user's real PTY,
scoped by the authenticated PI conversation. This is functional adaptation to
HUI's session panels, not authenticated OpenClaw screenshot/pixel parity.

## Observed Browser-tool results

| Journey | Result |
| --- | --- |
| Open terminal beside chat | Native interactive shell opened in the session workspace; cwd and `Shared · Connected` were visible. |
| User and PI share one shell | The user's variable was read by PI's command as `Shared variable: human` in the same terminal. The chat displayed three completed tool calls. |
| New terminal and selection | The second PTY printed `SECOND_SHELL:independent`; switching away and back retained each PTY's own output. |
| Split down | A third PTY appeared below the first; chat and two terminal panels were visible together. |
| Resize | Clicked column/row separators and used arrow keys; terminal `stty size` changed with its rendered dimensions. |
| Hide and reopen | The visible panel disappeared without ending its PTY; reopening retained the terminal ID and shell state. |
| Reload | Browser navigation back to the session restored the saved layout, terminal IDs and bounded output replay. |
| Reconnect | As an explicit transport fault injection, closed the existing browser WebSocket; it reconnected to the same terminal ID, with the shared variable/output retained and no input retransmission. |
| Mobile panels | At 390×844, **Active panel** switched chat/terminals while hidden terminal views remained connected. The draft `Keep this draft while using the shared terminal.` survived. |
| Mobile input | The on-screen Enter key ran a command; `stty size` reflected the narrow pane. |
| Mobile Ctrl+C | Started `sleep 60` after an `INTERRUPT_READY` marker, clicked Ctrl+C, then printed `SHELL_AFTER_CTRL_C` from the still-running shell. |
| Explicit termination | **Terminal actions → End terminal** removed the third PTY; the remaining terminals were still selectable and running. |
| Final screen | Desktop 1440×1000 and mobile 390×844 were captured and inspected; no document horizontal overflow at mobile width. |

The browser pass caught and fixed a full-width flex issue and Ghostty 0.4.0
screen contamination when sharing a WASM heap between emulator instances.
Each mounted view now owns its WASM instance. Reconnection uses RIS to reset
the existing parser instead of freeing a handle still used by selection.

The final tab reported zero page errors. Its console contained stale network
errors from another concurrent fixture on port 43191 that had navigated this
tab; none referenced this task's port 43310. The target was reclaimed and the
final terminal/reconnection/mobile checks ran against 43310.

## Automated verification and limits

- `npm test`: 567 tests passed after integrating the concurrent main update.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- `NO_PROXY=localhost,127.0.0.1 npm run test:package`: passed. This installs a
  freshly built archive and proves native PTY creation, WS output, terminal-aware
  stop/restart/update refusal, and the existing SDK/update/rollback lifecycle.
- Server tests cover owner isolation, guarded HTTP, one-use WS tickets,
  same-origin rejection, malformed messages, resource limits, UTF-8 bounds,
  real shell input/resize/Ctrl+C, natural exit, replay and bridge tool actions.

After rebasing onto the concurrent subagent improvements (`a107533`), repeated
the full suite, typecheck and installed-package check. Vite's server restart
correctly invalidated the old PTY IDs; **New terminal** recovered those views.
Repeated user input plus the real PI list/read/input chain, opened an independent
second PTY, and renewed both desktop/mobile screenshots on the combined code.

PTYs survive browser disconnection, not gateway/host restart. Replay is bounded
raw terminal output, not a persisted screen grid; historical resizes or a
truncated ANSI sequence can change replay appearance. This is documented in
the API rather than claimed as terminal screen-state persistence. No tmux,
cross-conversation terminal access or agent-created hidden terminals were added.
The real native/browser proof ran on Linux; Windows/macOS native PTYs and a
physical mobile keyboard were not exercised.

## Rendering benchmark

`e2e/terminal-benchmark.mjs` measures the terminal's streaming path in a real
app. It takes any visual-verification receipt, so the same script measures a
baseline checkout (for example a detached `origin/main` worktree) and a branch:

```sh
node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"   # keep it running
node e2e/terminal-benchmark.mjs --receipt <receipt.json> --runs 5 --label branch --out /tmp/branch.json
```

It starts its own headless Chromium-family browser (`--browser <path>`, default
`brave`) with a throwaway profile, creates a session through the API, opens its
terminal with **Open terminal**, and runs, in that PTY: an idle period, 20
keystrokes through the real keyboard path (echo latency), `seq 1 300000`, a
5 MiB coloured `cat`, 400 full-screen redraw frames, wheel-scrolling the
scrollback, and a dropped socket's 256 KiB replay. Each output run ends when a
marker line is in the emulator on an animation frame. It records renderer
main-thread and script time (DevTools `Performance` metrics), long tasks,
frame gaps, socket messages and bytes, and the gateway process's CPU time.

Measured on 2026-10-09, Linux host shared with other builds, headless Brave 153
without a GPU (SwiftShader), a 69×57 pane beside the chat, medians of five runs:

| Median of 5 | `origin/main` 1e50833 | binary stream + batching |
| --- | ---: | ---: |
| `cat` 5 MiB: until painted / renderer main thread | 691 / 685 ms | 389 / 396 ms |
| `cat` 5 MiB: gateway CPU / socket bytes / messages | 790 ms / 6.40 MB / 1,292 | 50 ms / 5.29 MB / 85 |
| Redraw: until painted / gateway CPU | 355 / 410 ms | 172 / 20 ms |
| `seq 1 300000`: until painted / gateway CPU / messages | 210 / 270 ms / 314 | 208 / 190 ms / 52 |
| Keystroke echo (median, p90) | 31, 31 ms | 30, 31 ms |
| Scrolling: renderer main thread over ~8 s | 3.4–4.5 s | 3.4–4.0 s |

The gateway no longer re-encodes the replay buffer per chunk, output skips
JSON, and batching keeps a fast shell from costing the browser one message per
small read. Without batching, `seq` arrived as ~4,500 messages and was slower
than `main`; joining a whole frame's output into one browser write instead made
`cat` faster still but produced 50–100 ms frames, so it was not kept. Echo
latency and scrolling are bound by Ghostty Web parsing and painting on the main
thread (about half of it while scrolling), which this change does not alter.
