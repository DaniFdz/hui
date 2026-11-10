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
in the order of `AREAS` in `catalogue/types.ts`). It is the checklist the shared web suite proves.

- An entry is one outcome a test can prove: an `AREA-NNN` ID that is never renumbered or reused, a title, the
  behaviour a user observes (with the labels the UI renders today), the `SPEC.md` or `docs/api.md` anchors that
  define it, the code surfaces it owns, the journeys it came from, and its status on the web and on the phone.
- `backlog` means the feature exists but has no passing shared test yet. Only IDs listed in
  `catalogue/baseline.json` may be backlog, per platform. The list shrinks as shared tests land and grows only for an
  existing feature found later. A new use case is required on the web and on the phone, unless it is excluded there,
  with its shared test. An exclusion needs a reason and the `SPEC.md` anchor of the decision behind it, and only a
  phone's own limits exclude a case on the phone: a keyboard chord, the wide layout, a hover, a secondary click. The
  phone apps wrap the web UI (SPEC.md), so a case is never excluded because the phone drew its own screen.
- `scripts/use-cases.test.ts` collects the code's surfaces (`catalogue/surfaces-src.ts`,
  `catalogue/surfaces-server.ts`) and fails when no use case claims one. A surface no screen uses goes into
  `catalogue/not-ui.ts` with its reason. Every journey has a class in `catalogue/journeys.ts`.
- A change that adds or changes a user outcome adds or updates its entry in the same PR, and a use case it changes
  leaves the web and the phone backlog with its shared test. An accessible name new in `src/` appears in a shared test
  that runs on both targets. A use case changes when its entry's behaviour, surfaces or spec change, or when the body of
  a test tagged with it, or the file code it shares other than the header comment, does; the PR that adds a backlog use
  case's first test and takes it off the backlog doesn't count. A test fix that leaves the behaviour alone, or a new name
  for a control that already existed, goes on the PR description's `Unchanged behaviour:` line instead (IDs, and names in
  quotes, separated by commas). `scripts/e2e-baseline-check.ts` (the E2E catalogue workflow) checks all of this
  against the pull request's base.

## The shared e2e suite

`tests/<area>/<name>.e2e.ts` are the shared tests, written with [tester-army/e2e](https://e2e.tester.army/docs) and
run by `../e2e.config.ts` against a disposable gateway that the visual-verification launcher starts. Run them with
`npm run e2e` after `npx e2e-web install chromium`; a failure leaves `trace.md`, a screenshot and the screen dump in
`.e2e/results/`.

The suite has two targets, `web` and `android` (`../e2e.config.ts`), and `webkit-phone` and `ios-smoke` follow. The
tests stay portable so a phone can run them: every gesture or reading that would differ per platform is a `hui.*` step
from the fixture's per-target table, and the rules below keep the tests themselves free of web-only reads. `android`
runs HUI's own page inside the app's WebView over CDP (`fixtures/phone.ts`), so its steps are the web's except for what
a WebView cannot do (it has one page and one context, so `hui.clearState()` clears the app's storage in the page). The
web engine's platform is `web` on both targets, so a test declaring `platforms: ["web"]` runs on the phone too: which use
cases `android` runs is the catalogue's phone status, which `catalogue/phone.ts` prints as the `--tag` list the job uses.

A phone shows one screen at a time, so a test calls `hui.sessionList()` before it checks session rows while a chat
or the Sessions page is open: on the web's wide layout the sidebar is always there and it does nothing, and on the
web's phone layout (the shell's drawer media) it opens the navigation drawer. It never stands in for a check: when a
test goes on in the chat, it opens that chat again. A test reads a container's text in order with
`hui.textOf(container)` rather than `toHaveText` on the container, because a phone's accessibility tree reports only
a container's label.

- Import `test` from `fixtures/hui.ts` and `expect` from `e2e`. The fixture owns the gateway's API setup and cleanup,
  the fixture provider's barriers and the steps that differ per platform; a test never reads `platform`, `device` or
  `browser`.
- Tag each test with the IDs of the use cases it proves, and make those `required` where the target runs them. A test
  carries `platforms: ['web']` unless it is meant for a native target too; on the `android` target the catalogue's phone
  status decides instead (see above).
- Find controls by label, text, placeholder or test id, or by role: both targets render the same page, so a role is as
  portable as a test id. A test checks a link inside a message's Markdown with `hui.expectLinkTo`, which owns the `link`
  role. A test id must exist as a `data-testid` in `src/`. Every test starts a line with `test(`, which is how the check
  tells a file's tests apart.
- No agent steps, `retries`, `test.skip(` or sleeps, in the tests or the fixture. Wait on state: `expect`,
  `expect.poll` and the provider's barriers. Check `toBeHidden()` only after a positive check has synchronized, and
  prefer it to `.not.toBeVisible()`. Clear the app with `hui.clearState()`, never `app.clearState()`.
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
