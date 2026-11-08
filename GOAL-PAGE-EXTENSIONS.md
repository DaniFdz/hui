# Page extensions: P7 verification ledger

`PLAN-PAGE-EXTENSIONS.md` is the program. This ledger records P7 only: the page
and context primitives. The Contributions port is P8 and is not accepted here.

## State

**Status:** IN PROGRESS · **Branch:** `danifdz/hui-page-extensions` (stacked on
`danifdz/hui-extendability`) · **Baseline:** the green extension host at
`0b984220`.

## P7 acceptance criteria

- [ ] **P7-A1** A manifest may declare `ui.page` with a title, an entry inside
  `ui/` and a named icon; `ExtensionStatus.page` carries it; invalid entries,
  ids and icons are refused with a named reason in Settings and in tests.
- [ ] **P7-A2** An enabled page extension adds a sidebar entry and answers
  `/ext/<id>`; the page renders in a sandboxed frame that receives the theme,
  reports its height, and may call only its declared routes through the bridge.
  `navigate` accepts an allowlisted HUI path and refuses everything else.
- [ ] **P7-A3** `context.hui` is a typed read-only facade on every route handler:
  `github.contributions` first, then `sessions.list` and `metrics.host`; it
  returns plain JSON, never a handle, and works in-process and in `mode:
  "process"` through the host protocol.
- [ ] **P7-A4** Packaged extensions are discovered beside the server, enabled by
  default for pages, disableable, and shadowed by a config extension with the same
  id. `hui extension eject <id>` copies the packaged source; `hui doctor` reports
  a broken override, a stale copy and a failed default.
- [ ] **P7-A5** A fixture page extension proves the contract in a shared e2e test:
  navigation, sandbox attributes, a route answer through the bridge, disable and
  restore, and an invalid `navigate` target.
- [ ] **P7-A6** `SPEC.md`, `docs/guide.md` and `docs/api.md` describe the manifest,
  the context facade, the page bridge and the eject/override rules.
- [ ] **P7-A7** Focused tests, `npm run api:schema`, typecheck, build, the full
  suite (same known failures) and CI pass; the page is exercised at 1440×900 and
  390×844.

## Evidence

Paste the exact command, result and exit status for each criterion here when it
runs. Do not check a box before its evidence exists.

## Deviations

Record any decision that changes `PLAN-PAGE-EXTENSIONS.md` here, with the reason.
