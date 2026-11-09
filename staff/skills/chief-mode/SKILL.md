---
name: chief-mode
description: "Use when leading a HUI task from request to evidence: restate the goal, pick one playbook, route each step to a subagent, and report what proved it."
---

# Chief mode

## 1. Restate the goal

Write one line: what the operator wants, the problem behind it, and the smallest outcome that
settles it. Repeat it at the top of the first reply, in every brief, and under the pull
request's `## Why`. Do not wait for confirmation. When the evidence rules the change out, show
it and stop.

Keep the HUI surfaces current. `set_stage` when the work enters a stage (`investigation`,
`implementation`, `testing`, `done`). `update_goal` only when the operator set a goal and the
work is done or blocked three turns; HUI's refusal when none is active is normal.
`suggest_task` for a defect outside this task, not fixed inline. `watcher` for a wait such as
an approval or a CI run, then end the turn. `present_media` for screenshots to see.

## 2. Pick exactly one playbook

| The request | Playbook |
| --- | --- |
| A read-only question about how or why something works, or a choice between options | `playbooks/investigation.md` |
| A reported defect to reproduce, root-cause and fix | `playbooks/bug-fix.md` |
| New or changed behavior | `playbooks/feature.md` |
| A behavior-preserving change to structure | `playbooks/refactoring.md` |
| A measured slowness, fixed once | `playbooks/perf.md` |
| Sustained improvement of one metric against a target | `playbooks/hillclimb.md` |
| A throwaway sketch that settles a design or behavioral question | `playbooks/prototype.md` |
| Pixel-level equivalence between two implementations | `playbooks/visual-parity.md` |
| How a skill or prompt change affects agent behavior | `playbooks/eval.md` |
| Writing or editing a skill | `playbooks/authoring-a-skill.md` |
| Work spanning phases or stacked pull requests | `playbooks/multi-phase-plan.md` |
| A live or captured runtime artifact to diagnose | `playbooks/forensics.md` |
| Driving one task to a predicate without stopping | `playbooks/autonomous-run.md` |
| A standing program, few human turns, many workers | `playbooks/orchestrate.md` |
| A queue of pull requests run through to merged | `playbooks/autopilot-full.md` |
| A queue built and verified, then handed to the operator | `playbooks/autopilot-stack.md` |
| Driving a pull request to merge-ready | `playbooks/babysit.md` |
| Landing a verified stack, bottom-up | `playbooks/shipping.md` |
| The pull request a code change ends with | `playbooks/opening-a-pr.md` |
| Suspending work so a cold start can resume it | `playbooks/pause-safely.md` |
| Resuming a prior session's in-flight work | `playbooks/session-pickup.md` |
| Reclaiming disk from merged or abandoned worktrees | `playbooks/worktree-cleanup.md` |

No match for a large or novel effort: `figure-it-out` designs the playbook, written at
`work/<task>-playbook.md` in the same shape as these. A request that only settles an empirical
question about behavior, timing or layout routes to `prototype.md`, not to a question.

Copy the playbook's numbered steps verbatim into `work/<task>.md` before adding a
task-specific step. A step left undone stays with `skip: <reason>`, and the playbook is
re-read at each phase boundary; drift from it is what this pack exists to stop.

## 3. Choose a route per task

Pass one of `planner`, `explorer`, `worker`, `reviewer` or `verifier` as `route`. `delegate`
owns what each route may do, when a fresh child is required, and when the job needs `swarm` or
`arena` instead. Read it before the first spawn. Raise `thinking` for the hardest work and
lower it for routine work. A route HUI refuses is unusable: spawn without a route, inherit the
caller's model, and say so in the ledger row.

**Set the lead.** A task with more than one step or more than one worker gets one
`lead`: spawn a single `worker`-route child with the whole task and the `lead` skill's
brief. The lead spawns its own workers, reads their evidence, retries them and reports
once. You stop watching its workers: their completions land in the lead's transcript, not
this chat. Message it only for a decision it escalated or a scope change. One lead per
separable area; stop at three levels (you, leads, workers).

## 4. Open a ledger row per task

Write the row in `work/index.md` at dispatch and settle it there. `show-me-your-work` owns the
five columns, the statuses, the task page at `work/<task>.md` and the decision log. Add the
`Route` and `Child` columns where a step needs them; never invent a second ledger.

## 5. Brief every child

`delegate` owns the brief. Every spawn carries its five fields in its order: goal, scope,
evidence, write paths, forbidden actions. Add the restated goal and the verdict words. One
fresh child per task; a fix round, retry or follow-up gets a consolidated brief, never a
relayed summary. Name paths; never inline whole files.

## 6. Fan out only across disjoint work

`delegate` owns the caps and the shapes. Independent units fan out from one `codemode` script
with `collect: true` and `agents_wait`; coverage belongs to `swarm` and a design fork to
`arena`. Two workers never edit the same file at once, and a child never receives another
child's report. You read the results, decide, and assign the next unit; when a lead owns
the area, its rollup is the result you read.

## 7. Check every claim

Every claim carries its proof in the same line: the command and its output, the path, the
screenshot, the `file:line`, the commit SHA, the pull request URL. A claim without proof is a
guess and is labeled one. Verdicts are `VERIFIED`, `NOT VERIFIED` or `INCONCLUSIVE`, and
inconclusive is not a pass. Read the diff, open the screenshots, rerun the command a claim
rests on. Never pass a child's summary through as your own finding.

The lead writes no product code, only `work/`, the plan, the ledger, commit messages and the
reply. An edit the lead makes anyway gets a `reviewer` pass before handoff, named in the
ledger.

## 8. Close and reply

A task is closed when every step is checked or skipped with a reason, the checks the change
needs ran and are named with their result, and every user-visible change has browser evidence
at desktop and mobile widths. Open the reply with the restated goal, then what changed, what
proved it, what was chosen and why, what stays open, and the proof gaps. Short declarative
sentences, no emoji, no long dash, and never a claim that an unrun check passed. One line
per task, never one per child; a lead's rollup is one item.

## 9. Keep one lesson

When a check failed for a reason nothing recorded, a worker drifted from its brief, or the
operator corrected the same thing twice, load `learn` and add one evidence-backed entry to
the bot's own `lessons` skill. The pack's skills are read-only; lessons are this bot's. Do not
learn from a worker's report alone, and do not turn a lesson into a rule for the operator.
