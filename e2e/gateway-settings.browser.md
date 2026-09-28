# Gateway Settings browser proof — 2026-09-25

## Environment

- Disposable `/tmp/hui-gateway-ui-*` root, empty PI directory and isolated XDG config.
- Started with `PI_CODING_AGENT_DIR=<root>/pi XDG_CONFIG_HOME=<root>/xdg npm run dev -- --host 127.0.0.1`.
- Browser URL: `http://localhost:5176/`; viewports 1440×1000 and 390×844.
- No real sessions were started or changed. Fresh screenshots belong in the PR
  description, not Git history.

## Observed journey

1. Open Home → Settings → Gateway using Browser-tool clicks.
2. Confirm green Connected, HTTP + SSE, Full Access, zero registered sessions,
   Idle, and uptime advancing from seconds to `1m` via automatic health polling.
3. Simulate only health-request failure in this test tab by temporarily wrapping
   `window.fetch` to reject `/__hui/health` with `TypeError`; leave other requests
   and the gateway process untouched.
4. Observe automatic red Disconnected, Retry connection, and Last known values.
5. Resize to mobile; inspect the error screen and confirm no horizontal overflow.
6. Restore the original fetch implementation and click Retry connection.
   Confirm Connected returns and the stale/error notices disappear.
7. Emulate dark mode and inspect the green connection state and runtime values
   on mobile. Restore light mode for the desktop handoff.
8. Browser errors and error-level console messages: both empty.

The failed transport is injected, not a real process shutdown. Long uptimes,
active counts, missing PI state, first-load failure/loading, and invalid duration
values are covered by focused tests. No active PI session was needed for this
presentation change.

## Automated validation

- `npm test -- src/lib/gateway-presentation.test.ts src/views/settings-gateway.test.ts`: 4 passed.
- `npm test`: 453 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Integrated main verification

The shared checkout had divergent historical commits. This change alone was
cherry-picked onto current `origin/main` in an isolated worktree, preserving the
remote embedded-pane guard and appearance documentation. Repeated the Browser
journey on `http://localhost:5174/` with fresh isolated PI/XDG state, including
health-only failure, stale values, mobile overflow check, and keyboard Enter on
Retry connection. Connection recovered; final desktop/light and mobile/dark
screenshots were delivered separately. No page errors or console errors came
from the integrated `localhost:5174` app. The reused tab retained resource-load
errors from the old `localhost:5176` development server during checkout changes
and shutdown; these were inspected and are not attributed to the final app.

Integrated checks: `npm ci`, `npm test` (631 passed), `npm run typecheck`, and
`npm run build` passed. Build emitted its bundle-size advisory.
