---
name: cost-investigation
description: "Explain why a recorded session or pull request was expensive. Use when asking why a target cost what it did, or when HUI starts a cost investigation for one."
---

# Cost investigation

Explain one recorded session or pull request from HUI's Usage report. If the
prompt does not name the target and the range it read, ask for the session id or
`owner/repo#number` and the range before reading anything.

## What to work out

HUI measures volume, not intent: a turn that re-reads one file, a command that
prints megabytes, a model priced far above the work it did, or a loop that
retries a failing tool all show up only as tokens.

1. Name the two or three drivers the numbers point to, each with the number that
   supports it.
2. Confirm what you can instead of assuming. When the history's checkout still
   exists, its branch, `git log`, `git status` and changed files show what that
   work was doing. Do not invent a cause the recording cannot show.

### Name the cheaper mechanism

For each driver, name the mechanism, not just "be careful".

- **Context**: route a bulk read or a noisy command to a subagent and keep only
  its summary, or narrow the command itself (`| head -n 200`). Compact before the
  window fills. Brief a fresh subagent instead of resuming a long one.
- **Model and effort**: send exploration and routine edits to a cheaper model or
  a lower thinking level, and keep the strongest model for the hard judgment
  calls.
- **Structure**: when a correction would apply to every session (a build flag, a
  lint, a test, a line in `AGENTS.md`), encode it once rather than restating it in
  each prompt.
- **Workflow**: when the same multi-step work keeps coming back, write it down as
  a skill the next session can invoke, so it is not re-derived from scratch.

## Suggest follow-ups

The explanation is not the deliverable on its own. For the one to three changes
that would have prevented this cost, name the kind and record each as a
suggestion card with `suggest_task` — a short `title`, the evidence from the
numbers and the checkout as `problem`, the first step as `fix`, and the
service's directory as `cwd` — so the operator can start it from this session.

- **A check**: a linter, test or CI rule that catches the driver next time, for
  example a lint that fails when a hotspot file is read whole, or a CI rule that
  fails a PR whose recorded spend passes a threshold.
- **A skill**: the recurring multi-step work this session did by hand, written
  down so the next session invokes it instead of re-deriving it.
- **A refactor**: the service or module whose shape forced the extra turns, and
  what "easier" means concretely — one entry point, fewer generated files, a
  smaller context surface.
- **Service instructions**: an `AGENTS.md` for that service that states how to
  work there: which commands to run, what to read first, what to avoid.

One card per change, at most three, and only for a change you can state
concretely. When `suggest_task` is not available, list the same follow-ups in the
reply instead.

## Report

Finish with a table of driver → mechanism → what it saves, split into what would
have helped this session and what would help every session, then the follow-ups
you recorded. Do not change code unless asked: this session exists to explain the
cost, not to fix it.
