# Custom session icon — browser proof

Date: 2026-09-24

## Reference

OpenClaw 2026.9.5's `session-icon-picker.ts` was used as the source of truth. The picker keeps eleven emoji presets, adds a **Custom emoji…** cell, switches to a focused custom-entry view, and uses the original `circle-x` SVG for the no-icon action.

## Journey

- Disposable HUI registry: `/tmp/hui-icon-e2e/xdg/hui/sessions.json`
- Disposable workspace: `/tmp/hui-icon-e2e/workspace`
- App: `http://localhost:5174/`
- Desktop viewport: 1440 × 900 through the Browser tool
- Mobile viewport: 390 × 844 through local Chromium CDP after the managed browser lost its attached process

From the visible session menu, **Icon** was opened and the aligned preset/no-icon grid inspected. **Custom emoji…** opened the focused input view. `🐧`, which is not one of the presets, enabled **Set**, persisted through the real PATCH route, appeared in the session row, and remained in the isolated registry after reload.

The same custom-entry state was rendered at 390 × 844. The nested menu, input, hint and **Set** button stayed inside the viewport.

## Evidence handling

Use the [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md)
to capture fresh evidence and include it in the PR description without committing
images. The reproducible journey above remains the scenario contract.
