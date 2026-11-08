# Orchestrate

**You run the program, never the code. Decide who does each piece, then check what they
produced by reading the diff or the artifact.**

Use this for a standing program: many PRs, dozens of workers, few human turns. One task
driven to a predicate is `autonomous-run`.

1. Write the ledger before the first spawn. `work/index.md` holds one row per task: id,
   owner session key, PR, branch, state, evidence, verdict. `work/<task>.md` holds that
   task's brief, upstream reports pasted in full, decision log, and evidence. The ledger is
   the program's state, so a dead worker loses nothing that matters.
2. Keep three levels maximum: coordinator, sub-coordinators when one area has many
   parallel workers, workers. No fourth level. A sub-coordinator is a `lead` session you
   spawn as one `worker`-route child, not a bot: it owns that area's workers and sends you
   one rollup; it messages you only for a decision. Keep about ten workers in flight per
   coordinator: 8 ordinary children plus collected ones, or all collected in one
   `codemode` script. Start the next worker as one finishes instead of waiting on a
   batch.
3. One owner per PR. The owner is the only writer of its branch and carries the PR from
   build to merge-ready; it pushes, rebases, and retargets. You never author or edit code.
   Conflicted merges, rebases, and fixes go to owners.
4. A fresh worker per task. Spawn with `sessions_spawn`, using a `route` or an inherited
   model. At most 8 ordinary children run at once in one tree. For a wide fan-out, spawn
   with `collect: true` from one `codemode` script and await `agents_wait`: at most 32 run
   at once, 50 queued. `sessions_spawn` children started from a bot's chat have no
   sidebar row, so the bot chat's Parallel tasks card is the only list; record every
   child's identity in the ledger.
5. The kickoff names the evidence. Goal, one unit of work, writable and forbidden paths,
   forbidden actions, and the command or artifact that proves done. If you cannot name the
   evidence, the unit is not scoped.
6. Start with one unit end to end (kickoff, owner, verifier, handoff) before fanning out. A
   kickoff flaw then costs one worker, not ten.
7. Read the diff or the artifact, not the summary. Green CI is an input, not a verdict.
   Behavioral work needs a run, not a type check. A verdict covers one head SHA, so a new
   push needs a new verdict.
8. Every PR gets a verifier that is not its author, on a different model family. Use a route
   or a raw `provider/id` that differs from the author's. The owner moves to merge-ready
   only on that verifier's pass at the current head.
9. Never relay status between agents. No worker gets another's report through you: paste
   upstream reports into the kickoff, point at `work/<task>.md`, and let each agent read the
   PR with `gh pr view` and `gh pr checks`. Use `sessions_send` only for a follow-up on that
   agent's own work, never to check on it.
10. Judge a stalled worker by its pushes, PR activity, and file writes, not its status text.
    Replace it: smaller scope after a context limit, the same kickoff after a dropped
    connection, a different model after a tool error. After two retries, drop the unit and
    replan. Account for every spawned worker as done, replaced, or absorbed.
11. Send back drift: scope creep, a weakened assertion, an unrun check, unrelated edits. Fix
    only what blocks the program; park the rest with `suggest_task`.
12. On HUI, no owner merges without the operator's explicit approval on that PR. Ask the
    operator only for a real decision or blocker: merge approval, an irreversible action, a
    product call no experiment settles, or a dead end that survived a replan. Rebase
    mechanics, retries, CI flakes, and review triage never reach them.
13. Report: what landed against the goal, each PR's live state and verdict with its number,
    what was dropped and why, and the decisions waiting on the operator.
