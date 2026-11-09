# Android app guide

The native HUI client for Android: Kotlin, Jetpack Compose, OkHttp. It talks to a gateway over the same `/__hui/`
routes as the web UI and shares no code with `src/`, `server/`, `cli/` or `desktop/`. The plan, the milestones and the
rules it grows into are in [`docs/native-android-plan.md`](../docs/native-android-plan.md).

## What it does today (MVP)

- **Connect to HUI**: the gateway's address, checked with `GET /__hui/update`. An address that isn't a HUI gateway is
  refused with "This address doesn't answer as a HUI gateway.", an empty one asks for it, and the last gateway that
  answered is remembered. A development gateway shows "Development gateway: its version is unverified."
- **Sessions**: the gateway's groups and sessions (`GET /__hui/sessions`), kept live by `GET /__hui/sessions/events`,
  without archived sessions, subagents and bot chats.
- **Chat**: `POST /__hui/sessions/:id/open`, then `GET /__hui/sessions/:id/events` for the live stream. It shows
  messages (the agent's as Markdown), thinking and tool calls that open to their output, and errors. It sends with a
  request id and offers Stop while a turn runs.

## Toolchain

Everything comes from the flake's Android shell, which pins the SDK (platform 36, build-tools 36.0.0, the emulator
and an `android-36` `google_apis` x86_64 image), JDK 17, and `agent-device` wrapped so that it runs on NixOS:

```sh
nix develop .#android     # or let npm run android re-run itself inside it
npm run android -- doctor
```

The npm script re-runs itself inside that shell when `ANDROID_HOME` isn't set, so an agent can call it from any
shell. On another Linux distribution or macOS, install the same SDK packages with `sdkmanager`, set `ANDROID_HOME`
and `JAVA_HOME`, and leave out the `aapt2` override `GRADLE_OPTS` sets on NixOS.

Library versions are pinned in `gradle/libs.versions.toml`. Compose BOM `2026.06.01` is the newest that builds with
AGP 8.13 and `compileSdk 36`. Later androidx releases need AGP 9.1 and `compileSdk 37`, and nixpkgs doesn't package
platform 37 yet. Moving up is one PR: the flake's platform, AGP, the BOM, then `compileSdk` and `targetSdk`.

## The loops, cheapest first

| Loop | Command | Time here (16 cores, KVM) |
|---|---|---|
| Unit tests (JVM, no device): SSE framing, chat rows, Markdown | `npm run android -- test` | about 2 s warm |
| Build, install and launch against a gateway | `npm run android -- dev [--gateway <url>] [--fresh] [--no-gateway]` | about 5 s from a saved edit to the app on screen, warm Gradle daemon |
| Start the headless emulator `HUI_Pixel` (made on first use) | `npm run android -- emulator` | 25 to 35 s cold boot |
| Stop it | `npm run android -- stop` | |

`dev` defaults to `http://127.0.0.1:47400`, the shared e2e suite's fixed gateway port. For a gateway on this machine
it runs `adb reverse`, so the emulator reaches the same loopback address. `--fresh` clears the app's data, and
`--no-gateway` opens without the launch extra, which with `--fresh` means Connect to HUI.

A gateway with fixture sessions, as the web's visual verification uses:

```sh
node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" --port 47400 --fast-fixture
```

## Driving the app and taking screenshots

`agent-device`, in the Android shell, is the emulator's equivalent of the Browser tool: it opens the app, returns an
accessibility snapshot with `@e` refs, and acts by ref or selector.

```sh
agent-device open dev.hui.android.debug --platform android --serial emulator-5554
agent-device snapshot -i
agent-device press 'label="Plan the Android app, status idle"'
agent-device fill id=composer "Read the fixture and summarize it E2E_RICH"
agent-device press label=Send
agent-device wait text "Tool complete"
agent-device screenshot /tmp/hui-android/chat.png --scale 0.4
adb shell cmd uimode night yes   # dark mode; `no` to restore
```

- Test tags are resource ids (`testTagsAsResourceId`), so `id=composer`, `id=gateway-url` and `id=transcript` work
  as selectors and as `getByTestId` in shared tests.
- `fill` into a field that already has text appends on this Compose build. Clear it first with
  `agent-device fill <target> ""`.
- `--scale 0.4` keeps a 1080×2400 capture readable in a PR and in the image tools. `npm run android -- screenshot
  <path>` saves the full-resolution frame through `adb` instead.
- Screenshots go outside the repository. Attach them to the PR description and the conversation, as the web's
  evidence goes (`.agents/skills/hui-visual-verification/SKILL.md`, "Android app").

## Rules

- Every Kotlin file starts with a header comment saying what it owns, and every Kotlin source directory is named in
  `docs/map.md` (`scripts/module-headers.test.mjs`).
- One owner per piece of state: `AppViewModel.kt` until a feature earns its own view model, mirroring the web's
  controller for it (`docs/native-android-plan.md`, 2.6).
- Pure logic in `core/` with JVM tests beside it. The rules it shares with the web (`src/lib/transcript-state.ts`,
  `src/lib/markdown/`) move to conformance fixtures from the TypeScript tests as the plan's section 2.5 says.
- No new dependency without the owner's approval. Each one is pinned in the version catalog.
- Labels match the web's (Connect, Send, Stop, Gateway URL, status names), so shared e2e tests read one set of words.
