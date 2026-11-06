# Pause safely

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.**

This is explicit only. "Keep going", "going to bed, keep going", and "do not stop" are not
a pause.

1. Stop at a safe boundary. Finish or back out of the current atomic step. Start nothing
   new.
2. Cancel nested work. `subagents` lists the tree; `subagents` with `action: "kill"`
   stops a child that must not run unattended. Read a child's transcript with
   `sessions_history` when its report is the only record of what it did, and put the
   finding in `work/<task>.md`. Stop watchers whose condition no longer matters.
3. Take no irreversible action to pause: no new PR, no push, no merge, no deletion, unless it
   was already going out.
4. Make the work durable. Commit uncommitted edits as one `wip:` commit on the current
   branch, staging only files you changed. If the tree does not build, say so in one line in
   the commit body.
5. Write the ledger. Update `work/index.md` (state, head SHA, PR, next action) and
   `work/<task>.md` (decisions, evidence, open questions). That is the record the next agent
   reads; a chat summary is not.
6. Record the exact resume point: the branch and worktree path, the last verified command
   and its result, what is on disk versus still in your head, and the first action on
   resume.
7. Record the blockers: a decision waiting on the operator, a PR waiting on approval
   (`gh pr view <number> --json state,mergeStateStatus`), a check that was red when you
   stopped, and any fixture that will be stale on resume.
8. Do not leave a watcher that will act after you stop. One that only reports is fine; one
   whose outcome is a merge or a push is not.
9. Report: where you are in the loop, what is on disk (paths, no diff dumps), the commits you
   made and whether the tree is clean, the watchers still running, and the first action on
   resume. This is a pause, not a final report.
