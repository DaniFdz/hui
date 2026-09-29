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
- Turning **Browser tool** off showed "Off" and disabled **Start**; a new
  `E2E_BROWSER` session replied "The browser tool is not available in this
  session." because PI no longer offered the tool. Turning it on restored it.
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
