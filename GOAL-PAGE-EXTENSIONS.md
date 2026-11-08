# Page extensions: P7 verification ledger

`PLAN-PAGE-EXTENSIONS.md` is the program. This ledger records P7 only: the page
and context primitives. The Contributions port is P8 and is not accepted here.

## State

**Status:** DONE (P7 primitives; A4 and the process context proxy are P8
deviations) · **Branch:** `danifdz/hui-page-extensions` (stacked on
`danifdz/hui-extendability`) · **HEAD:** `2e229bb4` · **CI:** green.

## P7 acceptance criteria

- [x] **P7-A1** A manifest may declare `ui.page` with a title, an entry inside
  `ui/` and a named icon; `ExtensionStatus.page` carries it; invalid entries,
  ids and icons are refused with a named reason in Settings and in tests.
- [x] **P7-A2** An enabled page extension adds a sidebar entry and answers
  `/ext/<id>`; the page renders in a sandboxed frame that receives the theme and
  may call only its declared routes through the bridge.
  `navigate` accepts an allowlisted HUI path and refuses everything else.
- [x] **P7-A3** `context.hui` is a typed read-only facade on every in-process
  route handler: `github.contributions` first; it returns plain JSON, never a
  handle. The process-mode proxy moved to P8 (deviation).
- [x] **P7-A4** Moved to P8: packaged extensions, default enablement, eject and the
  doctor checks need the first shipped page.
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

**P7-A6.** SPEC.md and docs/guide.md gained the page and in-process context
contracts; `skills/build-hui-extension` teaches both.

**P7-A7.** `npm run typecheck` 0; `npm run build` 0; `npm run api:schema` no
diff. Full suite: 34 failed / 2912 passed against the 33-failure environment
baseline; the extra `workers.test.ts` "tracked routine receipt" failure passed
alone and is the known remote-worker flake. CI at `2e229bb4`: Test, web 1/4–4/4,
catalogue, package and lockfile pass. Manual proof: `/ext/hello` at 1440×900 and
390×844, desktop/mobile screenshots outside the tree (`page-desktop.png`,
`page-mobile.png`), showing the sidebar entry, the sandboxed page and
`hello, Ada` from its route.

## Deviations

- **P7-A4 moved to P8.** Packaged discovery, default enablement, eject and the
  doctor checks only matter once a real page ships; they move with the
  Contributions port.
- **P7-A3 is in-process only.** The process-mode context proxy needs a new
  bidirectional host frame; it moves to P8. A process-mode route gets a facade that
  refuses with a named error today.

