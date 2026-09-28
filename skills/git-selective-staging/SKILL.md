---
name: git-selective-staging
description: "Commit only your own changes when the checkout already holds other uncommitted work (another session, agent or the operator), including inside the same files; verify the commit excludes that work. Use before committing in a shared or reused checkout."
license: MIT
metadata:
  tags: "good practices"
---

# Selective Git staging

Use when the working tree contains uncommitted changes you did not make and
must not commit: another session or agent sharing the checkout, the operator's
work in progress, or a reused branch. `git add <path>` stages a whole file, so it
would carry those changes along whenever they sit in a file you edited.

HUI's changes card commits whole files (`git commit --only -- <files>`). When a
file you changed also holds someone else's hunks, do not ship it from the card:
stage your hunks with this procedure and commit yourself, or tell the operator.

## 1. Record what was already there

Before editing, run `git status --porcelain` and `git diff --stat`. Files already
listed as modified are the ones that will need selective staging.

## 2. Snapshot dirty files you are about to edit

```bash
mkdir -p /tmp/<name>-base && cp --parents <paths> /tmp/<name>-base/
```

Files that are still clean need no snapshot; a plain `git add <path>` stays safe
for them.

## 3. Edit narrowly

Change only what the task requires and keep your hunks clear of the unrelated
ones where the task allows. Two changes sharing a line, or close enough to share
diff context, cannot be separated afterwards.

## 4. Stage your hunks against the snapshot

```bash
diff -u --label a/<path> --label b/<path> /tmp/<name>-base/<path> <path> > /tmp/mine.patch
git apply --cached --check /tmp/mine.patch
git apply --cached /tmp/mine.patch
```

Read `/tmp/mine.patch` before applying it: every hunk must be yours. Then stage
the files that were clean at step 2 with `git add <paths>`.

If you reach this procedure only after editing a dirty file, rebuild the
snapshot instead of abandoning isolation: `git show HEAD:<path> >
/tmp/<name>-base/<path>`, re-apply just the unrelated change to that copy, and
diff against it. Confirm the copy reproduces the unrelated hunks and that a
`grep -c` of an unrelated marker in `/tmp/mine.patch` returns 0; a base missing
them folds the unrelated change into your patch.

## 5. Verify, then commit

- `git status --porcelain` shows `MM` for a shared file (your hunks staged, the
  others not) and ` M` for a file whose changes are all someone else's.
- `git diff --cached` holds only your subject matter; the other work's markers
  do not appear in it.
- The index can already hold someone else's staged entry (`A ` or `M `), which a
  plain commit would carry. `git reset -q -- <path>` drops it from the index and
  leaves the file on disk; `git add <path>` after your commit restores exactly
  the state you found. Leave such entries staged while you build and test (some
  tools, such as Nix flakes, read only tracked files) and clear them only for the
  commit itself.
- Commit without `-a`, then check `git show HEAD:<path>` keeps the original value
  of everything you left alone.

**Done:** the commit contains only the requested change, and the other work is
still present and unchanged, including anything that was already staged.

## Pitfalls

- **Concurrent edits.** The snapshot protects work that existed before you
  started. If another agent edits the same file afterwards, its hunks appear in
  `/tmp/mine.patch` too. Drop hunks you did not write before applying, and if
  that is not possible, stop and tell the operator instead of committing them.
- `diff` exits 1 whenever the files differ, so a chain continuing with `&&`
  silently stops after it. Run each command separately or join with `;`, and
  read every exit status.
- `git add -A`, `git add .` and `git commit -a` defeat the procedure.
- Stashing the other work and restoring it later rewrites the working tree and
  can conflict on reapply. The index-only route leaves that work untouched.
- When your change is only valid together with an unrelated hunk (the tree does
  not build, evaluate or run without it), isolating it commits something broken.
  Include the hunk it needs and say why in the commit body.
- Never discard, revert or reformat the other changes, and keep snapshots and
  patches out of the repository.
