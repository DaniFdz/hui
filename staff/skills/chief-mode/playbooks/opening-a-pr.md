# Opening a PR

**You own the PR a reviewer reads. One coherent change, a real verdict, and no claim you did
not run.**

Work from a feature branch in its own worktree. Create it with HUI's New Session worktree
mode or `git worktree add <path> -b <branch> origin/main`, and run its loop with
`npm run dev` or `npm run desktop`. HUI places its worktrees under
`~/.config/hui/worktrees/`; reuse the Worktrees settings page to see and remove them
instead of building your own inventory. In a shared checkout, check `git status --short`
first and never reuse another agent's branch or worktree.

1. Branch from an up-to-date `origin/main`. Fetch, then branch. Keep unrelated changes out; a
   shared checkout's dirty files are not yours.
2. Commit in units that could land alone, ordered to tell the story. Amend a fix into the
   commit it belongs to; add a new commit when it is separable. Commit bodies do not restate
   the subject.
3. Title with a Conventional Commits type: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
   `chore:`, `perf:`. Short, imperative, no trailing period.
4. Run the checks before writing the body, never after. For HUI: `npm test`,
   `npm run typecheck`, and `npm run build`; add `npm run test:package` for package or
   lifecycle changes, `npm run e2e` for shared use cases, and a `browser` run for
   user-visible work. Record each exact command and its result. Never list an unrun
   check, and never weaken a check to make it pass.
5. Write the description in HUI's `.github/pull_request_template.md` sections, dropping one
   only when it has nothing to say:
   - `## What changed`: one coherent change, the behavior not the diff, 1 to 3 bullets.
   - `## Why`: the problem and the approach, 1 to 3 short sentences. No SHAs and no rebase
     genealogy.
   - `## Checks`: the exact commands that ran and their result, boxes checked only for what
     ran, plus the verified commit and the browser actions with what you observed.
   - `## Use cases`: the `e2e/catalogue/` IDs the PR adds or changes, or the
     `Unchanged behaviour:` line with the IDs and names.
   - `## Visual evidence`: desktop and mobile captures of this PR's head for UI changes, or
     why not applicable.
   - `## Proof gaps`: what was not verified and why, otherwise `None`.
6. Open it ready, never a draft:
   `gh pr create --base main --title "<title>" --body-file <file>`. Read it back with
   `gh pr view <number>` before quoting its state, then post the number to the
   conversation.
7. Screenshots only for UI changes, and never committed. Follow
   `.agents/skills/hui-visual-verification/SKILL.md` and attach fresh captures of the
   committed head to the PR description. If the attachment fails, keep the PR draft and
   report the delivery gap.
8. Opening a PR does not start a babysit. Post the number and keep building. Start `babysit`
   when the operator asks, or when the playbook that spawned you assigns the loop.
9. On HUI's own repository, AGENTS.md requires the owner's explicit approval on that PR
   before a merge; opening a PR never authorizes merging it. When the target repo is not
   HUI, read its AGENTS.md and CONTRIBUTING.md instead.
10. A worker that opens a PR returns the number, the URL, and its check results to its
    coordinator, then returns to the parent without babysitting unless its brief says
    otherwise.
