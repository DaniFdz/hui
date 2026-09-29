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

## Proof limits

The administrator prompt path (Pending → Active/Failed, watcher restoring
`disablesleep 0` on off, stop and crash) was not exercised against real `pmset`
here: it needs an operator's password on a Mac with `SleepDisabled 0`. That
path is covered by `server/power.test.ts`, which runs the real root watcher
script through fake `osascript`/`pmset` executables: a killed gateway process,
a quick restart during watcher wind-down, a reboot leftover, a withdrawn and a
cancelled prompt. Whether killing `osascript` also closes macOS's dialog is
unverified. Linux hosts omit `power` from health, so the section is absent there
(covered by `src/views/settings-gateway.test.ts`).
