# Message queue browser verification

Verified on 2026-09-24 against the real HUI render at `http://localhost:5174/`.

## Coverage

- Rendered two HUI-owned follow-up rows above the active composer at 1440×900.
- Confirmed the OpenClaw queue anatomy: waiting/reorder icon, message, `Follow up`
  badge, `Steer`, remove, and edit controls.
- Opened the first inline editor from its row action, replaced the text, and
  cancelled with Escape. The editor received focus and exposed Save/Cancel.
- Confirmed both reorder handles are keyboard reachable and advertise
  `ArrowUp ArrowDown`; pointer drag uses the same handles and insertion target.
- Re-rendered the active queue under the iPhone 14 emulation. The connected
  tray, composer, action rail, and stop control remained visible without page
  overflow.

Backend delivery and mutation semantics are covered by
`server/live-sessions.test.ts`: edit, reorder, remove, steer, and automatic
follow-up delivery all operate on the same server-owned queue.
