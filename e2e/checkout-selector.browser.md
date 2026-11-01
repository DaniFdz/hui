# Checkout and worktree selector

Verified on 2026-09-24 with the OpenClaw Browser tool against the running HUI
app.

## Environment

- Disposable Git repository with `main` and `topic` branches under `/tmp`.
- Isolated `XDG_CONFIG_HOME`; no operator HUI registry or PI transcript was read
  or changed.
- Vite gateway at `http://localhost:5173/`.
- Desktop viewport: 1440 x 900. Mobile viewport: 390 x 844.

The shared test `e2e/tests/sess/checkout.e2e.ts` now proves the Checkout popover's modes, branch suggestions,
starting on another branch or in a new worktree and the Configure default prefix link landing on the branch prefix
field (SESS-009 to SESS-011). What is left here is the popover's layout.

## Journey

1. Open New Session, enter the disposable repository as the project
   directory and open the Checkout popover in each mode.
2. Inspect the rendered popover at desktop and mobile widths. The mobile popup
   repositions above its trigger, remains fully visible and introduces no
   horizontal document overflow.

No page runtime errors were observed. The prefix Settings follow-up used a
temporary Brave/CDP profile after the shared browser profile reported
attach-only and unavailable. The first shared browser process was
closed by a concurrent HUI run between viewports; the mobile pass was repeated
from a fresh disposable Brave profile attached to the configured CDP port.
