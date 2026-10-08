# VS Code view journey

The Work pane's VS Code view (`<hui-vscode-view>`, `src/lib/work-views/vscode.ts`)
in the real app with a real openvscode-server. Until the Work pane registers the
kind, the unshipped harness `e2e/vscode-view-harness.html` lays it out like a
Work pane: the conversation (the app itself, in a frame) on the left and the
kind's tab and `render()` on the right. Keep screenshots outside Git.

## Setup

1. Build openvscode-server without installing it:
   `NIX_CONFIG='experimental-features = nix-command flakes' nix build nixpkgs#openvscode-server --no-link --print-out-paths`
   (1.109.5 at the time of writing). Its executable is `<out>/bin/openvscode-server`.
2. `npm ci`, then, without an ambient HTTP proxy for loopback,
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"` and
   `doctor` with the printed receipt.
3. Make the receipt's `workspace` a small Git repository (a README, `src/greet.ts`,
   `package.json`, one commit) and create a conversation there with `E2E_RICH`.
4. Open `<browserUrl>/e2e/vscode-view-harness.html?session=<id>` in an owned tab at
   1440×900; add `&narrow=1` (or use 390×844) for the narrow layout.

## Journey

1. **Off by default.** The view shows *VS Code is not available* with *VS Code is
   off. Turn it on in Settings → Tools → VS Code.* and an **Open Settings → Tools →
   VS Code** link; the harness's launcher note repeats the reason. No
   openvscode-server process runs.
2. **Settings.** The link opens Settings → Tools; the VS Code section shows **Off**
   and, with nothing on `PATH`, *openvscode-server was not found on PATH. Install it,
   or set its path in Settings → Tools → VS Code.* Save the executable path: the
   row reads *Using OpenVSCode Server 1.109.5 · <path>*. Turn **VS Code view** on:
   the pill reads **Ready** and the Server row *Starts when a VS Code view opens…*.
3. **Open.** Back in the harness the view shows *Starting VS Code*, then the
   workbench on the fixture folder: Explorer lists `src`, `fixture.txt`,
   `package.json`, `README.md`; clicking `src` → `greet.ts` opens it with
   TypeScript highlighting, and the status bar shows the `main` branch. VS Code's
   chrome takes HUI's colors (Default Light Modern on a light theme). The bar shows
   the folder (`~` for home), Copy, Reload and Open in a new tab. Neither the page
   nor the frame can read a cookie (`document.cookie` is empty in both: HUI's
   cookie is HttpOnly and VS Code's token cookie is stripped). The only failed
   requests are VS Code's optional `vsda` files (404 in every openvscode-server).
4. **Crash.** Kill the openvscode-server node process. Within 10 seconds the view
   shows *VS Code stopped unexpectedly* with the exit reason and **Retry**; nothing
   restarts the server meanwhile, even while the workbench tries to reconnect.
   **Retry** starts a new server and reloads the frame.
5. **New tab.** **Open in a new tab** opens the same folder in a new browser tab
   through its own ticket.
6. **Narrow.** At 390×844 the view fills the width; the bar keeps the icon, the
   folder truncated from the start and its three actions.
7. **Off again.** Turning VS Code off in Settings replaces an open view with the
   unavailable state and stops the server.

## Automated coverage

`server/vscode.test.ts` (detection, launch flags, lazy start, idle stop, crash,
process-group stop, stale-server reaping, tickets and cookie secrets),
`server/vscode-proxy.test.ts` (path and header rewriting, workbench patch, cookie
and WebSocket guards against a fake openvscode-server) and
`server/vscode-routes.test.ts` (the routes through HUI's middleware: x-hui still
guards every other route when only the VS Code cookie is present).
