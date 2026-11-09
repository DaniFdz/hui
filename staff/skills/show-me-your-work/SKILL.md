---
name: show-me-your-work
description: "Use when dispatching, settling, or reviewing long or unattended work: keep the staff ledger and decision log current for the next session."
---

# Show me your work

One ledger every session can read, and one decision log that never rewrites itself. Another session must be able to pick up the task from them without your transcript.

## The ledger

`work/index.md`, one row per task. Every session reads it first and writes its own rows.

| Task | Owner | Status | Evidence | PR |
| --- | --- | --- | --- | --- |
| roster cache | `ada` (worker) | in review | commit `3a9f1c2`; `npm test -- server/x.test.ts` 12 passing | #412 |

- **Task.** A short name, matched by the file `work/<task>.md`.
- **Owner.** The session title or child label, and its route. One owner at a time.
- **Status.** One of `planned`, `in flight`, `blocked`, `in review`, `merged`, `abandoned`.
- **Evidence.** A pointer that resolves: commit, `path:line`, command with its result, or artifact path. Never a paragraph, never a self-grade.
- **PR.** `#N`, or `-` before one exists.

A playbook may add columns it needs, such as `Step`, `Route`, or `Child`; these five stay and the task row keeps this meaning. A step-level log may use finer words (`running`, `verified`, `inconclusive`); the task row keeps the statuses above.

Write the row at dispatch: task, owner, `in flight`, the branch, no PR. At settle, update that row with the outcome, resolved evidence, PR, and final status. Update it when the status changes, not at every step.

Keep `work/` out of commits. Git ignores it at the repository root, so a checkout never shows it in `git status`; in a shared checkout you may instead put it outside the repository and name its absolute path in the first reply. A plan or a ledger is never a repository file: what a reviewer needs goes into the reply or the pull request description.

## The task page

`work/<task>.md` holds what the row cannot: the goal, the done predicate, what is out of scope, the phase plan (`figure-it-out`), decisions, open questions, and links. The owner writes it. A later session reads it after the index row.

Keep it current enough to resume from. Do not copy the transcript into it.

## The decision log

For unattended or multi-phase work, append `work/decisions.tsv`: `ts`, `phase`, `decision`, `why`, `evidence`, `result`, one row per decision, each cell on one line. Log forks, completed units, pivots, reverts, and blockers. Skip routine actions.

Append-only. A wrong row gets a new row that supersedes it. Never edit or delete one. It stays out of git: when a reviewer needs the trail, summarize it in the reply or the pull request description rather than committing the file.

## Rules

- One ledger. No per-session copies and no status that lives only in chat.
- Evidence first. If the pointer does not resolve, the row is wrong.
- Owners update their own rows. A correction to another owner's row is a new row that names it.
- Never delete a row. A superseded task gets a new row that names the old one.
- Before handoff, walk your rows and resolve each pointer. Add what is missing. Correct the log, not the story.
- The row goes in before the work starts and closes when the work settles. A task with no row is invisible to the next session.

`resume` reads this file first, so a gap here becomes a gap in the next session's picture.
