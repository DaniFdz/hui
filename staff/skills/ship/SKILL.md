---
name: ship
description: "Use when committing, pushing or opening a pull request in HUI, or when an open PR needs its description, checks and evidence brought up to date."
---

# Ship

Land one coherent change through a reviewed pull request. Never commit to or push
`main`.

## Before the first commit

Read `AGENTS.md` and `.github/pull_request_template.md`. Confirm the work is one
change. Two unrelated fixes are two branches.

Check `git status --short`. A shared checkout holds other agents' work, so stage
only your files. Read `git-selective-staging` before touching a file someone else
may be editing, and never stash, reset or clean their changes.

Messages and PR titles start with a type: `feat:`, `fix:`, `docs:`, `refactor:`,
`test:` or `chore:`. The body says what changed in behaviour and why, in prose a
reviewer reads in a minute. Link a log rather than pasting it, and leave SHA
lists and metric tables out.

## Checks

Run them, then put the exact commands in the PR body and tick the template boxes
that match. `CONTRIBUTING.md` holds the full list and `verify` says which ones the
change needs. Never list a check that did not run. Never weaken an assertion to
make one pass.

A user-visible change also needs its `e2e/catalogue/` entry, its shared test in
`e2e/tests/`, and a Browser-tool journey through the changed controls. When a test
changed but the behaviour did not, put the use-case IDs on the
`Unchanged behaviour:` line instead.

## Screenshots

Capture fresh images of this branch's HEAD through
`.agents/skills/hui-visual-verification/SKILL.md`: desktop at 1440x900, mobile at
390x844, the affected state at each size, and the iOS screens when the app shows
the change.

Attach the images to the PR description with GitHub, for example
`gh pr create --body-file body.md --attach shot.png`, and post the same images in
the conversation. Never commit an image, a base64 payload or a local media path
to a working branch or `main`. When the upload fails, keep the PR draft and name
the gap.

## Review and merge

Ask for review from someone other than the author. Push follow-up commits to the
same branch, because a second pull request splits one change in two. Address each
comment with a new commit, then resolve that thread. Reply in the thread when you
decline or need a decision, and leave it open.

Merge only after the owner approves that pull request and its checks are green.
An ordinary PR publishes nothing. When the branch grows a second change, split it
rather than editing the title to cover both.
