# iOS app guide

This directory owns HUI's native iPhone app: a client of the same `/__hui/` contract as the web UI, which shares the
web's pure logic through a small JavaScriptCore core. The plan is `docs/native-ios-plan.md`.

## The core

- `core/entry.ts` is everything the JavaScriptCore core exports, and it only re-exports functions from `src/lib/`. If
  a function lives elsewhere, move it into `src/lib/` first, without changing what it does on the web.
- Nothing the core loads may use the DOM, the network, timers or Node. Swift owns I/O, ids and the clock. Boundary
  rule R18 (`docs/map.md`) keeps the core's imports inside `core/` and `src/lib/`, and `core/entry.test.ts` builds the
  bundle and calls every export in an empty `node:vm` context. A new export needs a call there, or the test fails.
- `npm run ios:core` writes `HUI/Resources/Generated/hui-core.js`, which defines the global `HUICore`, and
  `hui-core.sha256`, a `shasum -a 256 -c` list of the bundle and every file it was built from. Git ignores both. The
  Xcode build checks the list to refuse a missing or stale bundle.

## Payload types

- `HUI/Gateway/Schema/` is generated from `docs/api.schema.json` by `npm run api:schema`, one file per API area.
  Never edit it: change the server's TypeBox schema and regenerate. `scripts/api-schema.test.ts` fails when it is
  stale.
- The types live in the `API` namespace (`API.SessionView`), declared in `HUI/Gateway/API.swift` with the
  `JSONValue` they use for open values, so they never clash with SwiftUI views or SwiftTerm's `TerminalView`.
- An object becomes a struct, and a union of literals an enum with a `String` or `Double` raw value. A union of
  objects told apart by one literal property becomes an enum with a case per member, decoded by that property. Any
  other union, and any value the schema leaves open, is `JSONValue`.
- A newer gateway keeps working: a value or union tag the app doesn't know decodes as `.unrecognized`, and encodes
  back unchanged. A missing required property that can't be null still fails the payload.
- A required `const` property is a stored property with that value as its default, so callers never pass it.
- Optional and nullable properties are both Swift optionals. Encoding leaves out an optional property that is `nil`,
  but writes `null` for a required one that can be null, so a request keeps every key the schema requires.
- CI type-checks the generated Swift (`swiftc -typecheck -swift-version 6`), which catches names or recursive types
  the emitter gets wrong.
- A nested type that would hide a schema type or a common Swift name (`Data`, `Error`, `Task`, `Type`) gets a `Value`
  suffix, and so does an enum case Swift reserves (`init`, `self`) or would confuse with `Optional.none`.

## Swift

- Swift 6 language mode with strict concurrency.
- Every Swift file starts with a header comment saying what it owns, and `docs/map.md` names every directory that
  holds Swift files (`scripts/module-headers.test.mjs` checks both).
- Swift refuses two files with the same name in one module, so the generated files end in `Payloads.swift`. Don't
  give a hand-written file one of their names.

## The Xcode project

- `HUI.xcodeproj` uses folder-synchronized groups: every file under `HUI/` belongs to the `HUI` target and every
  file under `HUITests/` to the `HUITests` target, so adding a file never edits `project.pbxproj`. Files that must
  stay out of the app bundle (`Info.plist`, `hui-core.sha256`) are listed in the `HUI` folder's exception set.
- `HUI`: bundle id `dev.hui.ios`, iOS 18.0, Swift 6, iPhone only, no signing, no entitlements, no extensions and no
  Swift packages. `Info.plist` holds only what build settings can't: the `hui` URL scheme and
  `NSAllowsLocalNetworking`. `HUITests` is hosted by the app, so tests `@testable import HUI`.
- The `Check hui-core.js` build phase runs `shasum -a 256 -c` on `hui-core.sha256` and fails with "run npm run
  ios:core" when the bundle is missing or stale. The `HUI` target turns user script sandboxing off for it, because
  the list of inputs changes with the core's imports and a sandboxed script could not read them.
- Built and tested with Xcode 27.1 (27A9275) and an iPhone 17 simulator on the iOS 27.0 runtime (the 27.1 runtime
  only offers iPhone Duo).

## Commands

- Create and boot the "HUI iPhone" simulator once. The `printf` approves `hui://` links before its first boot, so it
  never asks "Open in “HUI”?" when a test opens one:

  ```sh
  udid=$(xcrun simctl create "HUI iPhone" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
  prefs=~/Library/Developer/CoreSimulator/Devices/$udid/data/Library/Preferences
  mkdir -p "$prefs"
  printf '%s' '<plist version="1.0"><dict><key>com.apple.CoreSimulator.CoreSimulatorBridge--&gt;hui</key><string>dev.hui.ios</string></dict></plist>' > "$prefs/com.apple.launchservices.schemeapproval.plist"
  xcrun simctl bootstatus "$udid" -b
  npx agent-device doctor
  ```

- `npm run ios:build` builds the core, then runs
  `xcodebuild -project ios/HUI.xcodeproj -scheme HUI -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build`
  and `xcrun simctl install "HUI iPhone" ios/build/Build/Products/Release-iphonesimulator/HUI.app`. Boot the
  simulator first.
- `npm run ios:core` builds only the core.
- `npm run e2e:ios` runs the shared e2e tests that run on iOS against the installed Release build, on the booted
  "HUI iPhone" simulator; `e2e/AGENTS.md` says how the target and fixture work. Run `npm run ios:build` first, so the
  tests see the app as it is now.
- Unit tests: `xcodebuild test -project ios/HUI.xcodeproj -scheme HUI -destination 'platform=iOS Simulator,name=HUI iPhone'`
  (run `npm run ios:core` first).

## Talking to the gateway

- Every request goes through `GatewayClient`, which sends `x-hui: 1` and the web's 20 s response deadline as the
  request's idle timeout, so a slow download isn't cut short. The session events stream uses the web's 40 s stall
  timeout instead, which the gateway's 15 s heartbeat keeps alive. A refusal throws `GatewayError` with the status and
  the body's `error` message. `GatewayClient.described` turns a timeout or lost connection, while asking or while
  reading a stream, into HUI's own message. When the Connect screen's address answers with something other than
  `GET /__hui/update`'s payload, it says "This address doesn't answer as a HUI gateway."
- `HUICore` is an actor on its own `DispatchSerialQueue` holding the one `JSContext`. Arguments cross as JSON and
  answers come back through `JSON.stringify`, decoded into Swift types; a script exception throws.
- `SSEFramer` cuts frames at the byte level, so a character split across chunks is decoded whole, and hands each
  frame's text to the core's `decodeSseFrame`.
- `HUITests/Fixtures/` holds responses recorded from a fixture gateway
  (`node e2e/visual-verification.mjs launch --branch <branch> --port <port> --receipt-dir .e2e/hui`), with the
  temporary workspace path replaced by `/tmp/hui-fixture/workspace`. Record them again when their payloads change.

## Screens

- The gateway URL comes from the `-HUIGatewayURL <url>` launch argument or the Connect screen, and both use the
  `HUIGatewayURL` defaults key, so the last gateway that answered is remembered. `npm run ios:build` sets the app's
  version to `package.json`'s; `GatewayModel.versionNotice` compares it with `GET /__hui/update`'s
  `currentVersion` (older and newer gateways get a notice naming both, `null` reads as an unverified development
  gateway).
- A control a shared test finds needs a name: a `TextField`'s prompt is not one, so the Connect screen's field has
  `.accessibilityLabel("Gateway URL")`. Labels a shared test reads come from the core, not Swift copies: rows use `sessionAccessibleName` (with its Jira
  part), `sidebarSessionGroups` with the web sidebar's default options and `sessionTreeRows` with every subagent tree
  folded, and statuses use `sessionStatusLabel`, the chat header's label (a worker session reads "Reconnecting to
  devbox…"), read as `Session status: <text>`.
- `SessionsModel` opens the events stream before it loads the list, then reads the stream, as the web does. Once the
  stream's snapshot arrived its statuses win over every list and upsert, and a session the snapshot leaves out is idle.
  Every listed session has a status label, so a deep link to one the sidebar hides (archived, a Swarm helper) opens.
- The chat screen (`Chat/ChatView.swift`) names its controls as the web's chat does (`Message`, `Send message`, `Stop`,
  `Read <file>`, `Agent activity: <step>`) and takes every label from the core: the core's `chatRows` returns the rows with
  their activity labels and tool cards (`src/lib/chat-rows.ts`), and a `key` per row and item that the screen uses for
  identity, opening and scrolling (tool call ids repeat across turns); the working indicator comes from `workingLabel`. The transcript follows the bottom
  while the reader's scroll leaves it within 48 points of the end, as the web's does. It scrolls only while its content is taller than the screen: a shorter transcript sits at the bottom through `.defaultScrollAnchor(.bottom)`, and `scrollTo` there moves the content past the bottom edge, leaving the screen blank until the content's height changes. Layout can move a following transcript off
  the bottom without changing its height (a lazy row's estimate settling as the working indicator goes), so leaving the
  last 48 points without the reader's scroll goes back to the end (`Chat/TranscriptFollow.swift`). Opening a card or activity row
  scrolls to it and stops following, and a send follows again. A plain button
  whose label has a `Spacer` needs `.contentShape(Rectangle())`, or a tap at its centre misses it.
- `hui://open?path=<path>` opens what the core's `resolveNavigation` resolves the path to; for now only a session
  has a destination, and anything else returns to the list. On the iOS 27.0 simulator `xcrun simctl openurl` opens
  the app directly, whether HUI or another app is in front; if iOS shows its "Open in “HUI”?" confirmation instead,
  a test has to accept it.
