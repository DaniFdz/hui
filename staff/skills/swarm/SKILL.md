---
name: swarm
description: "Use when coverage divides across slices or a race needs a winner declared before it starts: fan out workers and return one aggregated report."
---

# Swarm

Fan out workers over work that divides, then return one report. A swarm is coverage or a race, never a bakeoff: no candidate is picked. Use `arena` for a design fork and `delegate` when the whole job is one child.

## Frame

1. **Done predicate.** What the report must show for the swarm to be finished, in one sentence.
2. **Shape.** A coverage matrix, a race, or both.
   - Coverage: rows are slices (files, routes, platforms, test cases), columns are checks (test, repro, measure). Every cell names one worker. A slice with no check is not covered.
   - Race: N workers get the same brief and you pick one. Declare the rule before spawning: `first pass`, `rank all`, or `best-of <n>`.
3. **Brief.** Each brief stands alone: goal, slice or arm, exact command, expected output, paths it may write, and what to report. A worker reports `PASS`, `ISSUES`, or `BLOCKED` with the command and its output. A worker that can prove a defect lists every one it can prove, not only the first.
4. **Base.** When workers verify or measure commits, name the exact SHAs. For a measurement, name the method too: sample count, what one sample is, and the order.

## Fan out

Spawn all N workers from one `codemode` script with `collect: true`, then `await agents_wait({ ids })`. No worker reads another worker's report; the parent is the only place results meet.

HUI caps the tree: at most 32 collected children run at once, up to 50 may be queued or running, and ordinary children cap at 8. A collected child cannot spawn collected children. Keep one slice on one worker and split the swarm across slices, not across one worker's retries.

## Aggregate

Read the results, not the raw dumps.

- A report that omits the named command, SHAs, or method is a gap. Respawn that worker once with the missing requirement. After a second miss, record the gap and move on.
- A gap does not count as a pass. For coverage, every required cell needs a result.
- For a race, apply the declared rule mechanically. Do not choose a different winner after seeing the results.
- A dropout leaves the denominator and is named in the report.

## Report

One reply, under a page:

- A table with one row per slice or race arm: name, status, evidence pointer.
- Issues, one line each, with the command that proves it.
- Gaps: what is unverified, why, and what would close it.
- The race rule and the winner, when a race ran.

Record the swarm and its result in `work/<task>.md` and the ledger row, following `show-me-your-work`.
