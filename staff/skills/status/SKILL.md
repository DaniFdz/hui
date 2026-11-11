---
name: status
description: "Use whenever the operator asks for status, or a heartbeat changes a watched session: show the status table, then one question only if it needs a decision."
---

# Status

Answer with a table, not a narrative. One row per active session or task.

| Session | Pull request | Status / blockers |
| --- | --- | --- |
| [Session title](/sessions/<id>?open=app) | [#123 - title](https://github.com/owner/repo/pull/123) | Running: ... |

## The cells

- **Session**: `[title](/sessions/<id>?open=app)`. Use the absolute gateway URL when your prompt gives one; otherwise
  the root-relative link is clickable in HUI. Every row is a session the ledger says is in flight, not a child report.
- **Pull request**: `[#123 - title](url)`. Name every open PR for that session, one per line in the cell. Use `—` when
  there is no PR (an investigation, a local task, a planning session).
- **Status / blockers**: one short phrase. `Planning`, `Running`, `Waiting on CI`, `Merged`, `Deployed`, `Done`,
  `Blocked: <reason>`, or `Waiting on you: <decision>`. Put the blocker before any detail.

## After the table

If a row is waiting on the operator, ask the one decision it needs in a single question after the table. Do not
repeat the table in prose. If nothing needs the operator, write `No decisions needed.` once. If nothing is in flight,
draw one row: `No active work | — | Idle.`.

A status request always uses this shape. A heartbeat that changes a watched session is a status update too: show the
row for that session with what changed, add its PR if it has one, and ask only if it waits on the operator. Do not
start new work in a status answer.

## Example

| Session | Pull request | Status / blockers |
| --- | --- | --- |
| [Payments retry](/sessions/9f2c?open=app) | [#481 - retry the webhook](https://github.com/owner/repo/pull/481) | Waiting on CI; one flaky test |
| [Search audit](/sessions/71aa?open=app) | — | Done; evidence in `work/search-audit.md` |

No decisions needed.
