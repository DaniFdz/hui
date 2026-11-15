---
name: resume
description: "Use when picking up a task after a handoff, a restart, or a break: rebuild the current state from the ledger, sessions, bot memory, git, and pull requests."
---

# Resume

Rebuild what is true before doing anything. A handoff summary, a completion card, and an old plan are claims. The ledger, the sessions, the branch, and the PR are the state.

Use on a new session, a takeover, after a restart, or when the operator asks where the work stands. If the operator already gave a full capsule with paths, branch, and change, verify it and skip the mining.

## Read, in this order

1. **Ledger.** `work/index.md` at the work root, or the absolute path the last session named, for the task row: owner, status, evidence, PR. Then `work/<task>.md` for the goal, plan, decisions, and open questions. For an unattended run, read `decisions.tsv` top to bottom.
2. **Sessions.** `sessions_list` for the tree and each child's status. `sessions_history` for the owning session and for every child that finished, failed, or was killed. A child's error is state; a child's "done" is a claim.
3. **Bot chats.** A bot's chat is its OptChat history, not a session transcript. In that chat, read its view, open a line with `zoom(id, n)`, and ask `date(id)` for when it happened. From any session, `hui bot history <bot>` prints the view and `--zoom id+n` opens one line. Zoom before you act, guess, or ask.
4. **Git.** `git status --short`, the current branch, `git log --oneline <base>..HEAD`, `git diff <base>...HEAD`, and `git worktree list`. Uncommitted changes are state; read them before deciding the work is lost or done.
5. **PR.** `gh pr list --head <branch> --state all`, `gh pr view <n> --comments`, and `gh pr checks <n>`, plus review threads. If `gh` is unavailable, say so and read the branch and the ledger instead of guessing.

## Reconcile

The ledger, the branch, and the PR must agree. Where they disagree, the artifact wins: a diff or a command's output beats a summary. Correct the task row and add a decision row that supersedes the wrong claim; never edit the decision log.

A stale owner is a real state. If the owning session is idle with work open, the task is unowned until you claim it. Claim it in the ledger before you touch the branch.

## Brief, then continue

Write the capsule in one screen:

- **Goal.** What the operator wants, in their words.
- **Threads.** Each workstream with its ledger status, branch, and PR. Use the same status words as `work/index.md`.
- **Problems.** The blockers and the last failed attempt, with its evidence.
- **Next move.** The one action that advances the goal most.

Then continue under the matching skill (`delegate`, `arena`, `swarm`, `figure-it-out`). Record the claim and the next row following `show-me-your-work`. Do not ask the operator to restate what you can rebuild.
