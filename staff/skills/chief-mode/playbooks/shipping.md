# Shipping

**You own what lands. Verify each PR independently, land only the verified run, keep your
hands off the stack afterward.**

1. Resolve the forge once. PRs go through `gh`; confirm the account with `gh auth status`
   before the first PR operation and use the same account for view, checks, and merge.
2. The target repo gates the merge. On HUI, AGENTS.md requires the owner to review every PR
   and merge only after explicitly approving that PR with checks green; an approval on one
   PR is not an approval for the stack. On another repo, follow its AGENTS.md and
   CONTRIBUTING.md.
3. Take a verdict per PR from an agent that did not write it, on a different model family.
   The PR keeps its one owner; the verifier only reports. A verifier runs the change the
   way a user would (the app in `browser`, the CLI in `terminal`, the artifact through
   `present_media`) and reports PASS, PASS+NOTES, or FAIL with evidence. Green CI is an
   input, never a verdict.
4. Build the verified run from the bottom. Walk up from the lowest unmerged PR and stop at
   the first one without PASS or PASS+NOTES. That top PR is the ceiling. A verified PR above
   an unverified one waits, because it cannot land without the code below it.
5. Re-check that the verdict still describes the code. Compare `git patch-id` at the verdict
   SHA with the current head. A rebase moves every PR above it to a new SHA without failing
   any check. Re-verify anything that moved, and rerun a lane whose evidence is a running
   server rather than a build.
6. Land bottom-up, one PR at a time. Confirm the PR is mergeable at its current head,
   then `gh pr merge <number> --squash --delete-branch`. Read the result back with
   `gh pr view <number> --json state,mergedAt`. A merge command can mean queued or
   armed for auto-merge; only `MERGED` is merged.
7. Move the next PR up. When its base was the merged branch, retarget with
   `gh pr edit <number> --base main`, replay its patch onto the merge result, and push
   with `git push --force-with-lease`. Keep the branch holding only the commits the PR
   owns.
8. Leave the stack alone while it lands. One merge at a time; a second merge waits for the
   first to read `MERGED`. A base that moves to main is expected, not damage. If a merge
   stalls, find out why before changing anything.
9. Stop at the ceiling. Extending the run needs fresh verdicts, which is a new pass from
   step 3.
10. Report: the verified run and its ceiling, each PR's verdict and who produced it, what
    landed and how you confirmed it, and what the next gap needs.
