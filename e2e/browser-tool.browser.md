# Managed browser tool journey

Verified on 2026-09-28 with the real PI SDK runtime, HUI's managed headless
browser (Brave on NixOS, auto-detected) and the local deterministic provider.
User sessions, credentials, browser profiles and configuration were not used.
Keep fresh screenshots outside Git and include them in the PR description.

## Reproduction

1. Run `npm ci` and, without an ambient HTTP proxy for loopback
   (`env -u HTTP_PROXY -u HTTPS_PROXY -u NODE_USE_ENV_PROXY` where one is set),
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`.
   The launcher's allowlisted environment has no `DISPLAY`, so the headless
   default is the only mode that can launch on a headless Linux host.
2. Open the receipt's `browserUrl` in a dedicated labeled Browser-tool tab at
   1440×900. Create a session in the receipt's workspace with `E2E_BROWSER`.
   The provider fixture offers `/browser-fixture` on its own loopback port and,
   only when the request lists the `browser` tool, chains real tool calls:
   `open`, `act type` into the "Name" ref from the snapshot, `act click` on
   "Greet", `text` of `#greeting` and `screenshot`.
3. Open Settings → Tools and exercise the Browser section. Repeat at 390×844.

## Observed

- The session settled with "The headless browser rendered: **Hello, HUI agent!
  Rendered by page JavaScript.**", text the fixture page only produces after a
  real click. The activity group listed five rows: "browser Completed · open
  127.0.0.1:<port>/browser-fixture", "act type e1", "act click e2", "text" and
  "screenshot". The open row's output showed the accessibility snapshot with
  `textbox "Name" [ref=e1]` and `button "Greet" [ref=e2]`.
- Settings → Tools → Browser showed "Running · headless", Brave with its
  Chromium version, "headless, no window", the temporary HUI profile path, and
  one open tab ("t1 · HUI browser fixture", opened by the `E2E_BROWSER`
  conversation) whose preview showed the typed name and the green greeting.
  No browser window was opened on the host.
- Turning **Run headless** off stopped the running browser and removed its tab.
  **Start** then reported "A visible browser window needs a display, and the HUI
  gateway has none." Turning headless back on restored the default.
- Saving `/nope/chrome` as the executable showed "No executable browser was
  found at /nope/chrome." with a "Browser not found" status; clearing it
  returned to "Detected Brave · <path>".
- Killing the browser process externally changed the section to "Stopped after
  an error" with "The managed browser exited unexpectedly (SIGKILL)"; no browser
  process remained for the profile, and **Start** launched it again.
- At 390×844 the section stacked each control below its description without
  horizontal document overflow.
- The page reported no errors. The only console error followed the intentional
  windowed **Start** without a display (HTTP 409).

## Live view

Verified on 2026-09-28 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_SLOW` runs the same chain with 1.5 s before each model step, as a
real model would take, so the preview can be watched mid-run.

- As soon as the first `browser` call started, a preview card appeared under
  the tool activity: "Browser", **Connecting…** then **Live**, and
  "Opening the page…". The title became "HUI browser fixture" with the fixture
  URL, and the page appeared once it painted.
- While the agent worked, the footer followed each step (`Opened …`,
  `Typed 9 characters into e1 (textbox "Name")`,
  `Clicked e2 (button "Greet")` with the click marker on **Greet**,
  `Read the text of #greeting`, `Took a screenshot`) and the page showed the
  typed name and the green greeting. No browser panel opened by itself.
- When the turn finished, **Live** disappeared and the card kept the final
  frame above the answer, with "Took a screenshot" and its age.
- Selecting the frame opened the browser panel beside the chat on the agent's
  tab, showing the same page and the latest action.
- A second prompt in the same session moved the card to the new browser
  activity; the earlier one no longer had a card. At 390×844 the card filled
  the chat column and streamed the same way.
- After a reload, the card showed a fresh frame of the still-open tab, without
  **Live**, and stopped streaming (its connection idle).
- In the browser panel, picking another tab showed a **Follow agent** button;
  pressing it returned to the agent's tab. At 390×844 the panel is "Browser" in
  the panel selector.
- No page errors or console errors were reported.

## Stopping a turn

Verified on 2026-09-29 on macOS with Google Chrome (auto-detected) in the same
fixture at 1440×900 and 390×844.

- After a finished `E2E_BROWSER_SLOW` run, Settings → Tools → Browser showed
  "Running · headless" and its tab, which stays open for a follow-up.
- A second `E2E_BROWSER_SLOW` prompt in the same session was stopped with
  **Stop** after "Typed 9 characters into e1". The chat showed "This operation
  was aborted" and the preview card turned **Closed** with its last frame.
- Settings then showed "Stopped", no open tabs (the finished run's tab closed
  too) and "Starts when an agent opens a page and stops when its last tab
  closes. Stopping a turn closes its tabs; unused tabs close after 10 minutes."
  No Chrome process remained for the temporary profile.
- The 10-minute expiry is proven by `server/browser/manager.test.ts` with a
  short timeout, not by waiting in the Browser check.

## What a page keeps

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_STORAGE` opens a page that sets two cookies and two storage keys
with secret-looking values, then reads the cookies and the storage.

- The cookies read "2 cookies for 127.0.0.1:37909, values hidden:" with `sid ·
  session · 24 B` and `theme · session · 10 B`.
- The storage read "1 localStorage key on http://127.0.0.1:37909 (20 B), values
  hidden: draft · 20 B".
- Neither `cookie-secret-fixture` nor `draft-secret-fixture` nor
  `tab-secret-fixture` appeared anywhere in the results — the fixture asserts
  that, so a future change that prints a value fails the journey.
- Both results end with "Values are never read: a cookie or storage value is
  usually a session token."
- The reply read "The page holds 2 cookies (sid, theme) and one localStorage key
  (draft), and none of their values reached the transcript."
- At 390×844 both expanded outputs wrapped without sideways scrolling.
- `server/browser/manager.test.ts` also covers sessionStorage, a name filter, an
  empty filter result and an unknown `what`; `server/browser/storage.test.ts`
  covers expiry text, sizes, empty states and filtering.

## The shipped browser skill

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_SKILL` reads the session's own system prompt and the skill file it
points at.

- The session prompt listed the skill: `described=true`, with
  `<location>…/skills/browser/SKILL.md</location>`.
- `sed -n '1,3p'` on that path printed `name: browser` and its description, and
  the file has the loop section. The reply read "The browser skill is listed in
  this session's prompt, and its file opens with **name: browser** and the loop
  section."
- The first attempt failed exactly as it should have: the skill file existed and
  packaged (`build/skills/browser/SKILL.md`) but was missing from
  `server/pi/bundled-skills.ts`, so no prompt listed it. Registering it fixed
  the prompt, and this journey is the check that keeps it registered.

## Performance

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_PERFORMANCE` opens a page of 250 rows, reads the counters, clicks
"Add row" so real work happens after the counters were enabled, reads the
counters again and then the timings.

- After the click the metrics read: "heap 903 KB of 1.3 MB · nodes 532 ·
  documents 4 · frames 4 · JS listeners 1", "layouts 1 (1 ms) · style recalcs 3
  (0 ms)", "script 0 ms of 35 ms task time".
- The first metrics call, before any work, said "Nothing has rendered or run
  since the counters were enabled. Call performance before the navigation you
  want to measure, then read it again." — a zero reading is explained instead of
  printed as "0 ms (0%)".
- The timings read "Load: first byte 8 ms, DOMContentLoaded 71 ms, load 75 ms ·
  document 857 B (557 B decoded) · type navigate", "Paints: first-paint 212 ms,
  first-contentful-paint 212 ms" and "Resources: 1 request, 321 B transferred."
- The reply read "The page went from 530 to 532 DOM nodes, and after the click
  the counters show real work instead of zeros."
- At 390×844 both expanded outputs wrapped without sideways scrolling.
- `server/browser/performance.test.ts` covers units, missing counters, a page
  with no timing yet and a zero load mark; `server/browser/manager.test.ts`
  proves both operations against a page with 300 rows and a real script request.

## Uploading a file

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_UPLOAD` writes a local file with `bash`, opens a page with a file
input, and uploads it with `act` `kind: "upload"`.

- The action read "Uploaded upload-note.txt to e1 (button \"Attach document\") (1
  file)."
- The page's own `change` handler ran: the input shows the chosen file name in
  the browser pane and a `get text` of `#picked` returned "picked:
  upload-note.txt", which the reply quoted.
- At 390×844 the reply and the fixture card wrapped without sideways scrolling.
- `server/browser/manager.test.ts` also covers a multi-file input, a hidden input
  addressed by `selector`, a single-file input refusing two files, a missing
  path, a directory, an empty `files` list, no target at all, and a target that
  is not a file input.

## Snapshot diffs

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_SNAPSHOT_DIFF` reads a page as a baseline, clicks "Add item" (which
changes one line and reveals a hidden button), reads only what changed, clicks
the ref the diff carried, and diffs again.

- The first diff read "Page changed since the previous snapshot: 3 lines added,
  2 removed." and listed only the changed and surrounding lines, plus the
  `[focused]` state the click added: `- - paragraph: 2 items`,
  `+ - paragraph: 3 items`, `+ - button "Add item" [ref=e1] [focused]`,
  `+ - button "Confirm" [ref=e2]`; the unchanged heading line appeared once as
  context and the page's other lines were asserted absent.
- The `Confirm` ref taken from a `+` line clicked, so the loop continues from a
  diff rather than a full snapshot; the next diff showed
  `+ - paragraph: confirmed`.
- The reply read "The diff after Add item showed only the added lines (3 items,
  Confirm), the ref it carried clicked, and the next diff showed confirmed."
- At 390×844 the expanded tool output wrapped without sideways scrolling.
- `server/browser/manager.test.ts` also covers a first diff in a tab being the
  baseline, a diff with nothing changed, refusing `query`/`selector` alongside
  `diff`, and a reload resetting the baseline; `server/browser/diff.test.ts`
  covers context, counts, the 400-line cap and a wholesale change.

## Network capture and HAR

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_NETWORK` starts a capture, reloads a page whose script fetches an
API with an `Authorization` header and a missing path, lists the requests and
writes a HAR.

- The reply read "3 requests captured in tab t1. The API request shows
  token=%5Bredacted%5D, the missing one 404, and Wrote 3 requests to
  …/net/fixture.har. Credential headers and secret query values are [redacted]".
- The HAR on disk was JSON 1.2 with three entries: the page (200), the API
  (200, with `token=%5Bredacted%5D`) and the missing path (404); the string
  `fixture-secret` appeared nowhere in it, while `[redacted]` did.
- At 390×844 the same reply wrapped inside the mobile transcript width without
  sideways scrolling.
- `server/browser/manager.test.ts` also covers filters (method, type, status
  family), one request's headers, a missing id, an empty log after `clear`, and
  a HAR path that is not `.har` being refused.

## Frames

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_FRAME` opens a page with a same-origin frame and a frame on another
port of the same host, then snapshots and clicks one button in each.

- The first snapshot listed both frames with their content beneath the Iframe
  node: "Same button" and "Cross button" each carried a ref, and the click
  results were "Clicked e2 (button "Same button")" and "Clicked e3 (button
  "Cross button")".
- The page rendered "Same clicked" inside the first frame and "Cross clicked"
  inside the second, so both clicks landed on the frame's own control, not on
  the frame element.
- The reply read "Both frames were in the snapshot, and a click inside each one
  landed: **Same clicked** and **Cross clicked**.", the same at 390×844.
- A frame the browser isolates in its own process is not inlined: the snapshot
  lists only its Iframe node. `server/browser/manager.test.ts` also proves a
  stored secret checked against the frame's origin (refused on the host's,
  typed on the frame's).

## Reading and verifying one thing at a time

Verified on 2026-11-09 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_LOOP` opens the fixture, snapshots only `main` to depth 3, then
reads one property per call.

- The reply quoted the boundary line the tools returned:
  `--- HUI_PAGE_CONTENT nonce=1b445037d68d95c9 origin=http://127.0.0.1:46169 ---`,
  followed by `Title: HUI browser fixture`, `1 element matches button.`,
  `button "Greet") is enabled.`, `value of e1 (textbox "Name"): "Loop"` and
  `Hello, Loop! Rendered by page JavaScript.` The greeting only exists after the
  agent clicked Greet, so the reading loop and the action both ran.
- The scoped snapshot listed the page's own controls without leaving the
  `main` subtree, and its refs worked for the next calls.
- At 390×844 the same reply wrapped inside the mobile transcript width without
  scrolling sideways.
- `server/browser/manager.test.ts` covers the rest with a real headless browser:
  a fresh nonce per result (and different between results), `get` for title,
  url, count, attr and value, `is` for visible, enabled, focused and the missing
  selector cases, a refused password value, a disabled click, a hidden click, a
  depth-limited snapshot with its note, `wait state`, and a ref re-bound after
  its element was replaced or refused as ambiguous.

## Bounded steps

Verified on 2026-11-08 in the same fixture at 1440×900.

- `E2E_BROWSER_STEPS` opened the fixture page and ran one `steps` call of type,
  click and wait. The tool row settled with "Ran 3 steps in tab t1." and listed
  "1. type: Typed 12 characters into e1 (textbox "Name")", "2. click: Clicked e2
  (button "Greet")" and "3. wait: Waited …", and the agent's reply quoted that
  log; the greeting the sequence waited for was rendered by the page.
- One activity row covered the three interactions, and no browser window opened.
- A step after a navigation that still names an older snapshot's ref fails with
  "Step 2 (type) failed: Ref e1 is not in tab t1's latest snapshot." and names
  the step that ran; proven by `server/browser/manager.test.ts`, not by a
  fixture run.

## Site secrets

Verified on 2026-11-08 in the same fixture at 1440×900 and 390×844.

- Settings → Tools → Browser → **Site secrets** showed "None stored." Filling
  the name `fixture-secret`, the origin of the fixture page
  (`http://127.0.0.1:<provider port>`, read from the live view) and a value, then
  **Add secret**, listed `fixture-secret` with its origin, left the value field
  empty and never rendered the value anywhere. A reload kept it.
- `E2E_BROWSER_SECRET` opened `/browser-secret-fixture`, took the ref of its
  Password field, typed the stored secret (Enter pressed) and clicked Sign in:
  the page reported "signed in with 15 characters". The tool row and the reply
  named the secret, the field and the origin and never carried the value; the
  live view showed only the masked field.
- The stored file was `browser-secrets.json` with mode 0600, and
  `GET /__hui/browser/secrets` listed only the name, origin and time.
- **Delete fixture-secret** returned the list to "None stored."
- Both viewports stacked each stored name above its Delete button and the three
  fields without sideways overflow.

## Origin allowlist

Verified on 2026-11-08 in the same fixture, at 1440×900 and 390×844.

- Settings → Tools → Browser → **Allowed origins** was empty and said "Empty lets
  agents browse anywhere". Saving `127.0.0.1` and reloading showed "1 pattern."
  with the value kept.
- `E2E_BROWSER_BLOCKED` opened the fixture page on 127.0.0.1 (allowed) and then
  asked to navigate to `https://example.com/`; the tool row failed with
  "example.com is not in this browser's allowed origins (127.0.0.1). The operator
  can change them in HUI Settings → Tools → Browser.", and the agent's reply
  quoted that refusal.
- Clearing the list and saving restored "Empty lets agents browse anywhere" and
  the same navigation would have been allowed (proven by the manager test with a
  real headless browser, not by a second fixture run).
- A narrowing list also refuses a back move into a page it no longer allows,
  leaving the tab where it was — proven by the same test file, not by a fixture
  run.
- A popup to another host, and a redirect from an allowed page to one, are
  stopped, left on `about:blank` and reported once — including a popup that
  committed before HUI attached, which `tabs` marks
  `(blocked: not in the allowed origins)`. Proven by `server/browser/manager.test.ts`
  with a real headless browser, not by a fixture run.
- Both viewports showed the field above its button without horizontal overflow.

## Operator handoff

Verified on 2026-11-08 in the same fixture at 1440×900 and 390×844. The prompt
`E2E_BROWSER_HANDOFF` opens `/browser-handoff-fixture` (a page whose Name field
sits at the viewport's centre) and then calls `handoff` with "Type your name
into the Name field and click Greet, then press I'm done — continue" and a
five-minute timeout, instead of typing into the page itself.

- The chat's browser preview card showed **Your turn.** with that instruction and
  **Take over**, and its footer read "Waiting for you in tab t1: …". The agent
  had not typed into the page; the Name field was empty.
- **Take over** opened the conversation's one Browser view. It showed the
  **Your turn.** banner with the message, the **I'm done — continue** button,
  "Your turn" as the status, a highlighted frame and "You have control; the
  agent waits." under it.
- Clicking the middle of the frame put a caret in the page's Name field (the
  frame took focus and the click reached the page); typing appeared in the field
  as it would in the page; Tab then Enter on Greet rendered
  "Hello, <name>! Typed by the operator." in both the view and the preview.
- **I'm done — continue** settled the waiting row: its result opened with
  "The operator finished in tab t1." and carried the page's snapshot with the
  greeting; the agent's reply quoted it ("The operator finished in the browser:
  **Hello, Ada! Typed by the operator.**"), and the view returned to
  "Live · headless" with "You finished; the agent is back in control".
- At 390×844 the banner and its button shared one row above a smaller frame, the
  page could still be clicked and typed into (a second session typed "Mob" and
  Greet rendered "Hello, Mob! Typed by the operator."), Continue settled it the
  same way, and nothing scrolled sideways.
- The operator's wheel scrolls the page (proven by `server/browser/manager.test.ts`
  with a real headless browser, along with input being ignored once nothing
  waits), and the page reported no console errors.

## Limits

- Windowed mode was verified only as a refusal on a display-less Linux host;
  a visible window on macOS or a Linux desktop was not exercised here.
- The model is the deterministic fixture, so the proof covers HUI, PI, the tool
  bridge and a real Chromium browser, not a live model choosing to browse.
- The live view of a visible (non-headless) window was not exercised; background
  tabs of a visible window do not repaint, so their view keeps the last frame.
- Previews are not recorded: after a reload the latest one shows the tab's
  current page, and nothing once the tab is gone; earlier browser activity never
  carries one.
- A handoff nobody answers, a tab that closes under the operator, a Stop and a
  browser that stops are proven by `server/browser/manager.test.ts` (a real
  headless browser and a five-second wait), not by waiting in the Browser check.
