# Descriptive generated session titles

Verified on 2026-09-28 with the repository visual-verification launcher, the
real PI SDK worker, and its deterministic local provider. All workspace,
configuration and transcript data was disposable and synthetic.

## Scope

- An omitted session name is generated from the first message as a concise
  three- to six-word title, at most 60 characters, in the message's language.
- The stored title keeps its descriptive context. Narrow surfaces own visual
  overflow instead of shortening the persisted value.
- Worktree branch naming remains a separate two- to four-word English
  kebab-case output, even when title and branch share one utility call.

## Browser journey

1. Launch the exact checkout with `node e2e/visual-verification.mjs launch
   --branch "$(git branch --show-current)"` and select `hui-e2e/fixture` as the
   isolated utility model.
2. Open **New session**, choose the launcher's disposable workspace, leave the
   name empty, and enter `Please improve the generated session titles so they
   preserve useful task context`.
3. Click **Start session** and wait for navigation to the new session. Observe
   **Improve session naming** in the document title, sidebar row and chat
   heading, plus the original message and deterministic **Fixture response.**
4. Inspect and capture the settled session at 1440×900 and 390×844. The desktop
   sidebar clips the row visually while the chat heading retains the complete
   title; mobile retains the complete title in its header.
5. Check Browser page errors and error-level console output, then run the
   launcher doctor again before capture handoff.

The final Browser run reported no page errors or error-level console messages.
Screenshots are transient PR/chat evidence and are not committed.

## Automated checks

- `npm test -- server/model-routing.test.ts server/hui-sse.test.ts`: passed.
- `npm test`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed with the existing large-chunk warning.
- `git diff --check`: passed.
