# Unavailable move targets

Dragging a row onto a custom group, Move to group, the announcement, the reload and a failed move are proven by the
shared test `e2e/tests/sess/move-session.e2e.ts` (SESS-030). What is left here is SESS-069's current-group check,
because a menu item's disabled state can't be read through the portable queries yet.

## Browser journey

1. Launch the isolated app with `node e2e/visual-verification.mjs launch`, with sessions in the custom groups
   `Inbox`, `Research` and `Shipping`, and open it at 390x844 (iPhone 13).
2. Open the navigation drawer, then **Actions for** a session in `Inbox`, then **Move to group**.
3. Every custom group plus OTHER is listed and INBOX, the session's current group, is disabled. The menu stays inside
   the viewport and scrolls with the session list behind it.

Browser page errors: zero.
