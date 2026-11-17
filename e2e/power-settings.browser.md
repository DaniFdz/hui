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

This is the current placement. The notice is no longer drawn over the shell: the
open conversation renders it in flow as the first child of the chat's
conversation column, between the chat header and the transcript. The shell,
header and sidebar never move, and only the transcript area shrinks while it is
up. Home, Settings, the launcher and the phone's native shell draw none, a bot
chat draws it above its messages, and a split shows one copy, in the active
pane. It says the same sentence, "This Mac won't sleep with the lid closed.",
with **Turn off** and a dismiss button.

What this run verifies, on an isolated instance from
`node e2e/visual-verification.mjs launch` with the lid switch approved (the
prompt procedure is above):

1. Open a session chat at 1440×900 and at 390×844, and read the notice's
   bounding box against `data-testid="chat-header"` and
   `data-testid="transcript"`: it starts at or below the header's bottom, ends at
   or above the transcript's top, and spans the transcript's own horizontal
   range. Confirm the header and the sidebar are where they were before the
   notice appeared.
2. Simulate the phone's notch with `hui.insets({ top: 47 })` (or by setting
   `--safe-area-top: 47px`) and confirm the notice's text and both buttons stay
   below that inset and fully on screen. The 2026-09-29 section's "top notice"
   wording describes the notice that predates this placement and is historical.
3. Dismiss it with **Dismiss sleep prevention notification**: it leaves, the
   composer's textarea has focus, and a reload while the switch is still on
   draws it again.
4. Press **Turn off**: the notice leaves, `PUT /__hui/power` carried
   `{ "lidAwake": false }`, `pmset -g` reports `SleepDisabled 0`, the watcher
   exits, and the composer has focus.

The shared test `e2e/tests/shell/lid-notice.e2e.ts` (SET-021) proves the same
placement, dismissal, reload and turn-off request on the `web` target and runs
on `webkit-phone` too, with `GET`/`PUT /__hui/power` stubbed, so it needs no
macOS host. The screenshots for this section are captured on a macOS host; this
checkout is Linux, so they are the remaining proof for the real
administrator-approved switch and are not recorded here.
