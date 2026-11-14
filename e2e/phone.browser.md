# Phone chrome verification

What a real iPhone and a real Android phone add to the shared suite: the phone's own chrome — the status bar, the
notch or cutout, the home indicator — must never cover HUI's header, its menu button or its composer. The shared case
`e2e/tests/shell/safe-area.e2e.ts` (SHELL-049) states the insets on a page and reads the boxes, and both phone targets
run it; what they cannot do is report a real device's insets, because every emulator and every simulator reports zero
(`npm run mobile -- doctor` prints what it found). This is the procedure for the device.

Run it against a gateway the phone can reach over **https** (`tailscale serve`); iOS refuses cleartext HTTP for
anything but `127.0.0.1` (`mobile/ios/App/App/Info.plist`).

## Reproduce

1. Install the build under test: the unsigned IPA from the `ios-ipa` job through SideStore, or the APK on Android. On
   iOS the first launch needs **Settings → General → VPN & Device Management** to trust the signing account and
   **Privacy & Security → Developer Mode** on.
2. Open the app, enter the gateway's `https://` address on the Connect page, and wait for the session list.
3. Take a screenshot of the app's own screen: `npm run mobile -- screenshot /tmp/phone-clear.png` on Android, the
   hardware buttons on iOS.

## What to check

| Surface | Expected |
| --- | --- |
| The header's menu button (☰) | Entirely below the status bar and the cutout, and a tap opens the drawer on the first press |
| The header's title and trailing buttons | On the same band as the menu button, nothing clipped by the notch in landscape |
| The chat header when a session is open | Starts below the status bar, its 52 px band intact below the inset |
| The composer | Its bottom edge above the home indicator, the send button reachable |
| Landscape | The same two bands, with the left and right insets respected (the drawer does not slide under the notch) |

A page loaded in a browser reserves the insets itself: `index.html` opts into `viewport-fit=cover`, and Safari does
not inset the layout for it. The installed app pads the page's frame in native code and reports the tokens as zero, and
a standalone page pads `body`, so no surface counts an inset twice — if the header looks double-padded on a device,
that rule (`display-mode: browser` in `src/styles/openclaw-shell.css`) is the one to look at.

## Known state

- Verified on an iPhone (Safari, against a MacBook gateway) on 2026-11-11: before the fix the header was drawn under
  the status bar and the ☰ sat behind the clock, untappable. The fix pads the shell in a phone browser only.
- Not yet verified on a device after the fix, and not verified on a cutout Android phone at all.
