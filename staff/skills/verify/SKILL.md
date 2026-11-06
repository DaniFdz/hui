---
name: verify
description: "Use when claiming a change works, before reporting it, and when a check has to prove the real artifact instead of a stand-in."
---

# Verify

Prove the change on the artifact the user touches. A proxy passing is not the
change passing, and an unrun check is never a passed one.

## Pick the artifact

Name what the user actually does: run an installed `hui` command, open a page,
send a chat turn, install the `.tgz`. Check that. Reading the diff, calling the
HTTP route with curl, or seeding state by hand is setup, not proof.

For a user-visible change, drive the real UI with the Browser tool through
`.agents/skills/hui-visual-verification/SKILL.md`. It owns the isolated launch,
the doctor receipt, the desktop 1440x900 and mobile 390x844 captures, the console
check, and the attachment step. Do not reimplement it here.

## Checks

Run the narrowest check that owns the behaviour first, then the broader ones.

- One file: `npm test -- <file>`.
- The suite: `npm test`.
- Types: `npm run typecheck`.
- The bundle: `npm run build`.
- Shared browser journeys: `npm run e2e`, and `npm run e2e:ios` when the change
  reaches the iOS app.
- Package or lifecycle: `npm run test:package`.
- Persisted state left behind: the `hui doctor` check that `CONTRIBUTING.md`
  requires.

Report the command and its result for each one. Write "not run" and the reason
for the ones you skipped. A check that could not run is a gap in the report, not
a pass, and a weakened assertion is not a pass either.

## Numbers

Vet a measured number before it reaches a report or a PR body. The `principles`
skill states the rule as `Explain the number`; the checks below are what a run
has to show.

- Name the limiter, from a profile you do not report. When a change did not move
  the number, the limiter explains why.
- Run both sides at least five times, alternating, and report the median and the
  range. A gap inside the run-to-run spread is no difference.
- Count errors, and confirm the work happened inside the timed region.
- Measure the end-to-end path a user waits on. A helper that takes 1% of a
  request bounds the request at 1%.
- For a change to opening, streaming or listing a session, take the slow-link
  numbers with the procedure in `e2e/remote-loading.browser.md`.

## Report

State what ran, what it printed, and what you saw on screen. Put each gap on its
own line: the check not run, the fixture that cannot reach the state, the
attachment that failed. A reader trusts a report more when it names its holes.
