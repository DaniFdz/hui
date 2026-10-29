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
fixture model. Its recorded model names and prices stay unchanged.
Shared `PAGE-021` tests instead send real PI turns and run `/compact` through
the deterministic local provider. They check recorded zero prices, unchanged
dated totals after compaction, and the separate amount in an empty range or
with no matching sessions.

## Visible journey

1. Open `/usage`. Confirm **30d**, inclusive **From**/**To**, **Time zone** set
   to Local, the scope note, token/PI estimate/session summaries, a usage chart,
   the overview, rankings and session rows. Partial pricing must identify unpriced
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
   distinct marker in Cost; all prices remain PI estimates. Choose a day to
   narrow the range. Use Tab to enter the chart once, arrow keys to move between
   bars, and Enter to apply a day; focus moves to **Apply range**.
5. Filter by title, ID and recorded model. Totals, rankings and chart must follow
   the same subset. Enter a nonmatching query, confirm **No sessions match your
   search.**, then **Clear search**. Try all **Sort sessions** options. Recorded
   zero sorts before unknown prices. The amount outside the entries remains
   unchanged by the session search. Open a Durable session and **Design notes**
   from their rows. Both must show recorded messages and an Idle status.
6. Choose an empty day and confirm **No usage in this range.** Return to 30d.
   Submit a reversed range; the error must name the attempted range while the
   last successful chart retains its own dates. Fix the fields and apply them.
   **Refresh** must keep successful data on screen while reading again.
7. Inspect 1440×900, 1024×900 and 390×844, including controls and lower session
   rows. The controls must align within each wrapped row. The top metrics must
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
