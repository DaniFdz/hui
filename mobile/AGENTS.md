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
- **Cleartext stays on loopback.** `mobile/android/app/src/main/res/xml/network_security_config.xml` permits plain HTTP
  only for `127.0.0.1`, `localhost` and `10.0.2.2` (the host from the emulator, reached through `adb reverse`). Every
  other gateway needs `https://` (owner decision O3).

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

## Launch, ports and target names

| Contract | Value |
|---|---|
| Android launch extra | `am start -n dev.hui.app.debug/dev.hui.app.MainActivity --es huiGatewayUrl <url>` (the app remembers it; honoured in debug builds only) |
| Fallback marker | `huiGatewayFailed` marks the address that did not answer, so the restart shows the Connect page instead of an empty WebView. The app sets it itself; another app's intent only counts while it names the remembered gateway. |
| iOS launch argument | `-HUIGatewayURL <url>` |
| Deep link | `hui://open?path=<path>` on both (WP2/WP5) |
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

## The iOS side (WP5)

`capacitor.config.ts` already names `mobile/ios`. On iOS the runtime server URL comes from `instanceDescriptor()` in a
`CAPBridgeViewController` subclass, the launch argument is `-HUIGatewayURL`, and WKWebView only allows service workers
with App-Bound Domains, so offline caching may be absent there.

## Where the loop runs

The flake adds `devShells.android` for `x86_64-linux` only: that is the machine the emulator loop was built and measured
on. On macOS the Android shell is absent, so `npm run mobile -- …` there fails inside `nix develop .#android`; use the
iOS half (WP5) or a plain SDK instead. `npm run mobile:build` (the Connect page) needs no Android toolchain at all.

## Rules

- One package, one branch, one worktree; no pull request per package (the orchestrator merges).
- Do not edit another package's paths (the table above), `e2e.config.ts`, `src/**` (WP3), or `mobile/ios/**` (WP5).
- Never weaken a test, add a sleep, or change the gateway to work around the shell.
- `mobile/connect/dist` and `mobile/android/app/src/main/assets/{public,capacitor.config.json,capacitor.plugins.json}`
  are generated by `npm run mobile:build`; never edit or commit them.
