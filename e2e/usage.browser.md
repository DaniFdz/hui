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
record, a failed tool, an archived session and a child session. These are recorded
presentation fixtures, not this conversation's spend or provider billing. The
report does not contact a provider. Reopening a seeded session uses the local
fixture model. Its recorded model names and prices stay unchanged.
Shared `PAGE-021` tests instead send real PI
turns through the deterministic local provider and check recorded zero prices.

## Visible journey

1. Open `/usage`. Confirm **30d**, inclusive **From**/**To**, **Time zone** set
   to Local, the scope note, token/PI estimate/session summaries, a daily chart,
   the overview, rankings and session rows. Partial pricing must identify unpriced
   records, not make them free.
2. Choose **Today**, **7d**, **90d**, **1y** and **All**. Check the chart's displayed
   range after each response. All includes older data. Empty days remain visible;
   ranges over one year group by month and retain empty months.
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
   zero sorts before unknown prices. Open a Durable session and **Design notes**
   from their rows. Both must show recorded messages and an Idle status.
6. Choose an empty day and confirm **No usage in this range.** Return to 30d.
   Submit a reversed range; the error must name the attempted range while the
   last successful chart retains its own dates. Fix the fields and apply them.
   **Refresh** must keep successful data on screen while reading again.
7. Inspect 1440×900 and 390×844, including controls and lower session rows. Repeat
   a chart/filter interaction at phone width. Check keyboard focus, horizontal
   overflow and Browser console errors. Resize is not native-touch proof.

## Evidence

Run doctor again before capture. Final PR screenshots must come from a clean,
committed HEAD and show both desktop and mobile. Keep screenshots and receipts
outside Git; attach the images in the PR description and conversation. Record the
commit, viewport, fixture type, observations and any limitation in the PR. Clean
up with the receipt and close only the owned Browser tab.
