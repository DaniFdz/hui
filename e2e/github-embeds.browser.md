# GitHub embeds browser verification

Verified on 2026-09-25 with the OpenClaw Browser tool against the real HUI
gateway (Vite, port 5198), real PI 0.87.1 transcripts and the fake GitHub CLI
(`e2e/github-cli-fixture.mjs`, canned `gh api` payloads). No operator GitHub
login, transcript or HUI registry was read or changed.

## Reproduce

1. `R=$(mktemp -d /tmp/hui-github-embeds-XXXX)` and
   `node e2e/github-embeds-fixture.mjs $R node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`.
   It seeds one session (*Checkout PR*) whose user message links issue
   `acme/web#7`, whose bash tool ran `gh pr create` printing `acme/web/pull/12`,
   and whose final assistant message mentions five references, one inside code.
2. Start Vite with `XDG_CONFIG_HOME=$R/xdg`, `PI_CODING_AGENT_DIR=$R/pi-agent`,
   `PI_CODING_AGENT_SESSION_DIR=$R/pi-sessions`,
   `HUI_GITHUB_CLI=$PWD/e2e/github-cli-fixture.mjs`, `HUI_FAKE_GH_DIR=$R/gh` and
   `NO_PROXY=127.0.0.1,localhost`.
3. Open `/sessions/github-embeds` at 1440×900, then 390×844.

## Observed

- The user message showed one card: **acme/web#7 · Closed** (completed icon),
  title, body snippet, author `lana`, labels `bug`/`mobile`, 4 comments.
- The assistant message showed exactly three cards in reading order:
  **acme/web#12 · Open** (green edge, +120 −34, 5 files, 3 comments),
  **acme/web#13 · Merged** (the `acme/web#13` shorthand resolved through the
  issues endpoint to the merged pull request, purple edge), and the **acme/web**
  repository card (Private, TypeScript, ★ 1.3k, 97 forks). The code-quoted
  `…/pull/99` and the fifth link `acme/missing` were not unfurled. Every card is
  an anchor to the item on GitHub with `target="_blank"`.
- The sidebar PR badge for `acme/web#12` turned **open** with the fixture title,
  confirming badges now use the same `gh api` previews instead of `gh pr view`.
- The previews route returned `not_found` for an unknown repository,
  `signed_out` when the fake account was removed, and 400 for a non-GitHub URL.
- At 390×844 the cards were 374 px (295 px inside the user bubble) with no
  horizontal overflow (`scrollWidth` 390).

## Hover and opt-out (2026-09-25 follow-up)

- Hovering the `acme/web#12` card opened the PR hovercard below it (340 px,
  `data-state="open"`) with the state pill, title and the full Markdown body,
  including the `Details` heading that the card snippet omits.
- Settings → Appearance → Chat listed *GitHub link previews* (on by default).
  Turning it off saved `chat.githubEmbeds: false`; reopening the session showed
  both messages with no `hui-github-embeds` element and no cards, while the
  sidebar PR badge stayed *open*.

## Proof gap

Previews were served by the fake CLI; the real `gh api` payload shapes were
checked against `repos/cli/cli`, `…/pulls/14517` and `…/issues/14517` and are
covered by `server/github-previews.test.ts`. Streaming unfurl (800 ms settle)
is covered by code review, not a live streaming turn.
