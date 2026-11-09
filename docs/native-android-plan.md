# Plan: a native Android app for HUI, built and tested in lockstep with the web UI

Status: a plan. Nothing in it is built yet. It replaces the iOS plan (`docs/native-ios-plan.md`, removed with the
iOS scaffolding; read it at commit `d921912b` for the long form of the parts this plan reuses). It was checked
against `main` at `d921912b`, tester-army/e2e `0.21.3` and `@e2e-dev/mobile` `0.12.3`, whose README declares an
Android engine on agent-device. A statement marked "(assumption, A*n*)" is not proven yet: spike A*n* in milestone M0
settles it before work depends on it. Timings marked "target" are budgets to measure, not measurements.

## 0. Summary

- **What changes from the iOS plan.** The owner moves from iPhone to Android. The SwiftUI app (draft PR #347, branch
  `dani.fernandez/ios-app-stacked`, kept unmerged as an archive) is dropped, and `main` loses its iOS target, its
  per-use-case iOS status and its iOS fixture steps. What stays is the part that was never iOS-specific: one use-case
  catalogue (`e2e/catalogue/`), one shared tester-army/e2e suite (`e2e/tests/`, over 200 tests today), the guards that
  find uncatalogued surfaces, and the owner's native-client decisions in `SPEC.md`, which now apply to the Android app.
- **A native Kotlin app with Jetpack Compose** (the owner's choice over a WebView shell), in `android/`, built with
  Gradle. Its API types are generated from `docs/api.schema.json`, as the web's are. Content that is web content
  already (agent widgets, math, diagrams and charts, the CodeMirror editor, VS Code, the GPT-Live call engine) runs in
  an Android `WebView`, as the iOS plan ran it in `WKWebView`.
- **Fast local iteration on this Linux machine**, which is the reason the iOS loop hurt: a Mac-only toolchain and
  Release simulator builds. Android builds on Linux with KVM. Four loops, each much cheaper than the next
  (section 3): JVM unit tests, JVM screenshot tests of composables with no device, an incremental debug install on a
  headless emulator pointed at a dev gateway, and the shared e2e suite on that emulator. The SDK comes from a Nix
  `devShell` so the emulator runs on NixOS and every checkout and agent gets the same pinned toolchain.
- **Strict lockstep from the PR that adds the Android target** (the owner's choice). From that PR every existing use
  case starts in an Android backlog that may only shrink, and a new or changed use case must pass on the web and on
  Android in the same PR. CI runs the Android job on Linux runners with KVM, which are cheap compared to the macOS
  runners the iOS job needed.
- **Distribution through GitHub Releases**: CI builds a signed APK beside each release and nightly `.tgz`; the owner
  installs and updates it with Obtainium (or any APK installer). No store, no weekly re-signing.
- **Effort**, an estimate and not a measurement: about the iOS plan's 8 to 12 months to full parity for one engineer
  with coding agents, minus what Android makes cheaper (Linux CI, no SideStore, OkHttp's WebSocket headers), plus the
  cost the owner accepted by choosing native: every user-visible feature is built twice from now on.

### Decisions at a glance

| Question | Decision | Section |
|---|---|---|
| App kind | Native Kotlin, Jetpack Compose, Material 3 adapted to HUI's themes; `WebView` only for web content | 2 |
| Where it lives | `android/` in this repository, its own Gradle build, no code shared with `src/` or `server/` | 2.1 |
| Minimum Android | API 29 (Android 10); compile and target the latest stable API | 2.2 |
| Contract | The same `/__hui/` routes; the app sends `x-hui: 1` and an `Origin` equal to the gateway's; no gateway change expected | 2.3 |
| Types | Kotlin (kotlinx.serialization) emitted by `scripts/api-schema.ts` from `docs/api.schema.json`, checked for staleness in `npm test` | 2.4 |
| Shared logic | Ported to Kotlin and pinned by conformance fixtures the TypeScript tests write; an embedded JS engine only if spike A4 says the port costs more | 2.5 |
| Toolchain | Nix `devShells.android` (SDK, emulator, JDK); Gradle wrapper and a version catalog with exact pins | 3.1 |
| Local device | A headless KVM emulator, `HUI_Pixel` (the owner's choice: emulator only) | 3.2 |
| Shared e2e target | `android` in `e2e.config.ts`, `@e2e-dev/mobile` with `platform: "android"` | 4 |
| Lockstep | From the PR that adds the target; baseline per platform that only shrinks | 5 |
| CI | `e2e / android` on `ubuntu-latest` with KVM, every PR | 5.3 |
| Distribution | Signed APK as a GitHub Release and nightly asset, installed with Obtainium | 6 |
| Notifications | In-app parity first; local notifications from a foreground service while the app watches sessions (owner decision O3); no push | 2.7 |

---

## 1. What is dropped, and what is reused

### 1.1 Dropped (this PR)

- The iOS target and its device/port settings in `e2e.config.ts`, the `e2e:ios` script, the iOS CI job.
- The `ios` status on every use case, the `IOS` area (IOS-001) and `e2e/tests/ios/`, the iOS backlog in
  `e2e/catalogue/baseline.json`.
- The iOS branches of `e2e/fixtures/hui.ts` (simctl, `defaults`, the relaunch proxy, BMP screenshot reads).
- `docs/native-ios-plan.md` and iOS mentions in the guides.
- PR #347 is closed unmerged with a pointer to this plan; its branches stay as an archive.

`@e2e-dev/mobile` stays a dev dependency: the Android target uses the same engine.

### 1.2 Reused from the iOS work

| From | Reused as |
|---|---|
| The catalogue and its guards (`scripts/use-cases.test.ts`, `scripts/e2e-baseline-check.ts`) | Unchanged in shape; the Android PR adds an `android` status beside `web` |
| The portability rules for shared tests (portable roles, no platform reads, no `app.clearState()`, no sleeps) | Kept on `main` while web-only, because the Android engine needs the same portability |
| The iOS exclusions and their reasons (about 70: keyboard chords, hover, wide layout, browser-tab mechanics) | Recovered with `git show d921912b:e2e/catalogue/<area>.ts` when the `android` field lands, reworded for Android, each still citing its `SPEC.md` decision |
| The iOS fixture steps (hold, context menu, clipboard, scrollTo, look, sessionList, phoneScreen) | Their Android equivalents in section 4.2; the iOS code at `d921912b` is the reference |
| The SwiftUI screens on PR #347 (session list with search and groups, chat, questions and secret requests) | A design reference for the first Android screens: they already solved the narrow-layout questions |
| `SPEC.md` decisions about the phone app (one gateway, phone text size, tap opens a preview, keyboard and wide-layout mechanics stay on the web) | Apply to the Android app, as the 2026-11-09 decision says |

---

## 2. App architecture

### 2.1 Where the code lives

```
android/
  AGENTS.md                    Kotlin rules, generated types, the conformance fixtures, how to run each loop
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradlew, gradle/wrapper/, gradle/libs.versions.toml
  app/src/main/kotlin/dev/hui/android/
    App/                       Activity, navigation graph, deep links (hui://open?path=…), launch extras
    Gateway/                   GatewayClient (OkHttp, x-hui, deadlines), SSE reader, session/terminal/browser sockets
    Gateway/Schema/            generated from docs/api.schema.json (committed)
    Core/                      the Kotlin port of the transcript reducer, chat projection, send requests, navigation
    Chat/ Sessions/ Work/ Board/ Settings/ Pages/ Bots/ Calls/   features, one package per catalogue area
    Rendering/                 Markdown renderer, rich-block renderer, WidgetView, MediaViewer, EmbeddedWeb
    Theme/                     HUI themes (themes/*.json from the gateway) mapped onto Compose colours and type
  app/src/main/assets/embedded/ the WebView bundle built by npm run android:embedded (git-ignored)
  app/src/test/                JVM tests: core conformance, SSE framing, decoding, screenshot tests
  embedded/entry.ts            the WebView bundle: rich blocks, CodeMirror, widget host, call engine
```

- `docs/map.md` gains an `android/` row and the dependency rule that `android/` imports nothing from `src/`,
  `server/`, `cli/` or `desktop/` (R-rules in `scripts/boundaries.test.mjs`). `android/embedded/entry.ts` is the one
  TypeScript entry: it is built by Vite with the web's pinned `katex`, `mermaid`, `vega`, `vega-lite` and
  `@codemirror/*`, and the boundary test allows it to import those packages and `src/lib/` pure modules only.
- Every Kotlin file starts with a header comment saying what it owns; `scripts/module-headers.test.mjs` extends to
  `android/app/src/main/kotlin`.
- Package id `dev.hui.android`; a debug build adds `.debug` so a dev build and the released app live side by side.

### 2.2 Target and frameworks

- Kotlin 2.x with the Compose compiler plugin, Compose BOM, Material 3, Navigation Compose, Lifecycle/ViewModel,
  kotlinx.serialization and kotlinx.coroutines. Exact versions in `gradle/libs.versions.toml`, each one an owner
  approval (section 9).
- `minSdk 29` (Android 10): one floor for the system dark theme, scoped storage and the clipboard rules the tests
  meet, and old enough for any phone the owner is likely to use; the prerequisites check the owner's phone, and
  changing the minimum early is cheap.
- One activity, Compose throughout. Android Views only through `AndroidView` for `WebView` and the terminal.
- The narrow layout always: one screen at a time (session list, then the chat), as the web's phone layout and the
  SPEC decisions describe. A tablet two-pane layout is left out (section 12).

### 2.3 Speaking the `/__hui/` contract

The iOS plan's table (section 4.3 at `d921912b`) holds unchanged with Android's tools:

| Concern | Android |
|---|---|
| Headers | One OkHttp client with an interceptor that adds `x-hui: 1`, the web's response deadlines from `src/api/request.ts`, and an idle-read timeout instead of a total deadline for long transcripts (the performance rule "a progressing HTTP transcript has no total download deadline") |
| SSE | `GET /__hui/sessions/events` and `GET /__hui/bots/events` read as a byte stream with a hand-written frame decoder (CRLF, multi-line `data:`, comments, split UTF-8), pinned by the same fixtures as `src/lib/event-stream.ts` |
| Sockets | OkHttp WebSocket for the session stream, terminals and the browser view. OkHttp lets the request set `Origin`, so the `validTerminalOrigin` check in `server/terminals/transport.ts` passes with no gateway change: the iOS plan's S2 risk does not exist here |
| Tickets, reconnects, late answers, request ids, versions | As the iOS plan: one-use tickets minted per connect, backoff from the ported `reconnectDelay`, a generation number per request, `SendRequests` ids reused on resend, the version notice from `GET /__hui/update` (SPEC "The iOS app connects to one gateway", which the 2026-11-09 decision applies to Android) |
| Lifecycle | `ProcessLifecycleOwner` closes sockets in the background; `ConnectivityManager` callbacks and returning to the foreground reconnect; runs continue on the gateway |

`docs/api.md` gains a short "Native clients" section saying what a client outside a browser sends.

### 2.4 Kotlin types from the API schema

`scripts/api-schema.ts` already turns `docs/api.schema.json` into `src/api/schema/`. It gains a Kotlin emitter beside
the TypeScript one, writing one file per API area to `android/app/src/main/kotlin/dev/hui/android/Gateway/Schema/`:
objects become `@Serializable data class`es, `const`/`enum` unions become enums, a discriminated union becomes a
`sealed interface` with a `JsonContentPolymorphicSerializer` keyed on the discriminator, and an open object becomes
`JsonElement`. It accepts the same keyword subset and throws on anything else. `scripts/api-schema.test.ts` compares
the committed Kotlin with a fresh run, so `npm run api:schema` regenerates both clients and a schema change the
Android app doesn't take fails `npm test` before any device is involved.

### 2.5 Shared logic: a Kotlin port pinned by conformance fixtures

The web's subtle rules live in pure TypeScript: the transcript reducer (`src/lib/transcript-state.ts`), the chat
projection (`src/lib/chat-projection.ts`, `src/lib/chat-rows.ts`, `src/lib/tool-cards.ts`), `SendRequests`
(`src/lib/composer/send-requests.ts`), SSE framing and reconnect delays (`src/lib/event-stream.ts`), navigation
(`src/lib/navigation.ts`), slash-command parsing, file references, diff hunks, Markdown tokenisation.

- **Default: port them to Kotlin** in `Core/`, and make drift impossible to miss. The Vitest tests that own each
  module also write conformance fixtures (`android/app/src/test/resources/conformance/<module>/*.json`: inputs in,
  outputs out, for example events in and projection rows out) with a script, `npm run android:fixtures`, and
  `scripts/api-schema.test.ts`-style staleness checks fail `npm test` when a TypeScript change alters a fixture that
  was not regenerated and committed. The Kotlin JVM tests replay every fixture. A web change to one of these modules
  therefore fails CI until the Kotlin side matches, which is exactly the lockstep the owner asked for.
- **Alternative: run the TypeScript itself** in an embedded engine (AndroidX JavaScriptEngine, which runs in the
  WebView's sandboxed process, or a QuickJS binding), as the iOS plan ran it in JavaScriptCore. One copy of the
  logic, but an asynchronous bridge on every streamed frame, an extra dependency and a harder debugger. Spike A4
  measures both on the 2 MB conversation in `e2e/fixtures/long-session-fixture.ts`; the port is the default because
  Android has no system JavaScript engine to call synchronously.

### 2.6 State

One `ViewModel` (holding `StateFlow`s) per web controller in `src/controllers/`, so a feature's state has the same
owner on both clients: `GatewayViewModel` (settings, update), `SessionsViewModel`, `ConversationViewModel` per open
session, `ComposerViewModel`, `WorkViewModel`, then feature models for launch, backlog, automation, bots, bot facts,
tools, triggers, usage, voice, browser view and dashboard. Drafts and the Work pane state live on the device in
DataStore, as they live in the browser on the web (`docs/api.md`, "Browser-owned composer drafts" and
"Browser-owned Work pane"). The transcript is a `LazyColumn` keyed by the projection's row ids, which also satisfies
the performance rule that a long conversation draws its latest rows.

### 2.7 The hard surfaces

| Surface | Android approach | Spike |
|---|---|---|
| Markdown | The ported tokenizer (or commonmark-java with HUI's rules, decided in A4) rendered to `AnnotatedString` and block composables; tables in a horizontal scroll | A4 |
| KaTeX, Mermaid, Vega-Lite | One offscreen `WebView` loads the embedded bundle and returns SVG/bitmaps cached by source, theme and width, shown as native images | A6 |
| Code highlighting | Tokens from the port (or the embedded bundle's lezer), coloured as `AnnotatedString` | A4 |
| Tool cards | One composable per card kind; unknown tools get the generic card | none |
| Terminal | Termux's `terminal-view`/`terminal-emulator` libraries fed the binary PTY frames, if their licence suits a public repo (owner decision O5); otherwise the web's renderer in a `WebView` | A5 |
| Managed browser view | The frames `src/api/browser.ts` decodes, drawn into an `Image` with the tab picker and follow toggle | none |
| Files | Native tree, search, upload through the system document picker, delete; the editor is CodeMirror in a `WebView`, saves through native calls with `ETag`/`If-Match` | none |
| Diff | The ported hunk parser; unified, and side by side in landscape when SPEC "Diff"'s width rule allows | none |
| VS Code | A `WebView` loads `POST /__hui/sessions/:id/vscode/connect`'s ticketed URL | A3 |
| Agent widgets | A `WebView` host page frames the gateway's `/__hui/widget-sandbox` and speaks the frame protocol (`docs/api.md`, "Frame protocol"); host messages accepted only from the main frame via `WebViewCompat.addWebMessageListener` with an origin allow-list | A6 |
| Attachments | Photo picker, document picker, camera, paste; the server's limits checked before sending | A7 |
| Presented media | Coil for images, Media3 ExoPlayer for audio and video, a zoomable viewer, the share sheet | none |
| Voice calls | The web's `live-call.ts` in a `WebView` with WebRTC and the microphone permission, native controls over a bridge | A8 |
| Notifications | In-app notices, unread and waiting indicators first. Then local notifications for settled and waiting sessions while the app runs, optionally from a foreground service that keeps the gateway's event stream open (owner decision O3). No push | A9 |
| Kanban | Columns in a horizontal pager, long-press drag, the same "Options for" menu | A3 |
| Settings and pages | One Compose screen per page with the web's labels; Usage charts with Compose `Canvas` | none |
| Themes and fonts | Theme JSON from the gateway mapped to a `ColorScheme`; HUI's fonts bundled; type follows the phone's font scale (SPEC "The iPhone app follows the phone's text size") | none |

### 2.8 Reachability and security

- The phone reaches the gateway as its browser does today; the recommended setup stays `tailscale serve` with its
  `ts.net` name in `allowHosts`, which gives HTTPS (`docs/guide.md`, "Remote access through a reverse proxy").
- A network security config allows cleartext only to `127.0.0.1` and `localhost` (the emulator reaches the dev gateway
  through `adb reverse`, section 3.3). Plain HTTP to a tailnet address is owner decision O4; the default is HTTPS
  only for remote gateways.
- No new authentication: the app reaches what the phone's browser reaches, with the same `x-hui`, Host and Origin
  checks. It stores gateway URLs and its own drafts only. Embedded web views navigate only within the gateway origin;
  other links open in the browser.

---

## 3. Iterating locally, fast

The iOS loop was slow because every change went through `xcodebuild` on a Mac and a Release simulator build. The
Android loop is designed so that almost all iteration never touches a device, and the part that does is incremental.

### 3.1 Toolchain: one pinned Nix shell

`flake.nix` gains `devShells.x86_64-linux.android` (and the default dev shell keeps working without it):

- `androidenv.composeAndroidPackages` with platform-tools, the build-tools and platform the app compiles against, the
  emulator and one `system-images;android-<api>;google_apis;x86_64` image; JDK 21; `ANDROID_HOME`,
  `ANDROID_SDK_ROOT` and `JAVA_HOME` exported.
- It needs `allowUnfree` and `android_sdk.accept_license = true` scoped to that shell, which is owner decision O1
  (accepting the Android SDK licence).
- The SDK manager's own emulator binary does not run on NixOS (it expects an FHS system); the Nix-packaged one does.
  Contributors on other Linux distributions or macOS can use `sdkmanager` with the versions `android/AGENTS.md`
  pins instead.
- `nix develop .#android` then `npm run android:doctor` (a small script) checks `adb`, `emulator`, `/dev/kvm`
  access, the AVD, the Gradle wrapper and `npx agent-device doctor`.

Gradle settings in `android/gradle.properties` that matter for speed: the daemon, `org.gradle.parallel`,
`org.gradle.caching`, `org.gradle.configuration-cache`, a JVM heap sized for 28 GB of RAM, and Kotlin incremental
compilation. Debug builds have no R8, no resource shrinking and a single ABI (`x86_64` on the emulator).

### 3.2 The emulator

- One AVD, `HUI_Pixel` (a Pixel profile on the pinned image), created once by `npm run android:avd`.
- `npm run android:emulator` starts it headless with KVM (`-no-window -no-audio -gpu swiftshader_indirect`, or
  `-gpu host` when a display is available) and waits for `sys.boot_completed`. A saved snapshot makes later boots
  quick (target: under 15 s; cold boot under 60 s).
- Two checkouts can run at once with two AVDs and two ports (`E2E_ANDROID_DEVICE`, `E2E_ANDROID_PORT`), as the iOS
  target allowed with two simulators. With 16 cores and 28 GB, two emulators fit (assumption, A2).

### 3.3 Four loops, cheapest first

| Loop | Command | What it proves | Target time |
|---|---|---|---|
| L0 Core and decoding | `npm run android:test` (`./gradlew :app:testDebugUnitTest`) | The Kotlin port replays every conformance fixture; schema types decode recorded responses; SSE framing | seconds, incremental |
| L1 Screens without a device | `npm run android:screens` (JVM screenshot tests of composables, Roborazzi on Robolectric, owner decision on the dependency) | A screen renders in light and dark, at large font scale and narrow width, from fixture state; diffs against recorded images | under 30 s for one screen |
| L2 The real app against a dev gateway | `npm run android:dev` | Builds the debug APK incrementally, installs it on the running emulator, `adb reverse tcp:<port> tcp:<port>`, and launches it with the gateway URL as an intent extra, against `npm run dev` or the visual-verification launcher's isolated gateway with the deterministic provider | target under 20 s from save to the app on screen |
| L3 The shared suite | `npm run e2e:android -- e2e/tests/<area>/<file>.e2e.ts` | The same tests the web runs, on the emulator, through agent-device | about a minute per test (assumption, A1) |

Rules of thumb for an author (and an agent) making a change:

1. Change TypeScript logic shared by both clients → run its Vitest test, `npm run android:fixtures`, then L0. The
   failing Kotlin tests say what to port.
2. Change a screen → L1 for the composable, L2 to use it once, L3 for its use case.
3. Before the PR → `npm test`, `npm run typecheck`, L0, then `npm run e2e` and `npm run e2e:android` for the touched
   use cases. CI runs the whole suite on both.

`npm run android:dev -- --watch` keeps Gradle in continuous mode and reinstalls on each save. Android Studio's Live
Edit needs the IDE; it works on this project but nothing depends on it.

### 3.4 What agents need

The HUI agents that implement features run in this machine's checkouts. They need the Nix shell on `PATH` (the HUI
session can start inside `nix develop .#android`, or the npm scripts can call `nix develop .#android --command …`
themselves so an agent never has to remember), a running emulator per checkout, and the `android/AGENTS.md` loop
table. The visual-verification skill gains an Android section: screenshots through `adb exec-out screencap -p`
for PR evidence, beside the web's desktop and mobile shots.

---

## 4. The shared e2e suite on Android

### 4.1 The target

```ts
{
  name: "android",
  engine: mobile({ platform: "android", device: ANDROID_DEVICE }),
  app: {
    bundleId: "dev.hui.android.debug",
    appPath: "android/app/build/outputs/apk/debug/app-debug.apk",
    readyUrl: `http://127.0.0.1:${ANDROID_PORT}/`,
    command: launcher("android", String(ANDROID_PORT), false),
  },
}
```

Before the suite, `scripts/android-e2e-setup.ts` runs `adb reverse` for the gateway's (or the intercepting proxy's)
port, so the emulator reaches `http://127.0.0.1:<port>` as the iOS simulator did by sharing the Mac's network.

### 4.2 Fixture steps on Android

The fixture keeps one steps table; the Android branch fills it:

| Step | Android |
|---|---|
| Launch at a gateway | `am start` extras via the target's `launchArguments` (`--es huiGatewayUrl <proxy url>`), through the same intercepting proxy the iOS branch used for `hui.intercept` and `hui.dropStreams` |
| `hui.clearState` | `app.clearState()` inside the fixture (`pm clear`); Android has no `cfprefsd` cache, so the iOS workaround goes |
| `hui.open` | `device.openLink("hui://open?path=…")` through the app's deep-link filter |
| `hui.reload` | `app.restart()` |
| `hui.sessionList` | `app.back()` until the session list shows |
| `hui.hold`, `hui.contextMenu` | long press |
| `hui.clipboard`, `hui.copied` | `device.setClipboard` / `device.clipboard` (assumption, A1: clipboard reads from the shell on Android 10+) |
| Colour scheme | `device.setAppearance`, restored after the test |
| `hui.look` | colours from `screencap`; size and fonts from a semantics value the debug build exposes behind a launch extra, as `-HUILooks` did |
| `hui.url` | the app's `app-route` marker, a semantics node whose text is the current route |
| Test ids | Compose `Modifier.testTag` with `testTagsAsResourceId = true` at the root, so `getByTestId` sees them as resource ids (assumption, A1). The portability guard checks that every test id a shared test uses is set in `src/` and, once `android/` exists, by a `testTag` there |

Roles: the engine maps Android widgets onto `button`, `textbox`, `switch`, `text` and `listitem`; Compose semantics
(`Role.Button`, `Role.Switch`, `Role.Tab`, editable text) must surface as those through UiAutomator (assumption, A1).
That is the same portable-role list the guard enforces today.

### 4.3 Running it

`npm run e2e:android` (all), or with test files. A failure leaves `trace.md`, a screenshot and the screen dump in
`.e2e/results/`, as on the web. The emulator must be booted and the APK built: `npm run e2e:android` runs
`./gradlew :app:assembleDebug` first, which is a no-op when nothing changed.

---

## 5. Lockstep: every change ships on Android too

### 5.1 The catalogue

The Android-target PR adds `android: Status` beside `web` on every use case, with:

- `"required"` for nothing yet (no screen exists), `"backlog"` for every use case, recorded in
  `baseline.json`'s `backlog.android`;
- exclusions recovered from the iOS reasons where the decision still holds on Android (keyboard chords, hover-only
  gestures, wide layout, browser-tab mechanics, the web's upload progress, the web Text size control), each citing
  its `SPEC.md` decision;
- a new `ANDROID` area for what only the app does: connecting to a gateway by address and its version notice
  (the old IOS-001's behaviour), and later notifications.

From then on `scripts/use-cases.test.ts` and `scripts/e2e-baseline-check.ts` apply the rules the iOS plan wrote, for
`android`: a required use case has a shared test that runs on the Android target; the backlog only shrinks; a new
use case is required on both platforms unless excluded with a reason and a `SPEC.md` anchor; a changed use case
leaves both backlogs with its shared test; a new accessible name appears in a shared test that runs on both targets.

### 5.2 What that means for a PR

- A web-only behaviour change to a use case still on the Android backlog: allowed only if its PR takes it off the
  Android backlog too, which means its Android screen. That is strict lockstep: early on, a web feature in an area the
  app hasn't reached has to bring that area's Android screens with it, or wait. (Owner decision O2 can soften this to
  "changed use cases may stay Android backlog until their area's milestone" if it blocks too much web work.)
- A change to shared TypeScript logic fails the Kotlin conformance tests until ported (2.5).
- A schema change fails `npm test` until the Kotlin types are regenerated (2.4).
- `AGENTS.md`'s Change Discipline gains: "A user-visible change ships on the web and on Android in the same PR; run
  the Android loops in `android/AGENTS.md`." The PR template asks for Android screenshots beside the web's.

### 5.3 CI

| Job | Runs on | When |
|---|---|---|
| `test` (existing) | ubuntu | every PR; now includes the schema and conformance staleness checks |
| `android-build` | ubuntu | every PR: `./gradlew :app:testDebugUnitTest :app:verifyRoborazziDebug :app:assembleDebug lint` |
| `e2e / web` (existing) | ubuntu | every PR |
| `e2e / android` | ubuntu with KVM enabled (a udev rule for `/dev/kvm`), emulator from the cached SDK with a cached AVD snapshot | every PR, sharded like the web job (assumption, A10: GitHub's Linux runners give KVM and the run time per shard is acceptable) |
| `e2e-catalogue` (existing) | ubuntu | every PR, now with the Android backlog |

The Gradle and SDK caches are keyed on `libs.versions.toml` and the flake lock. Fork PRs need no secret: debug
builds are debug-signed.

---

## 6. Building and shipping the app

| Item | Plan |
|---|---|
| Local | Debug APK, debug-signed, installed by `npm run android:dev` or the e2e target |
| Release build | `./gradlew :app:assembleRelease` with R8, signed with a release keystore held as GitHub secrets, used only by `release.yml` and `nightly.yml` on `main` (owner decision O6: who holds the key and its backup) |
| Versions | `versionName` is the package's `x.y.z` (with the nightly suffix on nightlies); `versionCode` is the commit timestamp `scripts/nightly-version.mjs` already computes, so it only grows |
| Release coupling | `release.yml` builds the APK from the same validated commit as the `.tgz`, after the whole suite on both platforms, and attaches `hui-<version>.apk` and its checksum to the same GitHub Release. `nightly.yml` does the same for the rolling `nightly` prerelease |
| Installing on the phone | Obtainium tracks the repository's releases (stable, or prereleases for nightly) and installs updates; or download the APK and allow the installer once. `docs/guide.md` gains the steps |
| Gateway and app versions | They update separately; the version notice (2.3) handles a mismatch, and lockstep keeps the normal release in step |

---

## 7. Roadmap

### 7.1 Prerequisites

1. This PR: iOS scaffolding removed, this plan, the SPEC decision. PR #347 closed.
2. Owner decisions O1 (SDK licence) and the dependency approvals in section 9.
3. The owner's phone: Android version (10 or later), and whether Obtainium is acceptable.
4. Reachability: `tailscale serve` for the gateway, if not set up already.

### 7.2 Milestone M0: spikes (a throwaway branch, no PR)

| Spike | Question | If it fails |
|---|---|---|
| A1 | Does `@e2e-dev/mobile` on Android drive a Compose debug build: roles from semantics, `testTag` as resource ids, a multi-line text field as `textbox`, `longPress`, `openLink('hui://…')`, clipboard read and write, `setAppearance`, `launchArguments` as intent extras? Cost per test | Add test ids where names don't reach; report engine gaps upstream; keep the affected use cases Android backlog |
| A2 | Toolchain on NixOS: the flake shell builds, the emulator boots headless with KVM, cold and snapshot boot times, two emulators at once | `sdkmanager` inside an FHS shell (`buildFHSEnv`) |
| A3 | Kanban drag, VS Code `WebView` with the ticket cookie, controls inside `WebView`s visible to the engine | Use cases inside web views stay Android backlog until reachable |
| A4 | Kotlin port vs embedded JS engine: reduce and project the 2 MB fixture at streaming rate on the emulator; port effort for the reducer and projection | The other option |
| A5 | Terminal: Termux libraries (licence, PTY frames, key bar) vs the web renderer in a `WebView` | The `WebView` renderer |
| A6 | Rich blocks and widget host in `WebView`: quality, memory, main-frame message checks, `E2E_WIDGET_PROBE` reports every probe blocked | A static widget host route on the gateway (a `docs/api.md` change) |
| A7 | Attachments: can the engine pick seeded files in the system pickers? | A debug-only picker that lists `e2e/fixtures/files` |
| A8 | (before Calls) WebRTC with the microphone in `WebView` against GPT-Live | A native WebRTC library (a dependency) |
| A9 | Local notifications and a foreground service under Android 14+ rules; can the engine see and tap a notification? | Foreground-only notifications |
| A10 | `e2e / android` on GitHub's Linux runners: KVM, boot time, minutes per shard, flake rate over 20 runs | Fewer shards on every PR and the full suite nightly (weakens lockstep; owner decision) |
| A11 | L2 loop time on this machine: edit a composable → app on screen | Tune Gradle; split modules; lean harder on L1 |

A1, A2 and A11 gate the Android-target PR. A4 gates the chat milestone; the others gate their features.

### 7.3 Milestones

Each milestone's done-check: every use case of its areas is required on both platforms and green nightly,
`baseline.json` lost those IDs, and the owner installs the nightly APK and uses the slice.

| # | Slice | Areas |
|---|---|---|
| M1 | This PR: iOS removed, plan, decision | — |
| M2 | Skeleton: `android/` builds in CI, Nix shell, emulator scripts, schema emitter, Connect screen and version notice, live session list, the `android` target and catalogue field, lockstep on | ANDROID, SESS (list) |
| M3 | Chat: open, stream, tool cards, Stop, queue, attachments, errors, recovery, slash commands, model and thinking pickers, Markdown | CHAT |
| M4 | Sessions and navigation: new session, groups, search, menus, palette, split chats' narrow behaviour | SESS, SHELL |
| M5 | Agent interactions and rich content: questions, secrets, subagents, watchers, suggestions, progress, widgets, media, math, diagrams, charts, embeds | AGENT, RICH |
| M6 | Bots | BOT |
| M7 | Settings and pages | SET, PAGE |
| M8 | Work views: terminal, browser view, files, diff, VS Code | WORK |
| M9 | Kanban, worktrees, GitHub, Jira, contributions, calendar | BOARD |
| M10 | Calls | CALL |
| M11 | Notifications beyond in-app (owner decision O3) | ANDROID |

The order follows the iOS plan, which the owner already used; the SwiftUI screens on PR #347 cover M2 to M5 partly
and are the design reference for them.

### 7.4 The first PRs

1. **`refactor: drop the iOS app and plan the Android one`** (this PR).
2. **`feat: add the Android app skeleton with a local build loop`**: `android/` with the Gradle wrapper and version
   catalog, the Nix shell, `npm run android:{doctor,avd,emulator,dev,test}`, the Connect screen and version notice,
   the `android-build` CI job, `android/AGENTS.md`, `docs/map.md` and boundary rules. No e2e target yet.
3. **`feat: generate the Android app's API types from the schema`**: the Kotlin emitter and its staleness check.
4. **`test: run the shared suite on Android and switch lockstep on`**: the target, the fixture's Android steps, the
   `android` catalogue field with its backlog and exclusions, the `e2e / android` job, the session list proven
   (SESS list use cases and ANDROID-001 required).
5. **`feat: open and stream a chat on Android`**: the conformance fixtures, the ported reducer and projection,
   CHAT-001 to CHAT-003 required on Android.

---

## 8. Effort and the cost of lockstep

The iOS plan estimated 34 to 53 focused weeks to iPhone parity. Android saves on CI (Linux runners, no macOS
queue), distribution (no SideStore, no re-signing) and the socket `Origin` risk; it adds the Kotlin port of the
shared logic (2.5) unless A4 favours an embedded engine. A fair estimate is the same range. After parity, a
user-visible web feature costs its Android screen too, typically 0.5 to 1 times the web work again; logic shared
through the conformance fixtures costs a port, not a redesign. This is the cost the owner accepted by choosing a
native app over a WebView shell; the shell remains a fallback if the backlog grows faster than it shrinks.

## 9. Dependencies for approval

Gradle-side (the app only; none touch the web or the gateway): Android Gradle Plugin, Kotlin and the Compose
compiler plugin, Compose BOM and Material 3, AndroidX Activity, Lifecycle, Navigation, DataStore and WebKit,
kotlinx.serialization, kotlinx.coroutines, OkHttp, Coil, Media3; for tests, JUnit, Robolectric and Roborazzi; and,
depending on spikes, the Termux terminal libraries (A5) and a JS engine (A4). npm-side: none new; `@e2e-dev/mobile`
is already pinned. Nix-side: `androidenv` from the pinned nixpkgs.

## 10. Risks and owner decisions

### Risks

- **The engine on Compose** (A1). If agent-device can't reach a control, its use case stays Android backlog; under
  strict lockstep that blocks a change to it.
- **Emulator CI time and flakes** (A10). The suite has `retries: 0`; a flaky emulator would make every PR red.
- **Drift in ported logic.** Mitigated by conformance fixtures generated from the TypeScript tests; anything not
  covered by a fixture can drift silently.
- **Lockstep blocking web work** while the backlog is large (O2).

### Owner decisions

| # | Decision | Default |
|---|---|---|
| O1 | Accept the Android SDK licence for the Nix shell | needed for M2 |
| O2 | Strict lockstep for changed backlog use cases, or let them wait for their area's milestone | strict, as chosen |
| O3 | Notifications: in-app only, local while running, or a foreground service that keeps watching | local while running |
| O4 | Plain HTTP to a tailnet gateway, or HTTPS only for remote gateways | HTTPS only |
| O5 | Termux terminal libraries, if their licence allows | decided after A5 |
| O6 | Release keystore: generated by the owner, held as GitHub secrets, backed up offline | owner generates |
| O7 | Phone only, or also tablets and foldables later | phone only |

## 11. Repository changes beyond code

`AGENTS.md` (the lockstep rule and the Android loop), `CONTRIBUTING.md` (toolchain and loops), `e2e/AGENTS.md`
(the Android target and fixture steps), `docs/map.md` (`android/`), `docs/guide.md` (installing the app),
`.github/pull_request_template.md` (Android checks and screenshots), the visual-verification skill (Android
screenshots), and the release checklist (the APK beside the `.tgz`).

## 12. Deliberately left out

A tablet two-pane layout, Wear OS and Android Auto, push through FCM (it needs a Google project and a relay), a
Play Store listing, and running the gateway on the phone itself.
