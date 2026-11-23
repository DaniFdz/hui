---
name: review
description: "Use when a change needs an adversarial review before merge, or when a diff looks right and deserves an attempt to break it."
---

# Review

Try to break the change. A finding survives only when a run or a citation proves
it. Report findings. Do not edit the branch under review.

## Frame the change

The scope is the branch diff from its merge base with the base branch, through
the working tree. Restate the intent in one paragraph from the commits, the PR
body and the operator's message. Ask when the intent is unclear, because a review
against the wrong intent invents findings.

## A second family

Review with a model that did not write the change. Spawn it with `sessions_spawn`
and `route: "reviewer"` when the operator configured that route in Settings,
Models, Subagent routes. Otherwise pass `model: "<provider>/<id>"` from another
family, or review in a fresh session. Reading your own work is not a review.

Give the child the scope, the intent and the rules to check, and ask for findings
with the exact command and its output. Give it a fresh worktree when a run may
write to disk.

## Proof

A finding needs one of two things.

- A run. A command that fails, a test that breaks, a Browser-tool observation
  that shows the wrong screen. Paste the command and what it printed.
- A citation. `path:line` where the break is visible, and why it breaks.

Drop style, naming and taste. Drop risks that need a future change to matter.
"No verified findings" is a valid result. Count the findings you dropped and say
why.

## Blast radius

Read past the diff. Grep the callers of every changed symbol, then read the ones
that are not tests. A signature that still compiles can still break a caller that
passes `undefined`.

Check what the diff does not show.

- Persisted state. A format, a path or a runtime switch that leaves old data
  behind needs a `hui doctor` check, per `CONTRIBUTING.md`.
- The wire. `docs/api.md` and `docs/api.schema.json` describe routes the browser
  reads. A payload change that updates one and not the other breaks the browser.
- Dependency rules. Check the touched imports against R1 to R17 in `docs/map.md`.
  `scripts/boundaries.test.mjs` fails a breach that a typecheck misses.
- Performance rules. The table in `AGENTS.md` names the test that enforces each
  one. A snapshot sent without its transcript, a list that carries a subagent's
  task or report instead of its card, a blurred card behind the transcript, a
  poll that never stops, a model request that blocks the gateway loop. Each has
  a named check, so a finding cites the test or the rule it breaks.
- The catalogue. A user-visible change without an `e2e/catalogue/` entry and a
  shared test is incomplete, per `e2e/AGENTS.md`.

Use `verify` to settle what a run needs.

## Comment hygiene

Every source module starts with a header comment saying what it owns.
`scripts/module-headers.test.mjs` checks that one exists, and a review checks that
it is still true. Flag a comment that restates the code, a commented-out block,
and a `do not remove` note with no proof of the constraint behind it. A new guard
needs a test, not an `IMPORTANT` note.

## Report

Group findings by root cause, worst first. Each one names the file and line, the
proof, how it breaks the intent, and the smallest fix. List what you checked and
cleared, so the next reader does not repeat it.
