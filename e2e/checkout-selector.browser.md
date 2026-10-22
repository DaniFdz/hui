# Checkout and worktree selector

Verified on 2026-09-24 with the OpenClaw Browser tool against the running HUI
app.

## Environment

- Disposable Git repository with `main` and `topic` branches under `/tmp`.
- Isolated `XDG_CONFIG_HOME`; no operator HUI registry or PI transcript was read
  or changed.
- Vite gateway at `http://localhost:5173/`.
- Desktop viewport: 1440 x 900. Mobile viewport: 390 x 844.

The shared tests `e2e/tests/sess/checkout.e2e.ts` and `new-session-choices.e2e.ts` now prove the Checkout
popover's modes, branch suggestions, starting on another branch or in a new worktree and the Configure default prefix
link (SESS-003, SESS-009 to SESS-011). What is left here is landing on the prefix field on a long Settings page
(SESS-075) and the popover's layout.

## Journey

1. Open New Session, enter the disposable repository as the project
   directory, open the Checkout popover and select **New worktree**.
2. Use **Configure default prefix** to open `/settings/worktrees` scrolled to
   its Git worktrees section, where the `branchPrefix` input lives.
3. Inspect the rendered popover at desktop and mobile widths. The mobile popup
   repositions above its trigger, remains fully visible and introduces no
   horizontal document overflow.

No page runtime errors were observed. The prefix Settings follow-up used a
temporary Brave/CDP profile after the shared browser profile reported
attach-only and unavailable. The first shared browser process was
closed by a concurrent HUI run between viewports; the mobile pass was repeated
from a fresh disposable Brave profile attached to the configured CDP port.
