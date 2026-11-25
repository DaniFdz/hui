# Session pickup

**You own the resume point. Read the prior trail, do not redo it.**

1. Find the ledger first: `work/index.md` and the task's `work/<task>.md`. It names the
   goal, the owner sessions, the branch, the PR, the decision log, and the last recorded
   head. Without a ledger, say so and reconstruct from Git.
2. Read the child transcripts. `sessions_list` shows the tree with lifecycle metadata;
   `sessions_history` reads a bounded transcript for one session key. Read the owner's last
   report and the verifier's verdict, not every tool call. Parse a long transcript in a
   fresh worker and keep only the timeline in this conversation.
3. Reconstruct operational state: the branch and worktree, what landed
   (`git log --oneline origin/main..HEAD`, `git diff origin/main...HEAD`), the PR state
   (`gh pr view <number> --json state,headRefOid,mergeStateStatus,statusCheckRollup`,
   `gh pr checks <number>`), and uncommitted files (`git status --short`).
4. Diff done against planned. Compare the ledger's rows with what Git and the PR actually
   show. The trail is authoritative input, but a ledger row without a pushed commit or a
   merged PR is a claim, not a fact.
5. Name the resume point in one line: the next unit of work, the branch it happens on, and
   the command that proves it.
6. Verify inherited claims against the real artifact before relying on them. A prior PASS is
   not proof if its head SHA is not the current head, and a prior self-report is not
   evidence at all.
7. Route the remaining work: `autonomous-run` to keep driving a predicate, `shipping` to
   land a verified run, `hillclimb` for a metric, `worktree-cleanup` for a dead checkout.
   This playbook ends where the routed one starts.
8. Report: where the prior agent stopped, what you inherited, what you redid (ideally
   nothing), the resume point, and the first action taken.
