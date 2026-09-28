# Message metadata and replies — 2026-09-25

## Environment

Real installed PI RPC with the deterministic `pi-provider-fixture.mjs` provider,
isolated PI agent/session directories and XDG registry under a fresh
`/tmp/hui-metadata-*` directory. Provider port 43237; Vite gateway port 5197.
Use the setup in `chat-composer.browser.md`, substituting these ports and omitting
the question extension. No operator data or credentials were used.
Browser-tool viewports: desktop 1440×1000 and mobile 390×844.

## Verified journey

- Created a session from New Session and sent `E2E_RICH` through the composer.
  Real PI settled with reasoning, a read tool, and the Markdown final response.
- Expanded activity: model-call and read-tool durations were separate; only the
  model call carried tokens. Expanded final measurements showed input/output,
  zero-valued cache counters and zero reported cost.
- Entered an existing draft, activated Reply, and verified the original draft
  plus a multiline Markdown quote. Focus and selection moved to the end of the
  composer; no prompt was sent. Keyboard-focused Reply + Enter also worked.
- Reloaded: the draft and live duration remained. Observed `just now` advancing
  to `1m ago`; time tooltips distinguish completion from creation timestamps.
- Vite runtime restarts while editing server code dropped live duration but
  preserved PI usage/timestamps, as documented. Reused tool IDs across fixture
  turns no longer assign a new measurement to an old tool call.
- At mobile width, activated Reply, verified quote/focus, opened measurement
  details and checked no document-level horizontal overflow. Desktop and mobile
  rendered screenshots were inspected and delivered as transient chat artifacts,
  never stored in the repository.
- No browser page exceptions. Console recorded transient SSE incomplete-chunk
  and connection-reset/refused errors during development server restarts;
  these were inspected. Final verification used an index-only export in
  `/tmp/hui-metadata-validated` on port 5198 to exclude concurrent edits.
  The fixture provider had stopped; its explicit Connection error and Continue
  recovery were exercised after restarting it. No new browser console errors
  occurred on port 5198.

## Automated checks

`npm test` (461 passing tests on the isolated staged tree), `npm run typecheck`, `npm run build`, and
`git diff --check`. Focused metadata tests cover missing/zero/invalid metrics,
reply preservation, time boundaries, unmatched completion, reused tool IDs and
usage for model messages containing only tool calls.

## Limits

PI does not report per-text-fragment token usage or historical execution
intervals. Tokens represent a model call including reasoning, displayed once;
live timing lasts only as long as the runtime. No persisted format was added.

## Integration with current main

The shared checkout had diverged from remote main. The feature was ported in an
isolated worktree onto `afe60fa`, preserving SDK/CLI support, multiplexer panes,
image attachment projection, tool details and rewind actions. Reply focus is
scoped to the owning `hui-app` pane. Existing SDK restart tests now explicitly
verify observed live timing and exact preservation of all PI-owned fields after
restart, without expecting ephemeral intervals to persist.

Repeated real Browser-tool verification using `HUI_E2E_PORT=5196 node
e2e/sdk-backend.mjs`, its fresh temporary workspace, and the same desktop/mobile
sizes. Created `E2E_RICH`, inspected model/tool measurements, expanded counters,
activated Reply and verified focus inside the embedded pane's composer and no
horizontal overflow. Fresh integrated screenshots were delivered separately.
Final integrated checks: **647 tests passed**, `npm run typecheck`,
`npm run build`, and `git diff --check`. The build reports its existing large
chunk advisory. No page exceptions or console errors occurred during the successful SDK journey.
The subsequent rebase restarted the development server and produced transient
connection-refused resource errors; these are fixture lifecycle errors, not a
claim of an entirely error-free browser log.

## Reply affordance follow-up — 2026-09-25

Replaced the ambiguous left arrow with OpenClaw's pinned `messageSquare` SVG;
its geometry hash was extracted from the installed 2026.9.5 Control UI bundle
and added to the existing icon parity manifest. Reply uses the same themed
custom tooltip surface as Rewind, not the browser's delayed `title` popup.
The tooltip appears on hover and keyboard focus; Escape dismisses it without
bubbling to the session's global shortcut handler.

Browser proof used `HUI_E2E_PORT=5195 node e2e/sdk-backend.mjs` with its disposable
workspace. Created a session through New Session, sent `Hello`, hovered Reply,
checked visible tooltip opacity, focused the button, dismissed with Escape and
activated with Enter. The expected quote appeared in the owning pane composer.
Repeated at 390×844; no horizontal overflow. Desktop 1440×1000 and mobile
screenshots were inspected and shared directly. No page exceptions.
Validation: 657 tests passed, typecheck, production build and diff whitespace check.

### Tooltip spacing correction

Reply's tooltip now anchors to the 14px icon rather than the 44px touch target.
On the same real SDK fixture, Browser hover and measured rectangles verified a
4px gap and zero horizontal center offset at 390×844 and 1440×1000. The touch
target remains unchanged. Fresh screenshots were inspected and shared.
Re-ran the full test suite, typecheck, build and whitespace check successfully.

### Unified message action tooltips

Reply, Rewind and message Copy now use one renderer and one tooltip style.
Each has a pane-scoped description ID, hover/focus visibility, Escape dismissal
and a glyph-relative 4px gap. Copy no longer has a native `title`; its tooltip
changes from Copy to Copied on confirmed clipboard success. The shared Copy
renderer also covers its tool-output and error-message usages. Code-block
header controls are a separate Markdown surface and are unchanged.

On the existing isolated SDK session, hovered Rewind and Copy, clicked Copy and
observed both the Copied accessible name and tooltip, dismissed with Escape,
and repeated at mobile width. Measured 4px visible gaps and no horizontal
viewport overflow. Inspected fresh desktop/mobile screenshots and shared them
without committing image files. No page exceptions. Full suite (657 tests),
typecheck, production build and whitespace validation passed.
