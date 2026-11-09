# Android app procedure

The emulator's counterpart of [the browser procedure](browser.md). `android/AGENTS.md` owns the toolchain and the
loops; this is the evidence path.

1. **Gateway.** Launch the fixture gateway on the port the app defaults to and keep its exec session alive:
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" --port 47400 --fast-fixture`.
   Run doctor against its receipt, as for the web. Seed sessions through `POST /__hui/sessions` (setup, not proof).
2. **Device and build.** `npm run android -- emulator`, then `npm run android -- dev --fresh` (or `--fresh
   --no-gateway` to start on Connect to HUI). That builds this checkout's debug APK, installs it, reverses the
   gateway's port and launches it. A screenshot of an APK built from another checkout or commit is not evidence.
3. **Drive visible controls** with `agent-device` inside `nix develop .#android`: `open dev.hui.android.debug
   --platform android --serial emulator-5554`, then `snapshot -i` for refs, `press`/`fill` by ref, label or
   `id=<test tag>`, and `wait text "…"` for the state you expect. Never wait a fixed time. Clear a field with
   `fill <target> ""` before filling it again.
4. **Capture.** `agent-device screenshot <path outside the repo> --scale 0.4` for each affected state, in light mode
   and in dark (`adb shell cmd uimode night yes`, then `no`). Open each image and reject blank, loading or stale
   screens. Record the commit, the fixture and what each image shows.
5. **Deliver.** Put the images in the PR description under an **Android** heading beside Desktop and Mobile, and in
   the conversation (references/pr-evidence.md). Stop the emulator only if this run started it.
