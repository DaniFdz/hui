# Background watchers browser verification

Date: 2026-10-02. Verified against commit `04207b7` of
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

- Nothing floats over the conversation. The two watchers appear at the end of
  the transcript, just above the composer, as one background-activity summary
  line: *2 watchers · 1 running · Wait for #21532 review signals* once the
  quick watcher's poll turned it *Done*.
- Opening the summary listed two one-line rows: *Wait for #21532 review
  signals · watching #21532 · Running · 59s ago* and *Post /merge when approved
  · posted /merge · Done · 59s ago*.
- Opening the *Done* row fetched its log tail and showed the target link
  `github.com/ddoghq/web-ui/pull/21532`, *Then: post /merge*, start and end
  times, a log box with `posted /merge`, the PID and log path (ellipsized) and
  *Restart* / *Dismiss*.
- Opening the running row and pressing *Stop* turned it *Stopped*; the summary
  read *None running*. *Restart* returned it to *Running* with a fresh start
  time. *Dismiss* on the finished watcher removed it, and with one watcher left
  the group became a single row.
- At 390×844 the collapsed summary is one line above the composer; closed rows
  show only the purpose and state (the latest output appears once a row is
  opened), and the opened row keeps the ellipsized path, *Restart* and
  *Dismiss* on one line inside the conversation width. At 1440×900 the rows sit
  within the transcript column and also show the latest output.
- Browser console: no page errors. The only entries were the fixture's known
  development warnings (Lit dev mode and lit `change-in-update` scheduling
  warnings).

## Evidence

Screenshots captured from the running instance (desktop 1440×900 and mobile
390×844, collapsed and opened) and attached to the pull request; they are not
committed here. The agent host that captured them could not render images, so
the PNGs were inspected by a separate vision-capable reviewer against the
expected states above before being attached.

## Limits and gaps

- The fixture's watcher commands are synthetic. No real pull request was
  watched and no `/merge` was posted by this journey.
- The dead and failed states, PID-reuse reconciliation and stop escalation to
  `SIGKILL` are covered by `server/watchers.test.ts` (including a process that
  traps `SIGTERM`), not by this browser journey.
- Deleting a conversation with a running watcher is covered by
  `server/watcher-routes.test.ts`.
