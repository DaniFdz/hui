# OpenClaw session hovercard port

Source: OpenClaw 2026.9.5, commit
`ec9c1a13db8938e5a3eaa51fca2e981cde2395a9`, `ui/src/components/`.
The installed release's independent renderer is the visual oracle; this is a
source port, not a screenshot-inspired replacement. `manifest.json` pins reviewed
local file hashes, checked by `hovercard.test.ts`.

## Preserved source

- `portaled-hovercard.ts`: portal controller, viewport placement, pointer bridge,
  focus management, trigger retirement and top-layer lifecycle.
- `session-progress-hovercard-target.ts`: original trigger resolution.
- `session-hovercard.css`: complete original stylesheet. The outer surface
  already comes from HUI's pinned OpenClaw reference stylesheet.
- `session-hovercard.ts`: original renderer and class hierarchy, including
  age, workspace context, unfinished-plan heads-up and agent notepad.
- `session-progress-card.ts`: original heads-up, stale-run, count and Markdown
  progress-bar promotion functions.
- `icons.ts`: exact upstream SVG definitions used by the renderer.
- `session-progress-hovercard.runtime.ts`: original delays, mouse/focus events,
  dismissal and portal lifecycle, with the data-source substitutions below.

## Necessary HUI adapters

The provider consumes Lit `sessions` properties instead of OpenClaw Gateway
stores/subscriptions. The existing PI transcript projection and three-second
sidebar refresh remain unchanged. Session ids, titles, creation dates, runtime
activity and workspace are mapped in `hui-hovercard-adapter.ts`; idle is not
reported as completed. HUI does not fabricate OpenClaw participants, channel
avatars, placement or pull requests. Their unavailable custom-element
registrations/loaders are omitted. English strings follow the original.

The top-layer helper omits native-browser-surface occlusion because HUI has no
native browser surface. Web Awesome session-menu opening also dismisses the
card. Markdown uses HUI's existing safe parser, with a narrowly sanitized
`progress` element adapter; no new dependency or raw HTML allowance is added.
Touch-only input retains the original no-hover behavior, with no custom mobile
progress button. Completed plans have no unfinished-step heads-up.

## Independent proof

See [browser proof](../../../e2e/session-hovercard.browser.md). The oracle server
exports the shipped original renderer from a checksum-pinned module. The probe
renders it into a disposable iframe with original CSS and compares it against
HUI; it never uses HUI DOM as the reference.
