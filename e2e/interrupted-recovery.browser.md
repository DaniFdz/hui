# Automatic recovery and unread browser verification

Verified on 2026-09-24 with HUI's real gateway, the installed PI RPC runtime
and the deterministic local provider on port 43187. `HOME`,
`XDG_CONFIG_HOME`, both PI agent-directory variables and PI's session directory
pointed at `/tmp/hui-auto-recovery-e2e.c4ZEJv`; no operator session, credential
or transcript was read or changed.

## Journey

The shared tests `e2e/tests/chat/gateway-restart.e2e.ts` and `e2e/tests/chat/reconnect.e2e.ts`
cover the restart mid-turn on Pi Durable and on PI's worker, the recovery turn, leaving the
running chat, the accent unread dot surviving a restart and clearing on open, and drafting
through a dropped stream (CHAT-016 to CHAT-018). This journey keeps the check no shared
test makes yet: the unread dot on a phone.

1. Created a session through **New session** and sent `E2E_REPLAY`, left the
   chat through the visible **New session** action, then released the
   provider. The sidebar row changed to `status idle, ... unread`, and its
   unread dot rendered in the accent colour.
2. Repeated the visual check at 390×844 with the navigation drawer open.
   `innerWidth`, `body.scrollWidth` and `documentElement.scrollWidth` were all
   390, with the same accent unread dot.
