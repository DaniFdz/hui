# Autopilot stack

**You build and verify a stack. You never merge.**

This runs the `autopilot-full` loop with its merge step removed. Every loop tick prompt
names this file, so each tick sees the no-merge rule.

1. Read the target repo's AGENTS.md and CONTRIBUTING.md before the first spawn. On HUI,
   AGENTS.md requires the owner's explicit approval per PR, so stopping here is not a
   limitation, it is the contract.
2. Open the ledger and one owner per PR. `work/index.md` plus `work/<task>.md` record each
   PR, its owner, head, verdict, and evidence. Each owner builds, opens its PR by
   `opening-a-pr`, proves the change on the real artifact, and drives it green by `babysit`.
3. Open the PR early so CI and review run alongside the work, and report the code-ready head
   before self-proof. Report every later head too.
4. Stack only when a PR builds on another PR. Base the child on the parent's branch and the
   root on `main`; everything independent goes off `main` in parallel instead.
5. Verify once per head with lanes that did not write the code, on a different model family.
   Lanes re-run the gates and prove the load-bearing behavior live: the page in `browser`,
   the CLI in `terminal`, the artifact through `present_media`.
6. A new head on a lower PR restacks the PRs above it. Recompute `git patch-id`; a PR whose
   patch is unchanged keeps its verdict, and everything else gets a fresh one.
7. Stop at verified: every PR green and verified at its current head, none merged. Hand off
   the stack bottom to top with each verdict and the exact command that proves each head.
8. After the handoff nobody pushes without the operator's go. A fix request reopens the
   owning PR's owner, not the whole stack.
9. Report: each PR number, base, verdict, current head, and what the operator must decide
   before `shipping` runs.
