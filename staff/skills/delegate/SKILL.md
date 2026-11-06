---
name: delegate
description: "Use when handing part of a task to a subagent: write the sessions_spawn brief with goal, scope, evidence, write paths, forbidden actions, and route."
---

# Delegate

Write the brief before you spawn. The child sees the brief and the files it opens, not your conversation. A brief that leaves a decision open gets the child's default, not yours.

## The brief

Every `sessions_spawn` task answers these, in this order.

1. **Goal.** The operator's goal in one sentence: the outcome, not the activity. Say who the result is for and what changes for them.
2. **Scope.** What to read, what to change, where to stop. Name the boundary in files, routes, or surfaces. If the work grows past it, stop and report instead of widening it.
3. **Evidence.** The exact command that decides done, and the output it must print. `npm test -- src/views/home.test.ts` expects `12 passing` and exit 0. For a change, give the before and after. "Tests pass" is not evidence.
4. **Paths.** The worktree, branch, and files it may write. Name what it may not write: the shared checkout, another session's worktree, `dist/`, generated output, and every path outside the brief. Pass `worktree: true` to `sessions_spawn` when the child writes code, so it gets its own checkout off yours; its `cwd` is then the new worktree and its branch carries HUI's prefix. Parallel workers never share a working tree.
5. **Never.** The actions it must not take: push, merge, force-push, rewrite a shared branch, delete data, install dependencies, change a persisted format, message outside HUI, or open a PR unless the brief makes it the PR owner. Anything hard to undo waits for the parent.
6. **Report.** Result, branch and diff pointer, each command with its output, gaps, and guesses. No self-grade. A summary is a claim; the command output is the evidence.

Keep the brief in the task text. A path alone is not a brief; it leaves the goal and the done predicate open.

## Pick a route

Pass one route name to `sessions_spawn`, never a route and a model together.

| Route | Job |
| --- | --- |
| `planner` | Decide a shape or a sequence. Read only. |
| `explorer` | Answer how or where something works. Read only. |
| `worker` | Implement one scoped change and its check. |
| `reviewer` | Read a diff and report defects. Read only. |
| `verifier` | Run the checks independently. Read only. |

Choose the narrowest route that finishes the job. A fix round, a retry, and a follow-up each get a fresh child with a consolidated brief: the original goal, the prior result, the branch, and the new feedback. Resume an existing child only when the work needs state that cannot move, such as its checkout, uncommitted changes, or a running process.

A route HUI refuses is not usable: it is unknown, or its model is missing from the catalog. Spawn without a route, inherit the caller's model, and say so in the ledger row.

## Fan out

For several independent units, spawn them from one `codemode` script with `collect: true`, then `await agents_wait({ ids })` and return the combined results.

- HUI caps a tree at 32 collected children running at once, 50 queued or running, and 8 ordinary children. A collected child cannot spawn collected children.
- Children report to the parent only. They do not message siblings or relay status. The parent owns the queue, the aggregation, and the next assignment. Steer or stop a running child with `subagents`; never spawn a second child onto its slice.
- Coverage fan-out belongs to `swarm`; a design bakeoff belongs to `arena`. Point there instead of inventing a shape here.

## Own the result

Read the diff, not the summary. Re-run the deciding command. A child's report is evidence of what it ran, not proof that the result is right.

One owner per PR. The session that opened the PR, or the one handed it, pushes that branch, answers review, and merges. A handoff is explicit in the ledger row: branch, PR, and what remains. Never let two sessions write one branch.

Record the dispatch and the settle in `work/index.md`, following `show-me-your-work`.
