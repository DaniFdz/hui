# Chat file links journey

File references in the agent's replies and tool cards open in the Files view
(SPEC *Files*, "File references in the chat"). Verified with HUI's isolated
visual-verification launcher, real Pi Durable and the deterministic provider
fixture; no operator files, sessions or credentials. Keep screenshots outside
Git and put them in the PR description.

## Reproduction

1. `npm ci`, then, without the ambient HTTP proxy for loopback,
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`
   and `doctor` on its receipt.
2. In the receipt's `workspace` create `src/lib/greeting.ts` (60 lines),
   `README.md` and `docs/design.md` (at least two lines each).
3. In a labeled Browser-tool tab at 1440×900, start a session in that workspace
   with `E2E_RICH`, then send `E2E_FILE_LINKS`. Its reply names
   `src/lib/greeting.ts:3`, `README.md`, `docs/`, `src/lib/greeting.ts#L58`,
   the missing `src/lib/missing.ts` and `notes/todo.md:12`, the code spans
   `npm test`, `greet()` and `1.2.3`, the links `docs/design.md#L2`,
   `docs/missing.md` and an https link, and a fenced block importing
   `./src/lib/greeting.ts`.
4. With the Work pane never opened, click `src/lib/greeting.ts:3`. Open a
   terminal from the chat header and click `README.md`; click the design notes
   link; collapse `docs` in the navigator and click `docs/`. Hide the Work
   pane, focus the reply, Tab to the first link and press Enter. Expand the
   *Read fixture.txt* card and click its path.
5. Create `src/lib/missing.ts` on disk and send another message.
6. At 390×844, tap `README.md`.

## Observed (2026-10-10)

- Only existing paths became links (link colour, dotted underline and the
  tooltip *Open src/lib/greeting.ts at line 3 in Files* on hover); missing
  paths, `npm test`, `greet()`, `1.2.3`, prose and the fenced block stayed
  plain; the https link stayed a web link. Nothing moved when the links appeared.
- The first click opened the Work pane with one Files tab, *greeting.ts*, the
  navigator expanded to `src/lib` and line 3 highlighted with the cursor on it.
- With a terminal tab active, `README.md` reused and activated the Files tab;
  the design notes link switched the Markdown file to **Source** and
  highlighted line 2; `docs/` expanded that folder in the navigator.
- From a hidden pane, Tab reached the link (*Open src/lib/greeting.ts at line 3
  in Files*) and Enter expanded the pane on the file at line 3.
- The read card's absolute path linked to `fixture.txt` and opened it.
- After the next turn ended, `src/lib/missing.ts` became a link.
- At 390×844 the tap switched the panel selector to *README.md · Work* with the
  file open; no horizontal overflow; no page or console errors.
