# Automatic recovery and unread browser verification

Verified on 2026-09-24 with HUI's real gateway, the installed PI RPC runtime
and the deterministic local provider on port 43187. `HOME`,
`XDG_CONFIG_HOME`, both PI agent-directory variables and PI's session directory
pointed at `/tmp/hui-auto-recovery-e2e.c4ZEJv`; no operator session, credential
or transcript was read or changed.

## Journey

1. Created a session through **New session** and sent `E2E_REPLAY`. The provider
   emitted `Replay prefix` and held the response open.
2. Confirmed the isolated registry contained `runStartedAt` and the temporary
   `runPrompt: "E2E_REPLAY"`, then stopped and restarted the real Vite/HUI
   gateway without releasing the provider barrier.
3. The existing browser reconnected without an error state or manual action.
   HUI booted the interrupted PI session and automatically sent a continuation
   containing the original request plus the instruction to inspect transcript
   and workspace state before repeating work. The provider log contained the
   recovered request and the UI returned to Running.
4. Left the chat through the visible **New session** action, then released the
   provider. The durable registry settled to `unread: true`, the sidebar row
   changed to `status idle, ... unread`, and its `.session-unread-dot` rendered
   as `rgb(189, 69, 49)`, exactly the resolved `--accent: #bd4531`.
5. Repeated the visual check at 390×844 with the navigation drawer open.
   `innerWidth`, `body.scrollWidth` and `documentElement.scrollWidth` were all
   390, with the same accent unread dot.
6. Opened the session through its sidebar row. The completed transcript showed
   `Replay prefix — replay suffix`, the registry cleared `unread`, and the dot
   disappeared.

The Browser controller proved the create, restart and automatic continuation
steps on the live page. Its external control channel later timed out twice, so
the remaining navigation, DOM/computed-style inspection and screenshots used
CDP against that same already-observed tab; no synthetic page or image was
created. Expected event-stream request failures occurred only while the gateway
was deliberately offline.
