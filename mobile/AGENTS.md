# mobile/ — the phone shell

HUI on the phone is one Capacitor 8 shell around the gateway's own web UI: the app bundles a single page, the Connect
page in `mobile/connect/`, and then loads the UI of the gateway the user connects to, exactly as the Electron app does
(`desktop/main.cjs`). Every web feature therefore reaches the phone in the PR that builds it. `docs/mobile-app-plan.md`
is the plan and `SPEC.md` ("The phone apps wrap the web UI", "The iOS app connects to one gateway") the product
decision; this file is the frozen contract for the packages that work here.

Section 2 of the plan is the source of truth for ownership, the adapter API, launch extras, ports and scripts. Wave 1
written down in WP1; **nobody changes a contract here without the orchestrator.**

## What lives where

| Path | Owner |
|---|---|
| `capacitor.config.ts` (repository root) | WP1 |
| `mobile/android/**` | WP2 |
| `mobile/connect/**` | WP1, then WP2 |
| `mobile/ios/**` | WP5 |
| `src/lib/native-shell.ts` and its callers | WP3 |
| `e2e.config.ts`, `e2e/fixtures/hui.ts`, `e2e/fixtures/phone.ts` | WP4, then WP6 |
| `.github/workflows/mobile.yml` (one job per package: `android-build` WP1, `android-e2e` WP4, `ios-smoke` WP5, `webkit-phone` WP6) | the job's package |
| `e2e/catalogue/**` | WP4, then the WP7 area owners |
| `scripts/mobile.mjs` | WP1 |

Every npm and Gradle dependency the plan needs was installed in WP1, in one commit with `package-lock.json`. **No later
package runs `npm install` or edits `package.json`/`package-lock.json`** without the orchestrator.

## The app loads the gateway, not a copy of the UI

- `mobile/connect/` is the only bundled web content (`webDir: mobile/connect/dist`, built by `mobile/connect/vite.config.ts`
  and git-ignored). It asks for the gateway address, checks `GET /__hui/update`, shows the refusal of SPEC.md ("This
  address doesn't answer as a HUI gateway.") or the development-gateway notice ("Development gateway: its version is
  unverified."), then hands the address to native code.
- **The runtime server URL (spike S1).** A live Capacitor bridge's server URL cannot change, so `mobile/android`'s
  `MainActivity` resolves the gateway in `onCreate`, *before* the bridge exists, and passes a `CapConfig` whose
  `server.url` is that gateway to `BridgeActivity.load()`. Capacitor's document-start script — the whole bridge, plugins
  included — is then registered for the gateway's origin, and plugins are callable from the gateway's page.
- **Keep the generated asset config.** `new CapConfig.Builder(context)` starts from Capacitor's defaults and silently
  drops `capacitor.config.json`'s `allowNavigation`, `loggingBehavior`, `errorPath` and plugin settings.
  `EmbeddedConfig.withGateway` loads the file `cap sync` copies into assets and injects `server.url` instead. It also
  fills in `android.webContentsDebuggingEnabled` from the app's debuggable flag, because that file's constructor has no
  context to ask: WebView debugging (Chrome DevTools, the CDP attach WP4 needs) is on in the debug APK and off in
  release.
- **The connect handoff.** The Connect page calls the shell's own `HuiGateway` plugin (`mobile/android/app/src/main/java/dev/hui/app/HuiGatewayPlugin.java`):
  `connect({ url })` remembers the address and calls `activity.recreate()`; `forget()` drops it and comes back to the
  Connect page — the action is named **"Change gateway"**; `getState()` answers `{ gateway, failed }` for this launch.
  The address is checked again natively (`GatewayAddress`), so a page cannot point the bridge at a `file:` URL.
- **A gateway that stops answering falls back.** A main-frame load error in `MainActivity` marks the address as failed
  and restarts on the Connect page, which names it and offers "Change gateway", instead of leaving an empty WebView.
  While a gateway loads, a "Connecting to HUI…" view covers the WebView; it goes away on the first committed frame.
- **The deep link opens one screen.** `hui://open?path=<path>` is an intent filter on `MainActivity`: the path is
  appended to the gateway this launch loaded and the WebView loads it, so the link never carries an address and cannot
  point the bridge at a host the user did not connect to. `DeepLink` refuses anything the gateway's own URL cannot simply
  be prefixed to — the encoded path must start with `/`, must hold no `://` (raw or percent-encoded), no backslash and no
  character a URL cannot carry — and the app ignores the link when no gateway is remembered (the Connect page has no
  screens). A launch that also names another gateway restarts the bridge first and then opens the path on *that* gateway:
  one load, never a link and a gateway changing under each other. `HuiGateway.connect`/`forget` drop the link with the
  rest of the launch, so a freshly chosen gateway starts on its own root.
- **Cleartext stays on loopback.** `mobile/android/app/src/main/res/xml/network_security_config.xml` permits plain HTTP
  only for `127.0.0.1`, `localhost` and `10.0.2.2` (the host from the emulator, reached through `adb reverse`). Every
  other gateway needs `https://` (owner decision O3).
- **The camera's photo is the only file the app shares by URI.** `res/xml/file_paths.xml` exposes
  `getExternalFilesDir(…)` — where Capacitor's chooser writes the temp JPEG (`BridgeWebChromeClient.createImageFile`)
  — and the app cache, not all of external storage as it first did. Verified on the emulator: the camera opens from the
  composer and the temp file appears under `Android/data/dev.hui.app.debug/files/Pictures/`; a path outside the provider
  would throw while the chooser starts. Nothing else shares a file by path — `share()` sends HUI's own URLs, never a
  `file:` one.

## The system back button

`ShellBack` is the only answer to a press. **The shell owns the history walk and leaving the app**; the page only says
whether it closed something. The shell dispatches one cancelable `hui:back` `CustomEvent` to the page and reads
`defaultPrevented` in the same `evaluateJavascript` call; if the page did not keep the press, the shell goes back in the
WebView's history and, at its root, leaves the app on a second press within 2 s with "Press back again to leave HUI" in
between.

- `onBack(callback: () => boolean)` in `src/lib/native-shell.ts` (WP3) is that listener. **A page must not
  `preventDefault()` without closing something**: the shell then treats the press as answered and nothing happens, which
  on a phone reads as a dead button. A page without a listener (Connect to HUI) simply lets every press through.
- Capacitor's App plugin would also walk the history from its own callback. `capacitor.config.ts` switches it off
  (`plugins.App.disableBackButtonHandler: true`) so the ordering is explicit rather than a matter of which callback was
  registered last, and `@capacitor/app`'s `backButton` event is not part of the contract.

## Downloads

`ShellDownloads` runs two paths, both reporting in one toast: an `http(s)` file goes to the system download manager, and
a `blob:`/`data:` URL the page made goes through `res/raw/hui_shell.js` to `HuiShellPlugin.saveDownload`, which writes it
with MediaStore (Android 10+) or to the app's external Downloads folder.

- **The bytes path is bounded at 16 MiB** (`ShellDownloads.MAX_BYTES`). The page stops before it reads the file and says
  so; the app refuses a base64 payload over `MAX_BASE64` (4/3 of the cap, rounded up to a whole group of three bytes) and
  `saveBytes` refuses the bytes too, so neither side depends on the other noticing. Measured on the emulator: a 17 MiB
  blob and an over-cap direct plugin call each toast "HUI can't save a download larger than 16 MiB" and write no file,
  while the diagnostics export still saves.
- **The gateway's headers follow the gateway's own URL only.** `x-hui: "1"` and the cookie the gateway's VSCode proxy
  needs are added when `ShellLinks.target` says the download is the gateway's own; another origin gets neither. That is
  because the download manager **replays request headers to the host a redirect lands on**, measured on API 36 with a 302
  from `127.0.0.1:9001` to `127.0.0.1:9002`: the landing host received the `Cookie` header the shell had set. Scoped this
  way, the only cookies that can follow a redirect are the gateway's own, which the redirecting server already has.

## Insets, the status bar and older releases

Above API 30 the shell is the one owner of the system insets: it pads the WebView's frame with the system bar, cutout and
keyboard insets and paints the revealed strip in the page's colour. The page's own `--safe-area-*` tokens (from
`env(safe-area-inset-*)`) would then pay for the same inset twice on a device with a cutout, so the injected script zeroes
them whenever the shell pads (`window.__huiShellOwnInsets`).

- **Below API 30 the platform owns the fitting.** `ShellWindow.PADS_FRAME` is false there, `EdgeToEdge.enable` is not
  called, the window is fitted to the bars and `adjustResize` shrinks it for the keyboard, which is how the composer sat
  above the keyboard before this shell existed. The shell only paints the bars there.
- **What was actually run: API 36 only** (the emulator image the flake pins). The API 24–29 branch, and the double-pad
  case on a device with a cutout, are reasoned from the platform contracts and **not measured** — no cutout device and no
  older system image were available. A few rules read `env(safe-area-inset-*)` directly instead of through the tokens
  (`src/styles/openclaw-shell.css`, `openclaw-chat.css`, `openclaw-workspaces.css`); zeroing the tokens does not reach
  those, so a cutout device would still double-pad in those four places until the web side reads the tokens everywhere.

## The adapter the web uses (WP3)

`src/lib/native-shell.ts` is the only seam, and **`src/` never imports `@capacitor/*`** (`scripts/boundaries.test.mjs`,
rule R18): it reads the bridge Capacitor injects as `window.Capacitor` instead. It exports `nativeShell(): NativeShell |
null`, `null` in a browser so every caller keeps its web behaviour:

```
platform: "android" | "ios"
openExternal(url)          notify({ id, title, body, path })      share({ title, text, url })
setStatusBar({ dark })     onResume(callback)                    onBack(callback): () => void
forgetGateway()            // clears the remembered gateway: HuiGateway.forget() on Android
```

## Native extras (WP10)

- **The share sheet only exists in the app.** A transcript message's action row offers **Share** beside Reply and Copy,
  and draws it only where `nativeShell()` answers a shell, so a browser's action row is exactly what it was. The button
  hands the phone `share({ title, text, url })` with the words the row shows, the conversation's name and the
  conversation's own HUI address (`/sessions/<id>`, or `/bots/<id>` in a bot's chat), built by `messageShare` in
  `src/lib/native-shell.ts` and capped at 64 000 characters, because Android refuses an `Intent` over its transaction
  limit and the sheet would simply never open. `@capacitor/share` is wired on both platforms
  (`app/capacitor.build.gradle`, `CapApp-SPM/Package.swift`). **What was run:** the Android build and the web unit
  tests; no emulator opened the sheet, and no test on the web can reach a control only the app draws.

## What the shell itself does (WP2)

Six behaviours, each in its own class under `mobile/android/app/src/main/java/dev/hui/app/` so a reviewer can read one
at a time. They are the shell's alone: none of it is bundled with the web UI, and `src/` never learns that it is running
in an app.

| Behaviour | Files | What it does |
|---|---|---|
| System back | `ShellBack.java` | The page's own overlay first, then the web UI's history, then out of the app on a second press with a toast in between. |
| Links | `ShellLinks.java`, `MainActivity`'s `BridgeWebViewClient` | The gateway's own pages stay in the app, including a link that only changes the scheme; every other origin and every non-web scheme goes to the system through `Bridge.launchIntent`. |
| Downloads | `ShellDownloads.java`, `ShellPage.java`, `HuiShellPlugin.java`, `res/raw/hui_shell.js` | An `http(s)` file goes to the system download manager with the anchor's name; the page's own `blob:` downloads are read in the page and written to Downloads. One toast says what happened to each. |
| File chooser | `AndroidManifest.xml` (`<queries>`), Capacitor's `BridgeWebChromeClient` | The composer's photo, file and camera inputs open the system photo picker, DocumentsUI and the camera app. |
| Status bar and insets | `ShellWindow.java` | The page is never under the status bar or the navigation bar, and the status bar takes the page's own colour and icon scheme. |
| Keyboard | `ShellWindow.java`, `windowSoftInputMode` | The composer stays above the soft keyboard and the page shrinks instead of hiding under it. |

### The page answers the back button (`hui:back`)

`ShellBack` dispatches one cancelable event in the page and reads the answer back in the same `evaluateJavascript` call,
so it always knows whether the page took the press before it goes back in history or leaves:

```js
const press = new CustomEvent("hui:back", { cancelable: true });
document.dispatchEvent(press);
press.defaultPrevented; // true: the page took the press
```

A page that calls `preventDefault()` keeps it — that is a dialog, the drawer or a pane closing — and the shell then does
nothing else. Otherwise the shell goes back in the web UI's history, and at the root it leaves only on a second press
within two seconds, with the "Press back again to leave HUI" toast in between. The Connect page has no listener, which is
what lets the app leave from there.

**This is the contract WP3's `onBack(callback)` implements.** It is deliberately a page event and not the App plugin's
`backButton`: the shell registers its own `OnBackPressedCallback` after the bridge exists, so it runs before the plugin's
and a plugin listener would never fire.

### Links

`ShellLinks.target(appUrl, link)` answers `IN_APP` (load it), `UPGRADE` (the gateway's own page over the other scheme:
load it on the scheme the app runs on) or `EXTERNAL` (hand it to the system through `Bridge.launchIntent`, which is also
where a plugin that handles a URL gets its say). The comparison is host and port, with each scheme's default port filled
in, so `http://gateway` and `https://gateway` are one gateway whose scheme has to be fixed rather than two origins. Only
main-frame navigations are intercepted: a frame inside the page is the page's own content. `blob:`, `data:` and
`about:` never leave the page.

### Downloads

Two paths, because the web UI downloads two kinds of thing:

- `http(s)` — a file the gateway or another site serves — goes to the system download manager with the name from
  `Content-Disposition`, or the anchor's own `download` name when the page's script handed it over. A download of the
  gateway's own routes carries the `x-hui: 1` header the page's fetches carry (`server/http/route.ts`): the manager's
  request has no `sec-fetch-site` for the gateway to trust, so without it an attachment answers 403.
- `blob:`/`data:` — what `src/lib/download.ts`, `src/api/observability.ts` and the bot export make — cannot be read by
  the manager or the `DownloadListener` at all, and the name only exists in the anchor. `res/raw/hui_shell.js`, injected
  into the gateway's page after each load (`ShellPage`), takes those anchors' clicks, reads the blob (the web UI revokes
  the object URL immediately after clicking, so the blob itself is remembered when it is created), and hands the bytes
  to `HuiShellPlugin.saveDownload`, which writes them to Downloads through MediaStore. A `blob:` download that arrives
  without a click goes the same way through `window.__huiShell.save`.

`ShellDownloads.fileName`/`sanitize` are pure and pinned by `ShellDownloadsTest`.

### Status bar and insets

The WebView's own frame (`ShellWindow`) is padded with the system bar, cutout and keyboard insets, and the padding — not
the WebView's own, which Chromium clips instead of shrinking the viewport — is what keeps the page visible. This matters
because **`env(safe-area-inset-*)` is not a substitute: the emulator without a cutout reports 0px for all four** (measured
with a probe element in the page), so a page that only pads itself draws under the bars.

The window's decor pads itself with the bars and consumes the insets on the way down, so `ShellWindow` stops that first
and lets the insets travel to the frame. The status bar's icons and the strip behind the page take the page's own theme:
the page reports its resolved `color-scheme` and its `--bg` background, read again on every page load and on resume, so a
theme changed in the UI and then backgrounded is right when the app comes back. WP3's `setStatusBar({ dark })` handles a
change on screen. Colours come back from CSS as `rgb(…)` or `#rrggbb` (`ShellColor`, pinned by `ShellDownloadsTest`).

### The camera needs `<queries>`

The manifest names `android.media.action.IMAGE_CAPTURE` and `VIDEO_CAPTURE` in a `<queries>` element. Capacitor's
`onShowFileChooser` asks the package manager whether a camera app answers before it opens one, and Android 11 hides other
apps from that question: without the element the camera input silently falls back to the file picker.

## Launch, ports and target names

| Contract | Value |
|---|---|
| Android launch extra | `am start -n dev.hui.app.debug/dev.hui.app.MainActivity --es huiGatewayUrl <url>` (the app remembers it; honoured in debug builds only) |
| Fallback marker | `huiGatewayFailed` marks the address that did not answer, so the restart shows the Connect page instead of an empty WebView. The app sets it itself; another app's intent only counts while it names the remembered gateway. |
| iOS launch argument | `-HUIGatewayURL <url>` |
| Deep link | `hui://open?path=<path>` on both (WP2 implemented; see "The deep link opens one screen") |
| App ids | `dev.hui.app` (release, iOS), `dev.hui.app.debug` (Android debug, `applicationIdSuffix`) |
| E2E target names | `web`, `android`, `webkit-phone`, `ios-smoke` |
| Gateway port for the emulator | `E2E_PHONE_PORT` (default `47400`), reached through `adb reverse` |
| WebView DevTools port | `E2E_CDP_PORT` (default `9333`), `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` |
| Two workers on one machine | `HUI_ANDROID_AVD=HUI_Pixel_<wp> ANDROID_SERIAL=emulator-55<nn> E2E_PHONE_PORT=474<nn>` |

## The probe goes through native HTTP

From the Connect page (origin `https://localhost`), a `fetch` to the gateway preflights, and the gateway refuses
cross-origin requests with 403 "cross-origin requests are not accepted": every gateway would look refused. The page
therefore probes with Capacitor's built-in `CapacitorHttp` plugin, which uses native HTTP and sends no preflight, and
falls back to `fetch` in a plain browser. **Do not change the gateway for this.**

## The toolchain

`nix develop .#android` (`flake.nix`, kept from spike S1) pins what the app needs, and `scripts/mobile.mjs` re-executes
itself inside it:

- Android SDK 36, **build-tools 35.0.0 and 36.0.0** (the flake's `GRADLE_OPTS` aapt2 override uses 36, and some tooling still asks for 35),
  platform-tools and the headless `google_apis` x86_64 system image;
- **JDK 21** — Capacitor 8 compiles at Java release 21;
- `agent-device`, the e2e engine's device layer and how an agent drives the emulator, wrapped in an FHS environment
  because it runs `/bin/ps` and NixOS has none.

CI (`mobile / android-build`) does the same with `actions/setup-java` (temurin 21), `android-actions/setup-android` and
`platforms;android-36 build-tools;36.0.0`.

## The loops

Run only the narrowest check of what you changed, then push the branch and read the CI run (`gh run watch`). The
`test.yml` and `e2e.yml` workflows run on `push` to `mobile/**` too, so a package branch gets its CI without a PR.

| What changed | Where you check it | Command |
|---|---|---|
| The web UI (most work) | Desktop browser at a phone size, or the Browser tool's phone emulation | `npm run dev`, then `npm run e2e -- <file>` |
| The Connect page | Any browser, then the emulator | `npm run mobile:build` (Vite build + `cap sync android`), `npx vitest run mobile/connect` |
| The same UI on the phone | The app against your dev gateway; later edits need only a reload | `npm run dev`, then `npm run mobile -- dev --gateway http://127.0.0.1:<dev port>` |
| Shell code (`mobile/android`) | Emulator: incremental Gradle, install, launch | `npm run mobile -- dev` (builds, installs at `127.0.0.1:$E2E_PHONE_PORT`, launches) |
| The shell's JVM logic | Host JVM | `npm run mobile -- test` (`./gradlew testDebugUnitTest`) |
| The deep link | Emulator: `adb shell am start -a android.intent.action.VIEW -d 'hui://open?path=/settings/diagnostics'` | `npm run mobile -- dev` first |
| The app's build alone | No device | `npm run mobile -- build` (Connect page, `cap sync`, `assembleDebug`) |
| A screenshot for evidence | Emulator | `npm run mobile -- screenshot /tmp/shot.png` |

`npm run mobile --` commands: `doctor` (toolchain, AVD, KVM, booted device), `avd` (make the AVD), `emulator` (boot it
headless and turn animations off), `stop`, `connect`, `build`, `test`, `dev [--gateway <url>] [--fresh] [--no-gateway]`
(`--fresh` clears app state first, `--no-gateway` opens on Connect to HUI or the remembered gateway), and
`screenshot [path]`.

To verify a change end to end, launch the fixture gateway and drive the app:

```
node e2e/visual-verification.mjs launch --branch <your-branch> --port 47402 --receipt-dir /tmp/hui-<wp> --fast-fixture   # nohup, background
HUI_ANDROID_AVD=HUI_Pixel_<wp> ANDROID_SERIAL=emulator-5556 E2E_PHONE_PORT=47402 npm run mobile -- emulator
npm run mobile -- dev --gateway http://127.0.0.1:47402
```

Seed a session with `POST /__hui/sessions` (`x-hui: 1`) and drive the screen with `agent-device`
(`npx agent-device --help`). Never kill another worker's emulator or change another package's checkout.

### The keyboard and text input on the emulator

The AVD has `hw.keyboard=yes` (typed text never waits on the soft one), so the system hides the IME. Two settings make the
soft keyboard behave like a phone's, and both belong in the dev loop rather than in a commit:

```
adb -s emulator-5556 shell settings put secure show_ime_with_hard_keyboard 1   # draw the IME despite the hardware keyboard
adb -s emulator-5556 shell ime list -s                                          # which IMEs exist
adb -s emulator-5556 shell ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME
```

`agent-device` installs its own test IME (`com.callstack.agentdevice.imehelper`) and makes it current; it answers input
but draws nothing, so a keyboard screenshot needs Gboard selected. `adb shell dumpsys input_method | grep mInputShown`
says whether the IME is up, and the page's own `innerHeight` (867 CSS px on this AVD, 578 with the keyboard up) is the
cheapest proof that the page shrank instead of hiding under it.

### The commands behind each behaviour

`adb shell input keyevent KEYCODE_BACK` is the system back button. The page's `hui:back` answer has no web caller until
WP3 lands, so the back evidence installs a stand-in through the WebView's DevTools socket — the same listener WP3's
`onBack` will ship:

```
adb -s emulator-5556 forward tcp:9333 localabstract:webview_devtools_remote_$(adb -s emulator-5556 shell pidof dev.hui.app.debug)
# then, over CDP (Runtime.evaluate, userGesture: true):
#   document.addEventListener("hui:back", (event) => { closeTheOpenOverlay(); event.preventDefault(); });
```

| Behaviour | Command | What proves it |
|---|---|---|
| Back closes an overlay | open the drawer (`button[aria-label="Open navigation"]`), install the `hui:back` listener, then `adb shell input keyevent KEYCODE_BACK` | the drawer's `data-open` turns `false`, the path is unchanged, the app stays |
| Back goes back in history | open the drawer, click `a[data-testid="nav-item"][href="/sessions"]`, then back | `location.pathname` returns to `/` |
| Back at the root | back on `/` | the "Press back again to leave HUI" toast, `topResumedActivity` still the app |
| Back leaves | back again within two seconds | `dumpsys activity activities` shows the launcher on top |
| External links | in the page, click an `https://example.com/` anchor | `topResumedActivity` becomes Chrome, `location.href` in the WebView is still the gateway |
| Scheme redirect | click an `https://<gateway>/sessions` anchor while the app runs on `http://<gateway>` | the WebView loads `http://<gateway>/sessions`, `topResumedActivity` stays the app |
| Downloads | Settings → Diagnostics → **Export JSON**, then a same-origin `a[download]` | the toast names the file, `adb shell ls /sdcard/Download/` shows it with the anchor's name |
| File chooser | click `input.agent-chat__photo-input`, `input.agent-chat__generic-file-input`, `input.agent-chat__camera-input` | `topResumedActivity` becomes the photo picker, DocumentsUI and the camera app |
| Status bar and insets | switch the theme in Settings → Appearance, then `adb shell input keyevent KEYCODE_HOME` and `adb shell am start -n dev.hui.app.debug/dev.hui.app.MainActivity` | the bar's strip and icons follow the page in light and dark, on resume |
| Keyboard | tap the composer's textarea, then `adb shell exec-out screencap -p > /tmp/shot.png` | the composer sits above the IME and the page's `innerHeight` shrank |

## The iOS side (WP5)

`capacitor.config.ts` already names `mobile/ios`. On iOS the runtime server URL comes from `instanceDescriptor()` in a
`CAPBridgeViewController` subclass, the launch argument is `-HUIGatewayURL`, and WKWebView only allows service workers
with App-Bound Domains, so offline caching may be absent there.

## Where the loop runs

The flake adds `devShells.android` for `x86_64-linux` only: that is the machine the emulator loop was built and measured
on. On macOS the Android shell is absent, so `npm run mobile -- …` there fails inside `nix develop .#android`; use the
iOS half (WP5) or a plain SDK instead. `npm run mobile:build` (the Connect page) needs no Android toolchain at all.

## iOS

`mobile/ios/` is the iOS half of the shell: a Capacitor 8 project generated on Linux with `npx cap add ios` (Swift Package
Manager, no CocoaPods) and committed. Nothing on Linux can build it, so the proof is `.github/workflows/ios.yml`'s
`ios-smoke` job: it builds for the simulator, boots one in the background, launches on a fixture gateway and captures the
screen, on the paths that can break it (not on every PR, because macOS minutes cost about ten times Linux ones).

- **The bridge on a runtime gateway.** `Shell/HUIBridgeViewController` overrides `instanceDescriptor()`, which Capacitor
  calls once per bridge before the WebView exists, and sets `serverURL` to the address `Shell/Gateway` resolves. With no
  gateway the bundled Connect page loads.
- **The plugin must be registered.** Capacitor 8 does not discover a plugin by class name; `capacitorDidLoad()` calls
  `bridge?.registerPluginInstance(HuiGatewayPlugin())` before the WebView loads. Without it every `HuiGateway` call rejects
  with "`HuiGateway` plugin is not implemented on ios" and the Connect page cannot connect at all — which no screenshot
  shows, so `scripts/mobile-contract.test.mjs` asserts the registration on both platforms.
- **One launch, in memory.** `-HUIGatewayURL` and the "did not answer" marker live in statics, as Android keeps them on
  the launch Intent: `UserDefaults`' argument domain cannot be cleared, so a launch argument is consumed rather than
  removed. A relaunch retries the gateway.
- **The fallback** polls for a committed page whose address starts with the gateway (Android uses `onPageCommitVisible`);
  after about a minute without one it marks the address and rebuilds on Connect. The bridge cannot change its server URL,
  so a rebuild replaces the root view controller.
- **Deep links.** `SceneDelegate` handles `hui://open?path=/…` the way Android's `DeepLink` does: a plain path on the
  gateway the app is on, ignored without a gateway, refused if it carries `://`, a backslash or whitespace.
- **Cleartext is loopback only** (`NSExceptionDomains` for `127.0.0.1` and `localhost`), the same rule as Android's
  network security config and owner decision O3. A tailnet gateway needs HTTPS (`tailscale serve`).
- **What iOS does not have:** no App-Bound Domains, so the service worker's offline cache does not run (everything else
  works online); no microphone or resume hooks yet (WP10), the share sheet being `@capacitor/share`'s; and `ios-smoke`
  proves the Connect page and the gateway's UI load, not a tapped journey.

## Distribution (WP8)

A release publishes the phone app beside the CLI archive. `.github/workflows/release.yml` and `.github/workflows/nightly.yml`
build both artifacts from the commit they validated, after their existing checks, and attach them to the same GitHub
Release (or the rolling `nightly` prerelease) with a `.sha256` each. `docs/guide.md` ("Install the phone app") is the
user-facing half; this is what the build assumes.

- **A release APK is signed with the owner's keystore and with nothing else** (`mobile/android/app/build.gradle`, owner
  decision O4). Four repository secrets hold it: `HUI_ANDROID_KEYSTORE_BASE64` (the keystore file, base64-encoded),
  `HUI_ANDROID_KEYSTORE_PASSWORD`, `HUI_ANDROID_KEY_ALIAS` and `HUI_ANDROID_KEY_PASSWORD`. The workflow decodes the file
  into `$RUNNER_TEMP` and passes its path as `-PhuiReleaseStoreFile`; the other three reach Gradle as
  `ORG_GRADLE_PROJECT_huiRelease*`, so no secret is ever on a command line or in a log. `checkReleaseSigning` runs before
  `preReleaseBuild` and fails with the names of the missing values, so a release is never silently unsigned or
  debug-signed — and `assembleDebug` plus the JVM tests keep working without any of them.
- **The version is the workflow's.** `versionName`/`MARKETING_VERSION` is the version that release publishes
  (`package.json` for a stable release, the stamped nightly version for a nightly) and `versionCode`/`CFBundleVersion`
  is the **commit time in minutes** (`-PhuiVersionName`, `-PhuiVersionCode`, `CURRENT_PROJECT_VERSION`). Minutes, not
  the nightly stamp: Android's `versionCode` is a signed 32-bit int and the 14-digit stamp does not fit. Each job checks
  the artifact carries what it was given — `aapt2 dump badging` for the APK, the archive's `Info.plist` for the IPA —
  before uploading it.
- **The IPA is unsigned.** The macOS job archives with `-destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`
  and zips `Payload/App.app` into `hui-<version>.ipa`; SideStore signs it with the user's own Apple ID (owner decision
  O1). Nothing produces a TestFlight build.
- **The assets.** `hui-<version>.apk`, `hui-<version>.ipa`, `hui-sidestore.json` and one `.sha256` per file, beside
  `hui-<version>.tgz`. Obtainium installs the APK; SideStore subscribes to
  `releases/latest/download/hui-sidestore.json` (stable) or `releases/download/nightly/hui-sidestore.json` (nightly).
- **The SideStore source** is `scripts/sidestore-source.mjs` (pinned by `scripts/sidestore-source.test.mjs` and the
  fixture in `scripts/fixtures/sidestore/`). It writes AltStore's source format, which SideStore reads as its fork: one
  app, `dev.hui.app`, one version entry carrying `downloadURL`, `size`, `minOSVersion` (`15.0`, the project's
  deployment target), `date` and the release's changelog. The plan named those fields but no format; this is the one
  SideStore's own published source uses. A change to the format must move the fixture with it.
- **Making the keystore** (the owner does this once, on a machine they trust; the file never enters the repository):
  `keytool -genkeypair -keystore hui-release.keystore -alias hui -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=HUI"`,
  then `base64 < hui-release.keystore` into `HUI_ANDROID_KEYSTORE_BASE64`. **Keep the keystore**: an APK signed with a
  new key cannot install over an older one, so losing it means every user has to uninstall HUI first.
- **What is proven, and what is not.** The Gradle half is proven locally: `assembleDebug` builds, `assembleRelease`
  fails with the message that names the missing properties, and with a throwaway keystore it produces an APK that
  `apksigner verify` accepts and `aapt2` reports with the version and versionCode it was given. The iOS archive,
  `PlistBuddy` check, `Payload` zip and the SideStore step are reasoned from `ios.yml`'s simulator build and **not
  run**: they need the macOS runner, and `workflow_dispatch` cannot start `release.yml` from a branch. Nothing here has
  installed either artifact on a phone.
- **One open question for the nightly IPA.** Its `CFBundleShortVersionString` is the nightly version, which carries a
  prerelease suffix Apple's own format does not allow (`0.2.0-nightly.202611091200.g1a2b3c4`). The archive builds with
  it and the source repeats it exactly, but whether SideStore compares such a version and offers the update is not
  proven; the stable channel's numeric version is the one to rely on until someone tries a nightly on a device.

## Proving a phone change in CI

The local emulator loop above is for one-off checks, on a machine that can spare the cores: **one emulator at a time**,
and stop it with `ANDROID_SERIAL=emulator-55xx npm run mobile -- stop` when you are done. The regular proof of a phone
change runs on GitHub's runners instead of yours:

```sh
gh workflow run mobile.yml --repo DaniFdz/hui --ref <your-branch> -f scope=all   # or scope=required
gh run list --repo DaniFdz/hui --branch <your-branch> --workflow Mobile --limit 1
gh run watch <run-id> --repo DaniFdz/hui
gh run download <run-id> --repo DaniFdz/hui -n e2e-android-0 -D /tmp/phone-run
```

- `scope=required` (the default, and what a push or a pull request runs) runs only the use cases the catalogue says the
  phone proves; the job is green when those pass.
- `files=<path>` runs just those files (or a folder) in the app's WebView, sharded across the four jobs. That is the loop
  to use while fixing one area: an area is minutes, the whole suite is half an hour.
- `scope=all` runs the whole suite in the app's WebView and uploads every shard's `.e2e/` whether it passed or not. Read
  a backlog area's real failures from `/tmp/phone-run/.../.e2e/results/<test>/trace.md` and its screen dump, fix them,
  push, and dispatch again. That is the loop a phone catch-up uses: no emulator on your machine, and the same runner the
  project's CI uses.
- The `Mobile` workflow's `android-e2e` job needs the debug APK, which the same workflow's `android-build` job builds
  in the same run.

## Rules

- One package, one branch, one worktree; no pull request per package (the orchestrator merges).
- Do not edit another package's paths (the table above), `e2e.config.ts`, `src/**` (WP3), or `mobile/ios/**` (WP5).
- Never weaken a test, add a sleep, or change the gateway to work around the shell.
- `mobile/connect/dist` and `mobile/android/app/src/main/assets/{public,capacitor.config.json,capacitor.plugins.json}`
  are generated by `npm run mobile:build`; never edit or commit them.
