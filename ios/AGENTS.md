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
  Xcode build checks the list to refuse a missing or stale bundle; Xcode sandboxes build scripts, so that phase has
  to declare the listed files as inputs or turn the sandbox off.

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
  back unchanged. A missing required property still fails the payload.
- A required `const` property is a stored property with that value as its default, so callers never pass it.
- Optional and nullable properties are both Swift optionals, and encoding leaves out `nil`, so a request can't send
  an explicit `null` yet.
- A nested type that would hide a schema type or a common Swift name (`Data`, `Error`, `Task`, `Type`) gets a `Value`
  suffix, and so does an enum case Swift reserves (`init`, `self`) or would confuse with `Optional.none`.

## Swift

- Swift 6 language mode with strict concurrency.
- Every Swift file starts with a header comment saying what it owns, and `docs/map.md` names every directory that
  holds Swift files (`scripts/module-headers.test.mjs` checks both).
- Swift refuses two files with the same name in one module, so the generated files end in `Payloads.swift`. Don't
  give a hand-written file one of their names.
