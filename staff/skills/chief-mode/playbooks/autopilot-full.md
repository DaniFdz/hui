# Autopilot full

**This playbook merges on its own verdict only where the target repo allows it. Read the
target repo's AGENTS.md and CONTRIBUTING.md before the first spawn. On HUI's own repository
it stops at `autopilot-stack`: AGENTS.md requires the owner's explicit approval, so nothing
here merges an HUI PR.**

**You own the verdicts, never the PRs. One owner carries each PR from build to verified,
and only a verifier that did not write the code can clear it.**

1. The operator's gates come first. A grant covers the queue it named and nothing else.
   Items the operator reserved stop at merge-ready. A request to state the plan is not a go.
2. Open the ledger and one owner per PR. `work/index.md` plus `work/<task>.md` record each
   PR, owner, head, verdict, and merge. Owners run in parallel off `main`, never stacked;
   stacked work is `autopilot-stack`. Use `gh` for every PR operation.
3. Each owner opens its PR early so CI and review run alongside the work, and reports the
   code-ready head before self-proof. Every later head is reported too. A head missing from
   the ledger is drift, not a detail.
4. Run the full verifier set once at the code-ready head. Lanes re-run the gates, prove the
   load-bearing behavior on the real surface, and audit the diff. A rebase, a conflict
   resolution, or a small fix gets one verifier at the new head; a wording-only change gets
   none.
5. Require a verifier per merge that is not the author, on a different model family. Spawn
   it with `sessions_spawn` on a different route or raw `provider/id`; the author's
   self-report is not a verdict.
6. Block only on what you can show: a failing run at the head, a gate that did not run, a
   doc line the PR makes wrong. A problem the base already had does not block unless the PR
   copies it or newly reaches it. Everything else is a follow-up.
7. Merge only what was verified and tested on the trunk it lands on. Fetch `main` right
   before merging and ask whether its changes can affect the patch. Rebase and wait for CI
   when the code that would land was never tested: a conflict, a file both sides changed, or
   a changed check set. Otherwise merge.
8. Guard the gates. Anything that loosens one (a budget, an allowlist, a skipped check)
   needs a verifier's proof and your fresh countersign. A disabled or soft-failed check
   always comes out. Never bypass an approval the forge enforces.
9. Audit while the run lasts. Arm a repeating `watcher` sized to the work, re-read this
   playbook from the target repo each tick, and probe every owner down to the lanes by its
   side effects: pushes, PR activity, ledger rows. Replace a stuck owner at once instead of
   waiting for it to stop. A tick that changed nothing stays quiet.
10. Stand down at once on the operator's stop. Every owner gets a zero-writes order and
    reports where it stands. Keep this playbook's rules for the restart.
11. Report: each PR's state and verdict, what merged and why, the countersigns, the open
    operator gates, and the parked follow-ups, with the PR numbers.
