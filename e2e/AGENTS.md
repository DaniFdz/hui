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
  feature found later; until the shared suite exists, a new feature's use case joins it too. An exclusion needs a
  reason and the `SPEC.md` anchor of the decision behind it.
- `scripts/use-cases.test.ts` collects the code's surfaces (`catalogue/surfaces-src.ts`,
  `catalogue/surfaces-server.ts`) and fails when no use case claims one. A surface no screen uses goes into
  `catalogue/not-ui.ts` with its reason. Every journey has a class in `catalogue/journeys.ts`.
- A change that adds or changes a user outcome adds or updates its entry in the same PR.

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
