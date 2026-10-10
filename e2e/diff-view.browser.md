# Diff view journey

The Work pane's Diff view (SPEC *Diff*) against a stacked fixture repository.
Verified with HUI's isolated visual-verification launcher, real Pi Durable and
the deterministic provider fixture; no operator files, sessions or credentials.
Keep screenshots outside Git and put them in the PR description.

## Reproduction

1. `npm ci`, then, without the ambient HTTP proxy for loopback,
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`
   and `doctor` on its receipt.
2. Outside the repository, build a fixture repository: on `main` commit
   `src/greeting.ts`, `src/math.ts`, `README.md`, `docs/old-notes.md` and a 40-line
   `docs/guidelines.md`; branch `feature-a` and commit a change to `src/math.ts`;
   branch `feature-b` from it and commit a change to `src/greeting.ts`, then a new
   `src/version.ts`; back on `main` commit `docs/changelog.md`. On `feature-b`
   leave uncommitted: an edit to `README.md`, a new `src/divide.ts`, `docs/old-notes.md`
   deleted and `docs/guidelines.md` moved (not staged) to `docs/style-guide.md`
   with one more line.
3. Create a session in that directory (`POST /__hui/sessions` with its `cwd` is
   setup) and open it in a labeled Browser-tool tab at 1440×900.
4. Press Ctrl+Alt+Shift+D; maximize the pane (Ctrl+Alt+Shift+M). Choose **Side
   by side**, then the renamed file. Open the comparison menu and choose each
   comparison in turn; with **Against the previous branch**, untick **Include
   uncommitted** and open the branch picker.
5. Click a file's name in the diff header.
6. With **Uncommitted changes** shown and the chat beside the pane, create a file
   in the fixture and send a message; wait for the turn to end.
7. At 390×844 choose the Diff view in the panel selector, tap a file, then
   **Back to changed files**.

## Observed (2026-10-10)

- The view opened on **Uncommitted changes** with 4 files: `README.md` M,
  `docs/old-notes.md` D, `docs/style-guide.md` R *from docs/guidelines.md*, `src/divide.ts` A;
  totals +6 −2. In the default 560px pane the list and the diff take turns.
- Maximized, side by side showed the rename as *docs/guidelines.md → docs/style-guide.md*
  with only the added line 41.
- The menu listed *Last commit* (`db6b28b feature-b: version`), *Against the
  previous branch* (*feature-a (nearest ancestor)*) and *Against the default
  branch* (*main*). Previous branch with uncommitted changes: 6 files; without:
  `src/greeting.ts` and `src/version.ts`, syntax-coloured. The branch picker
  listed *feature-a* (detected, HEAD 2 commits ahead) and *main* (not an
  ancestor). Default branch: `greeting.ts`, `math.ts`, `version.ts` from the
  merge base, not the later `changelog.md`. Last commit: `src/version.ts` only.
- Clicking `src/version.ts` opened a Files tab on it at line 1.
- After the turn ended the list gained the new file without pressing Refresh.
- At 390×844 the list filled the screen; a tap showed the diff with the path
  over *from* the old one, and Back returned to the list; no horizontal overflow;
  no page errors. Dark theme checked at 1440×900.
