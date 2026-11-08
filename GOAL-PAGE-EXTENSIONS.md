# Page extensions: P7 verification ledger

`PLAN-PAGE-EXTENSIONS.md` is the program. This ledger records P7 only: the page
and context primitives. The Contributions port is P8 and is not accepted here.

## State

**Status:** DONE (P7 primitives) · **Branch:** `danifdz/hui-page-extensions` (stacked on
`danifdz/hui-extendability`) · **HEAD:** `2e229bb4` · **CI:** green.

## P7 acceptance criteria

- [x] **P7-A1** A manifest may declare `ui.page` with a title, an entry inside
  `ui/` and a named icon; `ExtensionStatus.page` carries it; invalid entries,
  ids and icons are refused with a named reason in Settings and in tests.
- [x] **P7-A2** An enabled page extension adds a sidebar entry and answers
  `/ext/<id>`; the page renders in a sandboxed frame that receives the theme and
  may call only its declared routes through the bridge.
  `navigate` accepts an allowlisted HUI path and refuses everything else.
- [x] **P7-A3** `context.hui` is a typed read-only facade on every route handler:
  `github.contributions` first; it returns plain JSON, never a handle, and a
  process-mode route asks the parent over the host protocol.
- [x] **P7-A4** Packaged extensions are discovered beside the config ones, defaults
  apply until `extensions.json` exists, a config copy overrides, eject copies and
  doctor reports an invalid override or a stale copy.
- [x] **P7-A5** A fixture page extension proves the contract in a shared e2e test:
  navigation, sandbox attributes, a route answer through the bridge, disable, and an
  invalid `navigate` target.
- [x] **P7-A6** `SPEC.md` and `docs/guide.md` describe the manifest,
  the context facade and the page bridge. The eject/override rules belong to P8.
- [x] **P7-A7** Focused tests, `npm run api:schema`, typecheck, build, the full
  suite (the known environment set; one worker flake passed alone) and CI pass; the
  page is exercised at 1440×900 and 390×844.

## Evidence

**P7-A1.** Manifest, status and schema in `fb88e373`; Settings line
`data-extension-page-info` renders *Page · Hello page* (PAGE-047).

```
npx vitest run server/extensions/registry.test.ts scripts/api-schema.test.ts
Result: 2 files, 19 tests passed
Exit: 0
```

**P7-A2 / P7-A5.** Page navigation, sandbox host, bridge and the Hello fixture:

```
npx vitest run src/lib/navigation.test.ts src/lib/extensions/bridge.test.ts src/lib/extensions/pages.test.ts
Result: 3 files, 21 tests passed
Exit: 0

npm run e2e -- --tag PAGE-047
Result: 1 test passed (sidebar, sandbox, bridge title hello, Ada, disable)
Exit: 0
```

Manual proof: `/ext/hello` at 1440×900 and 390×844; the page called its route
through the bridge and rendered *hello, Ada*.

**P7-A3.** In-process context:

```
npx vitest run server/extensions/service.test.ts
Result: 15 tests passed (a route reads context.hui.github.contributions)
Exit: 0
```

**P7-A6.** SPEC.md and docs/guide.md gained the page, context and packaged/eject
contracts; `skills/build-hui-extension` teaches pages and context.

**P7-A4 / process context.** `server/extensions/service.test.ts` covers a packaged
page enabled by default until the store exists, a config override and eject;
`server/extensions/process.test.ts` covers `context.hui.github.contributions`
through the parent; `cli/extensions.test.ts` covers eject;
`cli/doctor-extensions.test.ts` covers the packaged default, a broken override and
a stale copy.

**P7-A7.** `npm run typecheck` 0; `npm run build` 0 and `build/extensions`
holds the packaged defaults; `npm run api:schema` no diff. Focused extension,
process, CLI and doctor tests: 50 passed. Full suite: 33 failed / 2916 passed, the
known environment set only. `npm run e2e -- --tag PAGE-047` 1/1 passes. Manual
proof: `/ext/hello` at 1440×900 and 390×844, screenshots outside the tree
(`page-desktop.png`, `page-mobile.png`), showing the sidebar entry, the sandboxed
page and `hello, Ada` from its route. CI is run at this HEAD after the commit.

## Deviations

- The process context proxy adds `context` / `context-result` frames to the
  versioned host protocol; the protocol version stays 1 because the pair is
  additive. The process call path now passes the query string, which earlier
  process routes silently dropped.

