# Usage report

## Fixture and launch

Follow `.agents/skills/hui-visual-verification/SKILL.md` for checkout identity,
receipt checks, Browser actions, screenshots and cleanup.

```sh
node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" --usage-fixture
node e2e/visual-verification.mjs doctor --receipt <receipt.json>
```

This seeds timestamped Durable histories and one legacy PI transcript with
synthetic prices, tokens, three providers, cache usage, a recorded zero, an unpriced
record, a failed tool, an archived session, a child session and one compaction
whose summarization the store records in its spend ledger rather than an entry.
These are
recorded presentation fixtures, not this conversation's spend or provider
billing. The report does not contact a provider. Reopening a seeded session uses the local
fixture model. Its recorded model names and prices stay unchanged. Two of its
seeded turns print a pull request URL from a `gh pr create` command, so the
**Cost by pull request** card has two references without contacting GitHub.
Shared `PAGE-021` tests instead send real PI turns and run `/compact` through
the deterministic local provider. They check recorded zero prices, unchanged
dated totals after compaction, and the separate amount in an empty range or
with no matching sessions.

## Visible journey

1. Open `/usage`. Confirm **30d**, inclusive **From**/**To**, **Time zone** set
   to Local, the scope note, the headline strip (tokens, PI estimate, sessions,
   error rate) with a change against the range's earlier half, the chart and
   model donut side by side on a wide screen, the overview, rankings and session
   rows. A donut legend row must filter the page like a ranked model. Partial pricing must identify unpriced
   records, not make them free. The line for spend outside the entries gives its
   tokens and recorded cost and says it covers all recorded time; neither the
   summaries nor the chart may include it. A cost with no recorded tokens must
   still show. Ledger read failures must produce a partial-coverage warning.
2. Choose **Today**, **7d**, **90d**, **1y** and **All**. Check the chart's displayed
   range after each response. All includes older data. Empty days remain visible;
   ranges over one year group by month and retain empty months. The amount
   outside the entries stays unchanged when the range changes.
3. Edit **From** without applying it, then choose the current preset again. Its
   dates must replace the draft. Apply a custom range, switch **Time zone** between
   UTC and Local, and check that the returned range names the chosen calendar.
4. Switch **Tokens**/**Cost** and **Total**/**By type**. Unpriced days have a
   distinct marker in Cost; all prices remain PI estimates. Point at a day: a
   tooltip names its tokens by type, recorded price and records, and the column
   shows its whole hit area. Choose a day: it selects without changing the range
   or the active preset, and the selection names the same detail with **Show only
   <day>** and **Clear**. Choose it again to deselect. Use **Show only <day>**
   and confirm the range narrows and focus moves to **Apply range**. Use Tab to
   enter the chart once, arrow keys to move between bars, and Enter to select.
5. Confirm the overview adds **Error rate** and **Avg cost / record**, that a
   ranked model and provider name their share of the range's cost, and that
   **Days with errors** lists the fixture's failed day with its rate. **Daily
   CSV** and **Sessions CSV** must each download a file whose header and first
   row match the range shown.
6. Choose **1y** and confirm **Daily activity** draws one cell per day, with
   month and weekday labels; hovering a cell names its day, and selecting it
   offers **Show only <day>**. A 30d range must not draw the calendar.
7. Filter by title, ID and recorded model. Totals, rankings and chart must follow
   the same subset. A ranked model or provider applies the same search. Enter a
   nonmatching query, confirm **No sessions match your search.**, then **Clear
   search** beside the field. Try all **Sort sessions**
   options. Recorded zero sorts before unknown prices. Session rows state when
   they were last active. The amount outside the entries remains unchanged by the
   session search. Open a Durable session and **Design notes** from their rows.
   Both must show recorded messages and an Idle status.
8. Choose an empty day, confirm its selection says no recorded usage, and
   **Show only** it: confirm **No usage in this range.** and **Show all time**.
   Return to 30d. Submit a reversed range; the error must name the attempted
   range while the last successful chart retains its own dates. Fix the fields
   and apply them. **Refresh** must keep successful data on screen while reading
   again.
9. Press **Investigate** on the most expensive session row (`Investigate why …`).
   A new session must open, titled `Why was "<name>" expensive?`, whose first
   turn carries the recorded cost, tokens, models, tool output, cache share,
   costliest days, the same-project comparison with cheaper histories and
   **What to work out**. Its title must appear in the sidebar without a reload.
   Go back to `/usage` and confirm that row now reads **Investigated** and its
   action is **Open report**; it must reopen the same session without creating a
   second one. Go back to `/usage`, open a pull request link to confirm it points at GitHub,
   then press that row's **Investigate** and confirm the new session lists the
   sessions behind the pull request. Confirm a failed start (a target outside
   the range, refused by API) states the reason and leaves the report and its
   range on screen.
10. Hold the first report back with a delayed or blocked request. Confirm the
   skeleton, the **Reading HUI diagnostics…** status and, after six seconds, the
   slow-read note with **Cancel**. Cancel must leave either the last report or
   **Reading stopped.** with **Read histories again**, never a timeout error or an
   unavailable report. A blocked read must fail on the page's own cancel, not
   before.
11. Inspect 1440×900, 1024×900 and 390×844, including controls and lower session
   rows and both investigate buttons. The action must stay beside its row's
   numbers and keep its accessible name at every size. The selection stacks at phone width. The controls must align within each wrapped row. The top metrics must
   align with the search field's left edge and keep space between their columns,
   including **Unavailable** beside zero sessions in an empty range. Repeat a
   chart/filter interaction at phone width. Check keyboard focus, horizontal
   overflow and Browser console errors. Resize is not native-touch proof.

## Bounded synthetic stress

The default fixture stays at six sessions. The count applies only to `roots`,
`forks` and `dense`. Set the variables for the launch command rather than exporting
them:

```sh
HUI_E2E_USAGE_PROFILE=roots HUI_E2E_USAGE_SESSIONS=2000 \
  node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" --usage-fixture
node e2e/probes/usage-benchmark.mjs --receipt <receipt.json> --out <private-results.json>
node e2e/probes/usage-benchmark.mjs --receipt <receipt.json> --cpu 4 --mobile --out <private-mobile-results.json>
```

Profiles accept 20–2,000 sessions, including one legacy transcript:

- **roots**: mostly independent conversations (1,990 roots and nine true forks at 2,000).
- **forks**: ten roots and the remaining Durable sessions are true forks.
- **dense**: the fork-heavy profile with activity on every one of the last 90 days.

All profiles retain recent and multi-year records. Fork-heavy profiles are
adversarial, not a representative ancestry distribution. Seeding uses the real
Durable store without resuming conversations or calling a provider. Run only one
large fixture at a time; never substitute live or copied active session state.

The probe checks fixture ownership and the unchanged checkout through doctor,
then drives presets, repeated metric switches, typing, sorting, pagination,
chart keys and rapid range/zone changes in its own disposable Chromium profile.
Compare identical scenarios, query ranges and fixture profiles. Inspect the
recorded page counts; a populated first page grows from 50 to 100 sessions.
Capture and inspect the same interactions separately with the Browser tool.

Timing includes control scrolling and DevTools round trips. Main-thread, script,
layout and style work are scenario totals, not an isolated aggregation profile.
DevTools node counts include detached nodes; the initial light-DOM and sidebar
counts are separate. Resource duration includes waiting and transfer, not JSON
parse time alone. Four-times CPU throttling at 390×844 is desktop emulation,
not native phone performance. Small samples are observations, not percentiles.
Keep results private and publish aggregate measurements and synthetic captures
only. Stop the owned fixture with its receipt after the run.

## Evidence

Run doctor again before capture. Final PR screenshots must come from a clean,
committed HEAD and show both desktop and mobile. Keep screenshots and receipts
outside Git; attach the images in the PR description and conversation. Record the
commit, viewport, fixture type, observations and any limitation in the PR. Clean
up with the receipt and close only the owned Browser tab.
