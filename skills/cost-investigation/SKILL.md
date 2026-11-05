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

## Report

Finish with a table of driver → mechanism → what it saves, split into what would
have helped this session and what would help every session. Do not change code
unless asked: this session exists to explain the cost, not to fix it.
