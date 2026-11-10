# Android app procedure

The emulator's counterpart of [the browser procedure](browser.md). `mobile/AGENTS.md` owns the toolchain, the ports and
the loops; this is the evidence path for a change a browser cannot prove: the shell itself, the Connect page, or the
web UI laid out in the app's WebView.

The app is a Capacitor shell around the gateway's own UI. It has no screens of its own beyond the bundled Connect page,
so most web changes are proven in the browser first and only need a phone pass when the phone layout or the shell's
behaviour is what changed.

1. **Gateway.** Launch the fixture gateway on the port the app's loop uses and keep its exec session alive, with the
   receipt outside the repository:
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" --port 47400 --receipt-dir /tmp/hui-android --fast-fixture`.
   Run `doctor --receipt` against it as for the web. Seed sessions through `POST /__hui/sessions` with `x-hui: 1`
   (setup, not proof). The launcher runs a development checkout, so its `GET /__hui/update` has
   `currentVersion: null`: the app's Connect page says **Development gateway: its version is unverified.** That notice
   is correct for this fixture, not a failure.

2. **Device and build.** `npm run mobile -- doctor` prints the toolchain, the AVD and the booted device; the commands
   that need the SDK run inside the flake's `nix develop .#android` by themselves (`connect` and `help` do not). Then
   `npm run mobile -- dev --gateway http://127.0.0.1:47400 --fresh`: it builds this checkout's Connect page and debug
   APK, `adb reverse`s the gateway's port, installs `dev.hui.app.debug` and launches it on the gateway. A screenshot of
   an APK built from another checkout, or of the app pointed at another gateway, is not evidence.

   **The Connect path.** `npm run mobile -- dev --fresh --no-gateway` leaves the app on **Connect to HUI** (the same
   page a first launch shows). The address it is given must answer `/__hui/update`: a value that is not an http(s)
   address reads "Enter an http:// or https:// address.", a gateway that refuses reads "This address doesn't answer as
   a HUI gateway.", and a development gateway loads the UI after its version notice. The app remembers the address and
   reloads on it. `dev --gateway <url>` skips the page through the debug build's `huiGatewayUrl` launch extra, and
   `dev --no-gateway` launches as a user does, so it opens on the remembered gateway (or on Connect to HUI after
   `--fresh`). **Change gateway** on the Connect page forgets it. A gateway that stops answering sends the app back to
   the Connect page naming it.

3. **Drive visible controls** with `agent-device`, which is installed only inside `nix develop .#android` (an FHS
   wrapper, because it runs `/bin/ps`, which NixOS lacks):
   `agent-device open dev.hui.app.debug --platform android --serial emulator-5554`, then `snapshot -i` for refs,
   `press`/`fill` by ref, label or test id, and `wait text "…"` for the state you expect. Never wait a fixed time. Clear
   a field with `fill <target> ""` before filling it again. A second worker on this machine takes another AVD and
   serial (`HUI_ANDROID_AVD=HUI_Pixel_<wp> ANDROID_SERIAL=emulator-55<nn> E2E_PHONE_PORT=474<nn>`); never touch the
   other worker's emulator. End with `agent-device close`.

4. **Capture.** `agent-device screenshot <path outside the repo> --scale 0.4` writes a 432×960 image of the AVD's
   1080×2400 screen. Take each affected state in light mode and in dark (`adb shell cmd uimode night yes`, then `no`,
   and capture again). `npm run mobile -- screenshot <path>` is the plain `screencap` fallback at full resolution when
   no agent-device session is wanted. Open each image and reject blank, loading, stale or scrolled-past screens, and
   record the commit, the fixture and what each image shows.

5. **Deliver.** Put the images in the PR description under **Phone — Android** beside Desktop and Mobile, and in the
   conversation ([the evidence handoff](pr-evidence.md)). Stop the emulator (`npm run mobile -- stop`) only if this run
   started it, and leave the launcher's gateway cleanup to its own `cleanup` command.

Screenshots prove appearance only. Streaming, notifications, downloads, the back button and the status bar also need
the assertion that shows them. CI's `android-build` job only builds and unit-tests the project, so a behaviour nothing
exercises stays a proof gap until WP4's `android-e2e` job drives the suite in the app.
