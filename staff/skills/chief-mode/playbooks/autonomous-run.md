# Autonomous run

**You own the exit condition. Define done, then drive to it without asking for permission
you already have.**

1. State the exit condition as a predicate that can pass or fail before the first
   iteration, and write it at the top of `work/<task>.md`: a command and its expected
   output, a repro that must stop failing, a pixel diff of zero, or "PRs 41, 44, 47 merged
   with the owner's approval". A duration is not a finish condition.
2. Keep a decision log in that file, one row per iteration: id, hypothesis, change,
   evidence, verdict (kept or reverted). Read it before each iteration so you do not retry a
   discarded idea.
3. Pick the wake mechanism. An event (CI, a merge, a review, a file appearing) gets a
   `watcher`; it ends the turn and HUI wakes the conversation when it settles. With no
   event, use a fixed interval sized to when the result is worth re-checking, never a tight
   poll. One watcher per condition.
4. Each iteration makes the smallest change the evidence justifies, then verifies it
   against the predicate. Commit only when the predicate advanced; revert a change that did
   not help, in full. "Might help" does not ride along.
5. Run the check that owns the behavior, not a proxy. For HUI that is usually
   `npm test -- <file>`, `npm run typecheck`, and a `browser` check for user-visible
   work; widen to `npm test`, `npm run build`, or `npm run e2e` when the change reaches
   them.
6. Verify each unit before starting the next instead of batching checks at the end. A
   passing unit that the next change breaks was never verified.
7. Mid-run discoveries that support the goal are yours. A broken verifier, a flaky test,
   stale docs, or an orphaned follow-up gets fixed in its own PR, then you return to the
   predicate. Park what does not block the predicate with `suggest_task`.
8. Keep HUI state honest while you run: `set_stage` when the run changes stage, and
   `update_goal` only when the predicate is met and verified.
9. Define the escape hatch before you need it. Stop and report when the same blocker
   survives two different approaches, two consecutive iterations move nothing, the work
   needs a decision no experiment can settle, or the next step is irreversible. Never relax
   the predicate to declare victory.
10. Stop when the predicate is met. A plateau is not a stop: change the approach once, then
    take the escape hatch rather than spin.
11. Report: the predicate and its final state, the iterations run, what landed, what was
    discarded and why, and the first action on resume.
