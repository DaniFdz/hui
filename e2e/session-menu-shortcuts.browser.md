# Archive toast stays while you read it

The session menu's single keys, the archive toast's Restore, a failed restore and the toast expiring are proven by
the shared tests `e2e/tests/sess/session-menu-keys.e2e.ts` and `e2e/tests/sess/archive-restore.e2e.ts` (SESS-034,
SESS-035, SESS-040). What is left here is SESS-064, which needs more than 15 seconds of observation and so stays an
agent-run check until a fixture can control the page's clock.

## Browser journey

1. Launch the isolated app with `node e2e/visual-verification.mjs launch` and open it at 1440x1000 with two sessions.
2. Open **Actions for** one of them and choose **Archive session**. The toast reads `Archived “<title>”.` with
   **Restore** and **Dismiss archive notification**.
3. Focus **Restore** without pressing it and wait 20 seconds. The toast is still there.
4. Move focus out of the toast, then hover it with the pointer and wait 20 seconds. The toast is still there.
5. Move the pointer away. Within 20 seconds the toast disappears and the session stays archived.

Browser page errors: zero. Use a Browser wait on the toast's text disappearing, not a fixed sleep, for step 5.
