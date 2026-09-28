# Browser journey: local path autocomplete

Verified on 2026-09-24 with HUI's real gateway at `http://localhost:5174`
and the repository workspace `/home/developer/Projects/HUI`. The journey did not
create a session or send a prompt; it cleared the browser-owned New Session
draft after verification.

## Visible-control journey and observed results

1. Open **New Session**, choose the HUI repository as Project directory, focus
   the prompt and type `Review @s` through the visible textarea.
2. The **Local paths** listbox opens with `server/` and `src/`. ArrowDown moves
   the active option to `src/`; Enter replaces only the token with `@src/`,
   keeps focus in the textarea and refreshes the menu with that directory.
3. Continue with `hu`. The menu narrows to `src/hui-app.ts`; Tab completes the
   file without submitting the form and leaves Message focused.
4. The request log shows each cursor prefix reaching
   `GET /__hui/local-paths` with the selected project as `cwd`; all 12 observed
   requests returned HTTP 200. The final Browser error log and error-level
   console log both contain zero entries.
5. Inspect the open directory menu at 1440×1000 and 390×844. It stays attached
   above the shared composer, preserves the textarea/footer, exposes file and
   directory labels, and scrolls within the narrow viewport.

The browser flow covers New Session. Chat uses the same menu, parser, keyboard
handler and completion callback; focused source tests assert both render paths.
