# OpenClaw session menu parity — browser proof

Date: 2026-09-24

## Reference audit

The OpenClaw 2026.9.5 Control UI bundle was inspected as the authoritative reference. Its session menu hierarchy is:

1. Pin, Rename, Mark unread/read, Archive/Restore
2. Icon, Move to group, Assign to
3. Fork conversation, Copy, Open in
4. Delete

HUI now mirrors that hierarchy for the operations supported by PI. `Assign to` is omitted because PI has no multi-user ownership model. `Fork conversation`, preview links, and split views are omitted because PI exposes no safe transcript-fork or equivalent presentation contract.

## Environment

- Disposable registry: `/tmp/hui-session-menu-e2e.1Dljxu/xdg/hui/sessions.json`
- Disposable workspace: `/tmp/hui-session-menu-e2e.1Dljxu/workspace`
- App: `http://localhost:5175/`
- Desktop viewport: 1440 × 900
- Mobile viewport: 390 × 844

## Exercised UI paths

- Opened the session action menu from the sidebar.
- Selected an emoji from **Icon**.
- Marked a session unread and verified its accessible unread state.
- Archived the session, verified it disappeared from the active sidebar, opened **Sessions → Archived**, restored it, and reloaded the app.
- Moved the session to **Shipping** through the nested group submenu and verified the persisted registry response.
- Copied the session ID and observed the success notice. Browser clipboard readback was denied by the test browser, so proof is limited to the UI success path.
- Opened the session in a new tab and verified the new HUI tab and session URL.
- Repeated the menu and **Icon** interaction at 390 px; the nested panel remained entirely inside the viewport.
- Browser page errors: none.

## Persistence result

After reload, `menu-parity-alpha` retained:

- group: `Shipping`
- icon: `🧪`
- unread: `true`
- archived: `false`
