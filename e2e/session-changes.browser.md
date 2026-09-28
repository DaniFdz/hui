# Session changes card browser verification

Verified on 2026-09-26 with the Browser tool against the real HUI gateway
(Vite, port 5321), packaged PI 0.87.1 restoring a seeded transcript, real Git
with a local bare remote, and the fake `gh` (`e2e/github-cli-fixture.mjs`). No
operator transcript, repository or GitHub account was used.

## Reproduce

1. `R=$(mktemp -d /tmp/hui-changes-e2e-XXXX)` then
   `node e2e/session-changes-fixture.mjs $R node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`.
   It creates `$R/workspace` on `main` (pushed to `$R/remote.git`) with
   uncommitted `src/hero.css` and `src/hero.js`, written by the transcript's
   `edit`/`write` tools, plus `notes.txt`, which the session never touched.
2. Start Vite with `HOME`, `XDG_CONFIG_HOME=$R/xdg`, `PI_AGENT_DIR`,
   `PI_CODING_AGENT_DIR=$R/pi-agent`, `PI_CODING_AGENT_SESSION_DIR=$R/pi-sessions`,
   `PI_OFFLINE=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
   `HUI_GITHUB_CLI=$PWD/e2e/github-cli-fixture.mjs`, `HUI_FAKE_GH_DIR=$R/gh`,
   and HTTP proxy variables unset. Use an owned headless browser (profile under
   `$R`) at 1200×900, then 390×844.

## Observed

- Opening *Marketing hero* from the sidebar showed the card after the last
  assistant message: *Changes ready to commit*, a READY pill, `main +8 -1`, and
  three rows. `src/hero.css` and `src/hero.js` carried a *session* tag and were
  checked; `notes.txt` was unchecked (`2/3 files selected`).
- Clicking the `src/hero.css` row expanded its inline diff (`-  color: black;`,
  `+  color: white;`, the added animation and keyframes) with add/delete tints.
- *Open draft PR* (no utility model configured, empty message) created
  `feature/update-hero-css-hero-js` from `main`, committed only the two session
  files as "Update hero.css, hero.js", pushed that branch (the remote's `main`
  unchanged) and ran `gh pr create --draft --base main --head
  feature/update-hero-css-hero-js --fill`. The notice read "Created …, committed
  8621423 …, pushed, opened draft pull request #42. Open on GitHub"; `notes.txt`
  stayed modified and uncommitted, now unselected.
- After a reload the card showed the branch title, a DRAFT PR pill, `→ main`,
  `1 commit`, committed rows marked with a commit glyph, a disabled *Push* and
  *View pull request* linking to the PR.
- At 390×844 the header, meta line, file rows and the three actions fit the
  width without horizontal scrolling.
- With a `pre-receive` hook rejecting pushes, checking `notes.txt` and clicking
  *Commit & push* committed it ("Update notes.txt"), failed the push, and sent
  the session a hand-off prompt naming the push step, Git's
  `remote: error: pushes are blocked by branch policy`, the completed commit and
  "then push the branch". The card said "HUI stopped: … The session's agent is
  finishing it." and showed `2 commits`, `1 unpushed` with *Push* enabled.

## Long file lists (2026-09-26 follow-up)

Seeded with `--many` (240 extra untracked `assets/icon-NNN.svg`, 243 changed
files in total):

- The card listed `src/hero.css` and `src/hero.js` first (session files survive
  the 200-row cap, `2/200 files selected`), clipped the list to two and a half
  rows (91.5px, the third `assets/icon-000.svg` row faded and inert: only two
  *Include* checkboxes in the accessibility tree), with a toggle
  `+241 more · Show first 200` and "Showing the first 200 of 243 changed files."
- The toggle expanded all 200 rows inside a 458px list (60vh) that scrolls on its
  own (`scrollHeight` 7399); *Show fewer files* restored the 91.5px view.
- At 390×844 the collapsed card fitted without horizontal scrolling.
- The *Open draft PR* GitHub mark renders filled (`.btn svg` had outlined it).

## Split diff and setting (2026-09-26 follow-up)

- At 1440×900 the card was 768px wide; opening `src/hero.css` rendered the
  side-by-side table (`data-layout="split"`): old lines 1–3 with `color: black;`
  tinted red on the left, new lines 1–8 with the colour and keyframes tinted green
  on the right, the removed line paired with the first addition and empty
  cells below it.
- Resized to 390×844 (card 374px) the same diff switched to the unified view
  (`data-layout="unified"`); long lines scroll inside the diff (346px client,
  391px scroll) and the page has no horizontal overflow.
- Settings → Integrations shows a *Git* section below GitHub with a *Changes
  card* switch. Turning it off saved `git: { changesCard: false }` to
  `settings.json`; reopening the session rendered no `hui-changes-card` and the
  browser made no `/__hui/sessions/:id/changes` request.

## Agent-proposed commit and pull request text (2026-09-26 follow-up)

The fixture transcript now ends with a `propose_changes` call.

- Opening the session prefilled *Commit message* (subject plus body), *Pull
  request title* and *Pull request description* (Markdown), each labelled
  *from agent*.
- Typing a new title (`Animate the hero on load`, real keyboard input) removed
  that field's *from agent* label; the other two kept it.
- *Open draft PR* created `feature/animate-the-marketing-hero-on-load`,
  committed with the agent's full message and ran `gh pr create --draft … --title
  "Animate the hero on load" --body "## Summary …"`: the edited title plus the
  agent's description, with no utility-model call. The card then showed the PR
  title, DRAFT PR and *View pull request*; with only `notes.txt` left and
  unselected, the text fields were hidden.

## Proof limits

- GitHub was the fixture `gh`; real `gh pr create` authentication and
  repository permissions were not exercised.
- The header's +/− counts only listed files when the list is capped.
- Utility-model commit messages and PR drafts are covered by
  `server/session-changes.test.ts`, not by this browser run.

## Only after a proposal (2026-09-27 follow-up)

The fixture's second session, *Fresh task*, shares the same dirty checkout but
has only a user message and a text reply (no `propose_changes`). Opening it
from the sidebar rendered no changes card (the `hui-changes-card` element held
no `.changes-card`). Switching to *Marketing hero*, whose transcript ends with
`propose_changes`, showed *Changes ready to commit* with the proposed fields.

## Stacked pull requests (2026-09-27 follow-up)

Seeded with `--stack`: the checkout is on `feat/hero-base` (pushed, open draft
PR #12 in the fake `gh`) and the proposal carries `action: "stack"`.

- The card read *Stack on #12* with a STACK pill, "New branch from
  `feat/hero-base`; its draft PR targets #12", the commit message and PR fields
  prefilled from the agent, and *Commit to #12* beside *Open stacked PR*.
- *Open stacked PR* created and switched to
  `feature/animate-the-marketing-hero-on-load`, committed the two session files
  there and pushed it; `feat/hero-base` on the remote was unchanged. The fake
  `gh` recorded `pr create --draft --base feat/hero-base --head
  feature/animate-the-marketing-hero-on-load` with the proposed title and body.
- The notice read "Created …, committed … “Animate the marketing hero on load”,
  pushed, opened draft pull request #42 stacked on #12." and the card switched
  to the new draft PR (*View pull request*) rather than offering to stack again;
  `notes.txt` stayed uncommitted and unselected.

## Agent-chosen action (2026-09-27 follow-up)

The proposal's `action` picks the primary button. Seeded with `--commit` (on
`main`, no PR) the card showed *Commit & push* as primary and *Open draft PR*
as secondary; with `--pr --commit` (open PR #12) *Commit to #12* was primary
beside *View pull request*; with no flags (`action: "pr"`) *Open draft PR* was
primary. The `--stack` journey above still applies with `action: "stack"`.

## Hand-off with the command and output (2026-09-28 follow-up)

Default fixture, plus a `pre-receive` hook on `$R/remote.git` that prints a
moved-repository notice (`This repository moved. Please use the new location:`,
`git@github.com:example-org/web.git`) and `ERROR: Permission to example-org/web.git
denied to developer.`, then exits 1.

- *Open draft PR* created `feature/animate-the-marketing-hero-on-load`,
  committed the two session files and failed the push. The card read "HUI
  stopped: remote: ERROR: Permission to example-org/web.git denied to developer. The
  session's agent is finishing it." and showed `1 commit`, `1 unpushed`.
- The session received the hand-off as its next user message (before the
  pending-decision change below; it now arrives as the `propose_changes` tool
  result): the push step
  and first error line, *Command HUI ran* with `git push --set-upstream origin
  HEAD:refs/heads/feature/animate-the-marketing-hero-on-load`, *Its output*
  with every `remote:` line including the new `example-org/web.git` location, the
  created branch and commit under *Already done*, then "push the branch, open a
  **draft** pull request" and the requested text.
- At 390×844 the message wrapped without horizontal page overflow.
- The fixture model is unreachable, so the agent's turn ended with *Connection
  error.*; the hand-off itself, not the agent's recovery, is what this proves.
  Unexpected (non-Git) failures are covered by `server/session-changes.test.ts`.

## Branch pushed without upstream (2026-09-28 follow-up)

Seeded with `--agent-pushed`: every edit committed on `feat/hero-agent`, pushed
with `git push origin feat/hero-agent` (no `--set-upstream`, as agents usually
run it before `gh pr create`) and open PR #14 in the fake `gh`. Driven with an
owned headless Brave over CDP, because the Browser tool's navigation policy
blocked `127.0.0.1` on the verifying host.

- `origin/main` rendered the card for this checkout: *Animate the marketing
  hero*, OPEN PR, `1 commit`, `1 unpushed` and a primary *Push*, although the
  remote branch already held that commit.
- The fixed branch rendered no card at 1440×900 or 390×844 (the
  `hui-changes-card` element held no `.changes-card`).
- After one more local commit the card returned with `2 commits`, `1 unpushed`
  and *Push*. Clicking *Push* pushed with `--set-upstream` (local and remote
  heads matched), the card said "Pushed." and a reload rendered no card.

## A pending decision, like a question (2026-09-28 follow-up)

`propose_changes` now waits for the operator and the card is its answer, so the
seeded transcript's finished call no longer shows a card: the sections above that
open *Marketing hero* and expect the card from the seed predate this. Reproduce
with `node e2e/session-changes-fixture.mjs $R … --provider http://127.0.0.1:43191`
and `HUI_E2E_PROVIDER_PORT=43191 HUI_E2E_WORKSPACE=$R/workspace
HUI_E2E_PROVIDER_LOG=$R/provider.jsonl node e2e/pi-provider-fixture.mjs`; a
prompt containing `E2E_PROPOSE` makes the real PI SDK worker call the tool.
Driven with an owned headless Brave over CDP (real clicks and keyboard input)
because the Browser tool's navigation policy blocked `127.0.0.1`.

- Opening *Marketing hero* showed no card (`hui-changes-card` held no
  `.changes-card`) although the checkout was dirty and the transcript ends with
  a finished `propose_changes` call.
- Sending `E2E_PROPOSE ship the hero` from the composer turned the header to
  *Waiting for your answer*, the sidebar row to the waiting hand, and rendered the
  card with the agent's commit message, PR title and body (*from agent*),
  *Keep iterating*, *Commit & push* and a primary *Open draft PR*. The generic
  question dock did not appear.
- *Open draft PR* created `feature/animate-the-marketing-hero-on-load`, committed
  the two session files, pushed, and the fake `gh` recorded `pr create --draft
  --base main --head feature/animate-the-marketing-hero-on-load --title "Animate
  the marketing hero" --body "## Summary …"`. The card collapsed to its notice and
  the agent replied with the returned decision ("The operator shipped the change
  … opened draft pull request #42."). After a reload there was no card.
- A second `E2E_PROPOSE` showed the card again (DRAFT PR, *View pull request*);
  *Keep iterating* closed it and the agent received "The operator chose to keep
  iterating instead of shipping."
- A third `E2E_PROPOSE`, answered by typing *Rename the button first* in the
  composer: the card closed, the message appeared as a user turn and the provider
  log shows the tool result ("… dismissed the proposal and wrote to you instead
  …") followed by that message.
- At 390×844 the waiting card, *Keep iterating* and the resulting reply fit
  without horizontal scrolling. No page errors at either size.
