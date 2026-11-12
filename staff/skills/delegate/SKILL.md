---
name: delegate
description: "Use when handing a quick child one job or writing a new session's brief: goal, scope, evidence, write paths, forbidden actions, and route."
---

# Delegate

## Which one

A child is for fast iteration: read-only, one command, one small check, one reply. It never
owns a branch or a pull request.

A session is for everything else: more than one step, writes, a long build, test or e2e, or
anything that owns a branch or a pull request. Write the same brief and create it with
`create_session`. The group's New session defaults decide the worktree and the worker; name
one only where the group leaves it unset. Do not spawn it.

If you cannot name the one reply a child returns, it is a session.

## The brief

Write the brief before you spawn or hand off. The child sees the brief and the files it opens,
not your conversation; a new session sees its brief and its checkout. A brief that leaves a
decision open gets the child's default, not yours.

Every child's task and every session brief answers these, in this order.

1. **Goal.** The operator's goal in one sentence: the outcome, not the activity. Say who the result is for and what changes for them.
2. **Scope.** What to read, what to change, where to stop. Name the boundary in files, routes, or surfaces. If the work grows past it, stop and report instead of widening it.
3. **Evidence.** The exact command that decides done, and the output it must print. `npm test -- src/views/home.test.ts` expects `12 passing` and exit 0. For a change, give the before and after. "Tests pass" is not evidence.
4. **Paths.** For a child, the files it may read or write; it gets no branch or pull request. For a session, the branch, its base, the worktree directory and the worker when one is available. `machines` owns the choice: call `worker_stats` before naming a worker, spread independent sessions, and leave headroom. Name what it may not write: the shared checkout, another session's worktree, `dist/`, generated output, and every path outside the brief. Parallel sessions never share a working tree.
5. **Never.** The actions it must not take: push, merge, force-push, rewrite a shared branch, delete data, install dependencies, change a persisted format, message outside HUI, or open a PR unless the brief makes it the PR owner. Anything hard to undo waits for the parent.
6. **Report.** Result, branch and diff pointer, each command with its output, gaps, and guesses. No self-grade. A summary is a claim; the command output is the evidence.
7. **Done.** For a session: the pull request merged, and deployed and validated in production where that applies. The operator archives the session then; tell them when this is true and never archive it yourself. For a child: the one named reply and its evidence.

Keep the brief in the task text. A path alone is not a brief; it leaves the goal and the done predicate open.

## Pick a route

Pass one route name to `sessions_spawn`, never a route and a model together.

| Route | Job |
| --- | --- |
| `planner` | Decide a shape or a sequence. Read only. |
| `explorer` | Answer how or where something works. Read only. |
| `worker` | Implement one small change in its worktree and return it; no push or PR. |
| `reviewer` | Read a diff and report defects. Read only. |
| `verifier` | Run the checks independently. Read only. |

Choose the narrowest route that finishes the job. A fix round, a retry, and a follow-up each get a fresh child with a consolidated brief: the original goal, the prior result, the branch, and the new feedback. Resume an existing child only when the work needs state that cannot move, such as its checkout, uncommitted changes, or a running process.

A **lead** is a session with a different brief, not a sixth route and not the chief's default. Use one only inside a session the operator started for the task, or when they ask for one: give it the whole task, name the `lead` skill, and tell it to spawn its own fast workers and report once. Its workers' completions go to the lead. It messages this chat with `sessions_send` only for a real decision.

A route HUI refuses is not usable: it is unknown, or its model is missing from the catalog. Spawn without a route, inherit the caller's model, and say so in the ledger row.

## Fan out

For several independent fast units, spawn them from one `codemode` script with `collect: true`, then `await agents_wait({ ids })` and return the combined results. A unit that writes more than a small change, or owns a branch or PR, is a session.

- HUI caps a tree at 32 collected children running at once, 50 queued or running, and 8 ordinary children. A collected child cannot spawn collected children.
- Children report to the parent only. They do not message siblings or relay status. The parent owns the queue, the aggregation, and the next assignment. Steer or stop a running child with `subagents`; never spawn a second child onto its slice.
- Coverage fan-out belongs to `swarm`; a design bakeoff belongs to `arena`. Point there instead of inventing a shape here.

## Own the result

Read the diff, not the summary. Re-run the deciding command. A child's report is evidence of what it ran, not proof that the result is right. A session owns its result; you read the evidence it reports and keep the ledger row.

One owner per PR. The session that opened the PR, or the one handed it, pushes that branch, answers review, and merges. A handoff is explicit in the ledger row: branch, PR, and what remains. Never let two sessions write one branch.

A lead's rollup is one report. Read the lead's diff and evidence, not each worker's summary; the workers reported to the lead for a reason.

When a child failed, drifted or taught you something the next kickoff should carry, load `learn` and add one evidence-backed entry to the bot's own `lessons` skill. The pack's `delegate` is read-only; lessons are the bot's.

Record the dispatch and the settle in `work/index.md`, following `show-me-your-work`.
