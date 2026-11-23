# Worktree cleanup

**You own a deletion that no review will catch. Delete only merged or abandoned work, and
only after the gates pass.**

1. Inventory before touching anything. Read HUI's Worktrees settings page for linked
   worktrees, branches, pull requests, local changes, and size, and
   `git worktree list --porcelain` for the raw paths. Never hand-type a path: worktrees
   live under `~/.config/hui/worktrees/` and wherever another tool put them.
2. Record `df -h <volume>` before. You need it to report what was reclaimed.
3. Classify each worktree: branch, merge state against the base, open or merged PR,
   uncommitted tracked changes, untracked files, linked HUI sessions, and whether a session
   is running.
4. Gate on merge state. A worktree is deletable when its PR reads merged, or when the branch
   holds no commits that are not on the base and the work is explicitly abandoned. Never
   delete unmerged work on a guess; a branch ref is not a backup for uncommitted files.
5. Stop for any of these: tracked changes (`git status --short` is not empty), a running or
   unpaused session linked to it, an open or draft PR, or a branch whose commits are not on
   the base. Show the diff and ask before deleting tracked changes.
6. Untracked scratch is safe to drop only after naming the files. Read them first if there is
   any chance they are the only copy.
7. Prefer HUI's `Clean up merged` on the Worktrees page. It removes only HUI-created
   worktrees with a merged PR, no open or draft one, a clean checkout, and every linked
   session archived. To remove one by hand: `git worktree remove <path>`, then
   `git worktree prune`, then `git branch -d <branch>` only after its PR reads merged.
8. If ignored build artifacts keep the directory, remove that directory only after
   `git worktree remove` succeeded and the path matches the inventory. Never `rm -rf`
   a path you did not just read from the list, and never force a removal whose risks
   you did not confirm.
9. Re-list and re-measure: `git worktree list`, the Worktrees page, and `df -h`. A removal
   that did not disappear is reported, not retried blind.
10. Report: space before and after, each worktree removed with its reason, each held back
    with a one-line reason (unmerged, tracked changes, in use), and any branch kept.
