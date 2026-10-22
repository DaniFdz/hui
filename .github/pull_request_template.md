## What changed

<!-- One coherent change. Summarize the behavior, not the diff. -->

## Why

## Checks

<!-- List the exact commands that ran and their result. Never list an unrun check.
Follow .agents/skills/hui-visual-verification/SKILL.md for UI work. -->

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test:package` (package or lifecycle changes)
- [ ] `npm run e2e`
- [ ] `npm run e2e:ios` (after `npm run ios:build`)
- [ ] Browser-tool E2E (user-visible changes)

- Verified commit:
- Fixture / proof scope:
- Browser actions and observed results:

## Use cases

<!-- The e2e/catalogue/ IDs this PR adds or changes, and the platforms where each
is required. If a test changed but the behaviour it proves didn't, or a new
accessible name labels a control that already existed, put the IDs and the names
in quotes on the line below. The E2E catalogue job reads it. -->

Unchanged behaviour:

## Visual evidence

<!-- UI changes require fresh inspected captures of this PR HEAD, uploaded as
GitHub attachments in THIS DESCRIPTION (not only comments/chat). Never commit
images or paste local paths/base64. Keep the PR draft if attachments are blocked.
For non-UI changes explain why not applicable; verification-workflow changes
still require the desktop/mobile smoke. -->

### Desktop — 1440×900

<!-- Attach the affected rendered state. -->

### Mobile — 390×844

<!-- Attach the affected rendered state; include landscape when relevant. -->

### iPhone

<!-- Attach the iOS app's affected screens: the screenshots the tests take,
copied out of .e2e/results/, or `xcrun simctl io booted screenshot <path>`.
Say why when the change doesn't reach the app. -->

## Proof gaps

<!-- Anything not verified, fixture limitations, known errors or attachment gap;
otherwise "None". -->
