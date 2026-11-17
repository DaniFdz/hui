# macOS power settings browser verification

Verified on 2026-09-29 with HUI's Browser tool on macOS against an isolated
instance from `node e2e/visual-verification.mjs launch` (fresh HUI/PI state,
deterministic provider, Vite gateway). No operator settings, sessions or
transcripts were read or changed. The host Mac already had `SleepDisabled 1`.

## Reproduce

1. Launch and `doctor` as in the visual verification skill; open the receipt
   URL, then Home → Settings → Gateway at 1440×900 and 390×844.
2. Operate the switches with the keyboard (focus, Space). Pointer clicks land on
   Web Awesome's inner `span.switch`, which the Browser tool reports as covering.
3. Inspect helper processes with `pgrep -fl "caffeinate -i -w"` and the Mac's
   state with `pmset -g | grep SleepDisabled`.

## Observed

- **Power** appears after Runtime with both rows, the elevated-permission note
  on the lid row and a status pill beside each switch.
- Fresh state: Keep Mac awake on and **Active**; `caffeinate -i -w <server pid>`
  was running. Turning it off showed **Off**, persisted `keepAwake: false` and
  the process exited; turning it on started a new one and showed **Active**.
- Stay awake with the lid closed: turning it on showed **Active** with "Already
  on for this Mac outside HUI, so HUI leaves it unchanged." No `osascript`
  prompt ran and no flag directory was created. Turning it off showed **Off**
  with "Still on for this Mac outside HUI." and `SleepDisabled` stayed `1`.
- With lid-close off at startup, the row showed **Off** with "Still on for this
  Mac outside HUI." rather than a bare Off.
- Stopping the instance (`cleanup`) ended its `caffeinate` child.
- Mobile: rows stack; the status pill and switch are vertically aligned and
  no horizontal overflow is visible. Keyboard focus ring is visible on the switch.
- Console: only Lit development-mode warnings.

## Real administrator prompt (2026-09-29, commit 8402bbc)

The operator first ran `sudo pmset -a disablesleep 0`, then on a fresh isolated
instance the lid switch was operated from the Gateway page:

- Turning it on opened the real macOS password dialog (`osascript … with
  administrator privileges`); the row showed **Pending** with "Waiting for
  administrator approval on this Mac."
- The first attempt ended without approval (the operator's password failed):
  the row showed **Failed** with "Administrator approval was cancelled.",
  `SleepDisabled` stayed `0` and no watcher was left.
- Off, then on again, opened a fresh dialog. After approval `pmset -g` showed
  `SleepDisabled 1`, a root `/bin/sh` watcher for the gateway PID was running,
  the flag `lid-awake-<gateway pid>-<uuid>` existed and the row showed
  **Active** with no outside-HUI note.
- Turning it off restored `SleepDisabled 0` within about a second without any
  prompt; the watcher exited, the flag directory was empty and the row showed
  **Off**. Stopping the instance ended its `caffeinate` child.

## Lid awake per gateway run and top notice (2026-09-29, commit 53c7f3c)

From Settings → Gateway on fresh isolated instances, with the operator present:

- A new gateway started with the lid switch off, no HUI `osascript` prompt and
  no top notice; `SleepDisabled` stayed `0`.
- Turning the switch on opened the macOS dialog; after approval `SleepDisabled`
  was `1`, a root watcher ran and the top notice "This Mac won't sleep with the
  lid closed." appeared with **Turn off** and a dismiss button, on desktop
  (1440×900) and mobile (390×844), in Settings and on Home, and again after a
  page reload.
- Dismiss hid the notice, kept it hidden across later status polls and moved
  focus to the composer; a reload showed it again while still on.
- **Turn off** in the notice restored `SleepDisabled 0` at once without a
  prompt; the watcher exited, the flag directory emptied, the notice left and
  focus moved to the composer.
- On again (approved), then stopping the instance restored `SleepDisabled 0`
  about a second later; the watcher and `caffeinate` exited. The next fresh
  start again began off with no prompt and no notice.
- Two unanswered dialogs closed after about 30 seconds and were reported as
  "Administrator approval was cancelled or timed out." with the switch off.
- Console: only Lit development-mode warnings.

## Proof limits

Not exercised against real `pmset`: a gateway crash, reboot leftovers, a
withdrawn prompt and a quick restart. Those are covered by
`server/power.test.ts`, which runs the real root watcher script through fake
`osascript`/`pmset` executables. Whether killing `osascript` also closes macOS's
dialog is unverified. Off macOS, `GET /__hui/power` returns `null`, so the
section and notice are absent (covered by `server/routes/power.test.ts` and
`src/views/settings-gateway.test.ts`).

## The notice in the conversation (2026-11-17)

Recorded on this checkout's HEAD with an isolated instance from
`node e2e/visual-verification.mjs launch`: Chromium driven by `playwright-core`
against the receipt URL, because HUI's Browser tool can neither stub a route nor
set a CSS variable. The host is Linux, so `GET /__hui/power` returned `null`
until the run stubbed `GET` and `PUT /__hui/power` with `page.route`, and the
phone's notch was simulated with
`document.documentElement.style.setProperty("--safe-area-top", "47px")`, a page
where `matchMedia("(display-mode: browser)")` matched.

- **Desktop, 1440×900.** The chat header was x 258, y 0, 1138×48 and the sidebar
  x 0, y 0, 257×900 both before and after the notice appeared: the same boxes
  within the 0.5 px tolerance, a 0.00 difference. The notice was x 258, y 48,
  1138×45 — under the header's bottom, across the transcript's column — and the
  transcript's y moved 48 → 93, losing exactly the notice's 45 px height. The
  composer's bottom stayed at 817 and stayed hit-testable.
- **The notice's two controls, desktop.** Dismiss removed the notice and
  focused the `Message` textarea; a reload drew it again; Turn off sent
  `PUT /__hui/power` with `{"lidAwake":false}` and removed it.
- **Mobile, 390×844 with the simulated 47 px inset.** The header sat at y 51
  with a height of 48; the notice was x 4, y 99, 382×53 with its bottom at 152,
  below both the inset and the header's bottom 99. The transcript's y moved
  99 → 152 and the composer stayed at y 747. The dismiss button was 44×44 and
  fully on screen, and `document.elementFromPoint` at its centre landed inside
  the button, on its icon. Dismiss removed the notice and focused the textarea,
  and the header and sidebar boxes were identical before and after.
- Home `/` and Settings → Gateway drew no notice while the stubbed state said
  the lid switch was on and held awake, and Settings' own switch read that
  state.
- With the update notice stubbed, its message sat at y 60, clear of the 47 px
  inset, and the shell below it began at y 96 with no top padding of its own.
- Console: no page errors and no failed requests, only the existing Lit
  development-mode warnings.

The macOS switch, its administrator prompt and `pmset` were not exercised in
this run; the 2026-09-29 coverage above still stands for those. Nor does it
prove `webkit-phone`, which cannot launch on this host — WebKit's Ubuntu shared
libraries are absent — and is CI's, or the bot-chat and split-pane placements,
which have no shared journey yet. The 2026-09-29 section's "top notice" wording
is historical and was left untouched.

The shared test `e2e/tests/shell/lid-notice.e2e.ts` (SET-021) proves the same
placement, the absence on Home and Settings, Dismiss, the reload and the
turn-off request on the `web` target and on `webkit-phone`, with
`GET`/`PUT /__hui/power` stubbed, so it needs no macOS host.
