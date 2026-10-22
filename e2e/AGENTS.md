# End-to-End Guide

This directory owns repeatable user-journey coverage against a running HUI app.
E2E tests complement unit tests; they do not replace server boundary tests.

Use the repository-owned [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md)
for checkout identity, isolated launch/doctor/cleanup, Browser actions and PR handoff.

Procedures (`*.browser.md`) and the entry points `package.json` and the skill name stay at the top level.
Fake providers, CLIs, services, seeds and PI extensions go in `fixtures/`; scripts a procedure loads into the
running app (probes and oracles) go in `probes/`.

## The use-case catalogue

`catalogue/` lists every user outcome HUI supports, one file per area (`shell.ts`, `sess.ts`, `chat.ts` and so on,
in the order of `AREAS` in `catalogue/types.ts`). It is the checklist the shared web and iOS suite proves.

- An entry is one outcome a test can prove: an `AREA-NNN` ID that is never renumbered or reused, a title, the
  behaviour a user observes (with the labels the UI renders today), the `SPEC.md` or `docs/api.md` anchors that
  define it, the code surfaces it owns, the journeys it came from, and a status on the web and on iOS.
- `backlog` means the feature exists but has no passing shared test there yet. Only IDs listed in
  `catalogue/baseline.json` may be backlog. The list shrinks as shared tests land and grows only for an existing
  feature found later. A new use case is required on the web and on iOS, unless it is excluded on one of them, with
  its shared test. An exclusion needs a reason and the `SPEC.md` anchor of the decision
  behind it.
- `scripts/use-cases.test.ts` collects the code's surfaces (`catalogue/surfaces-src.ts`,
  `catalogue/surfaces-server.ts`) and fails when no use case claims one. A surface no screen uses goes into
  `catalogue/not-ui.ts` with its reason. Every journey has a class in `catalogue/journeys.ts`.
- A change that adds or changes a user outcome adds or updates its entry in the same PR, and a use case it changes
  leaves the web backlog with its shared test. `scripts/e2e-baseline-check.ts` (the E2E catalogue workflow) checks
  both against the pull request's base.

## The shared e2e suite

`tests/<area>/<name>.e2e.ts` are the shared tests, written with [tester-army/e2e](https://e2e.tester.army/docs) and
run by `../e2e.config.ts` against a disposable gateway that the visual-verification launcher starts. Run them with
`npm run e2e` after `npx e2e-web install chromium`; a failure leaves `trace.md`, a screenshot and the screen dump in
`.e2e/results/`.

The `ios` target runs the same tests on the "HUI iPhone" simulator (iOS 27.0) against a gateway on the fixed port
47400, which the simulator reaches as `http://127.0.0.1:47400` because it shares the Mac's network. To run it
locally, create and boot the simulator once (the command is in `../ios/AGENTS.md`), check the toolchain with
`npx agent-device doctor`, then run `npm run ios:build` and `npm run e2e:ios`. On iOS the fixture relaunches
`dev.hui.ios` with `-HUIGatewayURL <gateway>` and follows `hui://open?path=<path>` for `hui.open`, restarts the app for
`hui.reload`, and throws "not on iOS yet" from the steps only the web engine has (hover, request interception, the
clipboard, glyphs, looks and the rest), so a test that needs one keeps `platforms: ['web']`.

- Import `test` from `fixtures/hui.ts` and `expect` from `e2e`. The fixture owns the gateway's API setup and cleanup,
  the fixture provider's barriers and the steps that differ per platform; a test never reads `platform`, `device` or
  `browser`.
- Tag each test with the IDs of the use cases it proves, and make those `required` where it runs. While a use case
  is iOS backlog, its test carries `platforms: ['web']`; a use case excluded on the web carries `platforms: ['ios']`.
- Find controls by label, text, placeholder or test id, or by the roles iOS also has: `button`, `textbox`, `switch`,
  `tab` and `listitem`. A test id must exist as a `data-testid` in `src/`, and in a file with a test that runs on iOS,
  as an `.accessibilityIdentifier("…")` under `ios/HUI/` too.
- No agent steps, `retries`, `test.skip(` or sleeps, in the tests or the fixture. Wait on state: `expect`,
  `expect.poll` and the provider's barriers. Check `toBeHidden()` only after a positive check has synchronized, and
  prefer it to `.not.toBeVisible()`.
- A test may use other roles only when every use case it covers is excluded on iOS.
- A test proves the whole behaviour its tags name. A clause no test can prove yet becomes its own backlog use case.
- Every static `aria-label` in `src/` appears in a test or in the baseline's `unexercisedLabels`. A new control gets a
  test, not a line there.
- `scripts/use-cases.test.ts` checks these rules.

## Priorities

- Cover the highest-value real journeys first: start/open/resume a PI session,
  stream and abort a turn, reconnect, switch model, change settings, and manage skills.
- Use the Browser tool for user-visible verification. Interact through visible controls
  and assert observable UI state; direct API calls are allowed only for isolated setup
  or teardown that a user journey does not cover.
- Prefer stable roles, labels, and user-facing text over CSS-position selectors.
  Synchronize on the resulting state or event; never use fixed sleeps as correctness.
- Run against an isolated HUI config and disposable PI fixtures/sessions. Never delete
  or mutate the operator's real PI transcripts, skills, credentials, or HUI registry.
- Keep viewport, seed data, server command/URL, and cleanup explicit so another agent
  can reproduce the result. Inspect browser console errors and the final rendered screen.

## Handoff

- State the journey, environment, Browser-tool actions, and observed result. If a flow
  cannot be automated yet, record the exact gap rather than replacing it with API-only
  proof or claiming coverage.
- Capture fresh screenshots outside the source tree and include them in both the PR
  description and the conversation. Keep the PR draft if GitHub attachment delivery
  is blocked. Do not add browser screenshots to `e2e/evidence/` or link transient
  image paths from committed journey notes. Keep only structured evidence that is
  needed to reproduce or audit a check. If chat attachment delivery fails, report
  that gap instead of committing the screenshots.
