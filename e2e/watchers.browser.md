# Background watchers browser verification

Date: 2026-10-02. Verified against commit `2893443` of
`dani.fernandez/show-background-pr-watchers`, launched with the repository
visual-verification fixture (`e2e/visual-verification.mjs launch`) and driven
with the Browser tool. Only the model provider is mocked
(`e2e/pi-provider-fixture.mjs`, `E2E_WATCHER`); HUI, the gateway, the real PI
SDK worker, the `watcher` extension, the process spawn and the browser are
real. No operator transcript, credential or GitHub account was used.

## Reproduce

1. From the checkout: `node e2e/visual-verification.mjs launch --branch
   dani.fernandez/show-background-pr-watchers`, then `doctor` on the receipt.
2. In the Browser tool, open the receipt's `browserUrl`, choose the printed
   workspace as the project directory and send `E2E_WATCHER`.
3. The fixture calls the real `watcher` tool twice in one turn: a quick
   `printf 'posted /merge\n'; sleep 30` watcher and a long
   `printf 'watching #21532\n'; sleep 600` watcher.

## Observed

- The conversation's top-right gutter showed two *Background watcher* cards,
  one per call. Each carried its purpose, start time and latest log line; the
  quick watcher turned from *Running* to *Done* on the gateway's poll and showed
  `posted /merge`, its target link `github.com/ddoghq/web-ui/pull/21532`,
  *Then: post /merge* and *Restart* / *Dismiss*. The long watcher showed
  *Running*, `watching #21532` and *Stop*.
- *View log* on the settled card fetched the bounded tail through
  `GET …/watchers/:id/log` and rendered "1 line", `posted /merge`, plus
  *Refresh* and *Close*; the card's own *View log* became *Hide log*. Closing it
  removed the panel.
- *Stop* on the running watcher reported *Stopped* with `ended just now` and
  offered *Restart* / *Dismiss*. The process group was gone afterwards
  (`kill -0 -<pid>` fails; the real process is also covered by
  `server/watchers.test.ts`).
- *Restart* on the stopped watcher returned it to *Running* with a fresh
  `Started just now`; *Dismiss* on the settled watcher removed its card, its log
  and its exit record, and left the restarted card in place.
- At 1440×900 the cards sat inside the conversation pane's gutter without
  overlapping the sidebar or the transcript; at 390×844 the card, its metadata
  and its actions stayed inside the viewport with no horizontal overflow.
- Browser console: no page errors. The only entries were the fixture's known
  development warnings (Lit dev mode and a lit `change-in-update` scheduling
  warning already present in this dev fixture).

## Evidence

Screenshots captured from the running instance (desktop 1440×900 and mobile
390×844) and attached to the pull request; they are not committed here. The
agent host that captured them reports its own model could not render images,
so the three PNGs were inspected by a separate vision-capable reviewer against
the expected states above before being attached.

## Limits and gaps

- The fixture's watcher commands are synthetic. No real pull request was
  watched and no `/merge` was posted by this journey.
- The dead and failed states, PID-reuse reconciliation and stop escalation to
  `SIGKILL` are covered by `server/watchers.test.ts` (including a process that
  traps `SIGTERM`), not by this browser journey.
- Deleting a conversation with a running watcher is covered by
  `server/watcher-routes.test.ts`.
