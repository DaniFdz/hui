# Long session titles must not hide pane controls

Verified on 2026-09-25 using the real SDK fixture and Browser tool. All names,
groups and transcripts were synthetic; no operator or work sessions were read
or changed. Include fresh screenshots in the PR description, outside Git history.

## Setup and reproduction

- Run `npm ci`, then
  `HUI_E2E_PORT=43320 NO_PROXY=localhost,127.0.0.1 npm run e2e:sdk`.
- Use the fixture's disposable workspace and guarded session creation API to
  seed a long sentence title and project label. Open it from the visible sidebar.
- At 1440×900, click **Open split view**. Before the fix, the active header was
  588 px wide with a 703 px scroll width; its close button ended at x=1555,
  outside the 1440 px viewport. A hidden body scrollbar did not prevent the bug.
- Send `E2E_SUBAGENTS_START` through the composer to create a real child. For
  the boundary case, patch only that disposable child's organizer metadata to
  a 200-character title and group, both without spaces. Reload its route.

## Observed results after the fix

- The header reserves space for actions; title and metadata each use an
  ellipsized line. The heading's native tooltip retains the complete title.
- **Open parent** and **Continue** become labeled icon controls according to
  the header's container width, even on a wide desktop viewport.
- At 588 px, header scroll width equals its width and **Close session pane**
  lies inside the panel. Clicking it reduces two panes to one without removing
  the session. Reopening the split continues to show the existing session.
- Focus the column divider and press End to reach the 320 px pane floor. The
  long-title child header remains 48 px high and 320 px wide, with no overflow.
  Hit-testing the center of the close button returns that button. **Open parent**,
  terminal, Continue, pane menu and close controls all remain inside the header.
- Starting at the divider, Tab reaches the child header's parent button. Four
  further Tabs focus **Close session pane**; Enter closes only that pane.
- At 390×844, wait for the narrow layout, then verify the 382 px visible header
  has no overflow. Navigation, parent, terminal, Continue and close remain
  reachable; hidden sibling panes are not counted as visible controls.

## Validation

- Focused `npm test -- src/views/home.test.ts`: 32 passed.
- Full `NO_PROXY=localhost,127.0.0.1 npm test`: 581 passed after integrating
  the concurrent main changes through `c3332ee`. Typecheck and build were also
  repeated; that final integration did not change this header's UI code.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.

The integration restarted Vite while the tab was loading, causing transient
connection-refused/reset resource errors. Reloaded after the server was ready
and repeated the visible header checks on the integrated code. No page exceptions
were reported.

This is a HUI header layout repair; backend contracts, persisted session data
and reference stylesheets are unchanged. Stop only this fixture's launcher and
close its Browser tab after collecting the final desktop/mobile screenshots.
