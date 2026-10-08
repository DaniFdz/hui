# Files view journey

Verified on 2026-10-09 with the real PI SDK runtime, the deterministic provider
fixture and HUI's isolated visual-verification launcher. No operator files,
sessions or credentials were used. Keep screenshots outside Git and put them in
the PR description.

The Files view is a Work view; until the Work pane (feat/work-pane) is merged,
the app has no launcher for it. This journey therefore mounted
`filesWorkViewKind.render(…)` beside the open conversation from a temporary,
uncommitted harness module imported by `src/main.ts` (a fixed panel over the
right half on desktop and full screen below 1100 px), standing in for the Work
pane. Once the view is registered with the Work pane, open it from its launcher
instead and repeat the same steps.

## Reproduction

1. `npm ci`, then, without the ambient HTTP proxy for loopback,
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`
   and `doctor` on its receipt.
2. Seed the receipt's `workspace` as a Git repository with a few TypeScript
   files under `src/lib/`, a `README.md` with headings, a list, a table and a
   code block, `docs/design.md`, `assets/logo.png` and a random
   `assets/blob.bin`.
3. In a labeled Browser-tool tab at 1440×900, create a session in that
   workspace with `E2E_RICH` and open a Files view for it.
4. Expand `src` → `lib`, open a `.ts` file and type with real key presses.
   Then change the same file on disk from a shell and type again.
5. Open `README.md`, switch Source/Rendered; open the PNG and the binary file;
   type in the filter; create a file; delete a folder; upload two files, one of
   which already exists. Repeat at 390×844.

## Observed

- The navigator listed folders first and hid `.git`. The TypeScript file opened
  in CodeMirror with line numbers, folding and syntax colors from the theme's
  code tokens. Typing showed **Saving…**, then **Saved** within a second; the
  disk held exactly the typed change (`git diff` showed only the added lines).
- Changing the file on disk and sending a chat message: once the turn settled,
  the clean editor showed the disk's new last line without a reload.
- With unsaved typing over a disk change, the save was refused: **Conflict** in
  the header and the banner "This file changed on disk while you were editing
  it." with **Reload from disk**, **Overwrite with mine** and the disk version
  under "Show the version on disk". The disk kept the external text until
  **Overwrite with mine**, after which it held the typed text and the header
  read **Saved**.
- `README.md` opened **Rendered** (headings, list, table, code block with its
  copy control); **Source** showed the Markdown in the editor.
- `logo.png` showed as an image preview from a blob URL; `blob.bin` showed
  "Binary file: it has no text to show here.", its size and modification time
  and **Download**; a one-page `docs/brief.pdf` rendered in the browser's PDF
  viewer.
- With a second disk change under unsaved typing, **Reload from disk** dropped
  the typed text, showed the disk version and read **Saved**.
- Filtering "lang" listed `file-languages.ts` with its folder `src/lib`;
  Escape cleared the filter and restored the tree.
- **New folder** and **New file** in the selected file's folder created
  `drafts/` and `notes.md` and opened the file; the same name again kept the
  dialog open with "Something with that name already exists."
- Deleting `docs` while `docs/notes.md` was open asked "Delete docs?", stated
  that deleting does not use the trash and cannot be undone, and listed "The
  folder docs and everything inside it." and "The open file docs/notes.md
  closes."; **Cancel** kept everything, **Delete** removed it from disk and the
  tree and closed the file.
- Uploading an existing `README.md` and a new text file with nothing selected
  wrote the new file to the root ("Uploaded 1 file to workspace") and asked
  "Replace the existing file?" listing `README.md`; **Replace** overwrote it.
- With the browser's color scheme set to dark, the view followed HUI's dark
  theme, editor included, without a reload.
- At 390×844 the editor took the full width with a 16 px font; the navigator
  opened as a drawer over a dimmed backdrop and closed on selection, on its
  close button or on the backdrop.
- The page reported no errors.

## Proof limits

- Mounted through a temporary harness, not the Work pane; tab title updates,
  keeping the view mounted behind other tabs and the `visible` refresh were
  exercised only by unit tests and code review.
- Drag and drop onto folder rows and a remote-worker conversation's "Files are
  not available" state were not driven in the browser; the route tests cover
  the remote refusal.
- The Browser tool returns console message counts but not their text; page
  errors were read (none).
- The Browser tool's pointer reports `hover: none`, so row delete buttons were
  always visible; on a desktop pointer they appear on hover and focus.
