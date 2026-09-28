# Steer and enqueue regression verification

Verified on 2026-09-24 against the real HUI render at
`http://localhost:5174/`, using an isolated PI runtime and the deterministic
local provider fixture.

## Flow

- Started an `E2E_REPLAY` turn and held the provider response open.
- Sent `STEER_VISIBLE` through the normal Send action while the session was
  running.
- Confirmed the queue rendered the instruction as a non-editable `Steer` row:
  `.chat-queue__text` contained the instruction and
  `.chat-queue__edit-input` had zero matches.
- Typed `NEXT_DRAFT_STILL_EDITABLE` immediately afterward and confirmed the
  active composer retained the complete draft.
- Confirmed the composer contains no queue-mode `select`. Normal Send and
  Enter steer, Command/Ctrl+Enter enqueues on desktop, and touch hold exposes
  the mobile Enqueue action.
- Measured zero horizontal overflow on the document and composer at desktop and
  the iPhone 14 emulation (390 x 664).
- Browser page errors: zero.
