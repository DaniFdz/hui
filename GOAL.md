# GOAL — Gateway extensions, verified

This file is the single status ledger for [PLAN.md](PLAN.md). Set the conversation
goal to:

> Implement PLAN.md, verify the status through GOAL.md.

An agent updates it after every milestone. A criterion is checked **only** with the
real command output pasted under its verification run; an unrun check stays
unchecked and appears under “Proof gaps”. Never check a box to make the file look
finished.

## 1. Status

| Field | Value |
|---|---|
| Status | **READY FOR REVIEW** |
| Criteria | 15 / 15 checked |
| Updated | 2026-11-04 |
| Commit | see §6 |
| Branch | `danifdz/gateway-extensions` |
| PR | https://github.com/DaniFdz/hui/pull/408 |
| Checks | 3 pass · 0 fail · 2 not run (recorded, see §7) |

## 2. How to keep this file honest

1. At start: record the baseline in §3 and set Status to IN PROGRESS.
2. After each milestone in PLAN.md §6: update §6, then re-run the affected
   verification runs and paste their output in §4a.
3. A criterion gets `[x]` only when its run in §4a shows the expected result.
4. Anything that could not run goes to §7 with the exact command and error.
5. Deviations from PLAN.md go to §8; all locked decisions D1–D13 stay in force.
6. Status becomes READY FOR REVIEW only when every criterion is checked and the PR
   is green. Only the owner sets DONE and merges.

## 3. Baseline (before any change)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | 33 failed / 2752 passed in 11 files — pre-existing and environmental (process control, local sockets, browser launch, download fixtures); the exact set is unchanged after this work (see V3) |
| Working tree | `git status --short` | only `PLAN.md` and `GOAL.md` untracked |

Baseline failure files: `cli/state.test.ts`, `server/workers.test.ts`,
`src/api/session-connection.test.ts`, `src/views/dashboard.test.ts`,
`server/agent-tools/watchers.test.ts`, `server/bots/schedules.test.ts`,
`server/browser/manager.test.ts`, `server/runtimes/durable.test.ts`,
`server/runtimes/pi-sdk.test.ts`, `server/vscode/install.test.ts`,
`server/vscode/vscode.test.ts`.

## 4. Acceptance criteria

Each criterion names the run in §4a that proves it.

- [x] **A1 — The status route is gated and empty by default.** Anonymous
  `GET /__hui/ext` is 403; with `x-hui: 1` it is 200 `{ "extensions": [] }` on a
  gateway with no extensions installed. *(V2, V5, proof P1)*
- [x] **A2 — The two fixed routes are published and typed.**
  `docs/api.schema.json` lists `GET /__hui/ext` → `ExtensionsResponse` and
  `PUT /__hui/ext/:id` with `ExtensionToggleRequest` → `ExtensionStatus`;
  `src/api/schema/extensions.ts` exports `ExtensionRouteInfo`, `ExtensionStatus`,
  `ExtensionsResponse`, `ExtensionToggleRequest`, `PluginPayload`, `PluginError`.
  Extension-instance routes are **not** in the published schema. *(V1, V2)*
- [x] **A3 — Nothing else in the API contract moved.** Re-running
  `npm run api:schema` after the commit leaves the tree clean; the only generated
  files this work changes are `docs/api.schema.json` and the new
  `src/api/schema/extensions.ts`. *(V1)*
- [x] **A4 — An installed extension is inert until enabled.** The `hello` fixture
  in `<CONFIG_DIR>/extensions/hello` lists as `disabled` with `enabled: false`, and
  its route is 404. *(V4, proof P1)*
- [x] **A5 — Enabling takes effect without a restart.** `PUT /__hui/ext/hello`
  `{ "enabled": true }` returns `loaded`, and the route then answers 200 with the
  fixture body. The store file lists `hello`. *(V4, proof P1)*
- [x] **A6 — Disabling removes the routes immediately.** `{ "enabled": false }`
  returns `disabled`, the route is 404, the store drops it, and re-enabling does
  not re-import the module (marker assertion). *(V4)*
- [x] **A7 — A broken extension cannot take the gateway down.** An import throw is
  reported `failed` with a non-empty `error` while other extensions keep answering;
  `apiVersion: 2` and a `main` escaping the directory are `failed` and never
  imported; an enabled id without a directory is `missing`. *(V4)*
- [x] **A8 — The handler contract is enforced.** `201` is honoured; a throw is 500
  `{ "error": "extension failed" }`; a non-object body, an impossible status and a
  value JSON cannot hold are 500; invalid request JSON is 400; a >64 KiB request is
  413; a wrong method is 405; an unknown id or subpath is 404. *(V4, proof P1)*
- [x] **A9 — Failures are recorded.** A handler failure records one
  `action: "extension_failed"`, `area: "gateway"` diagnostic with the message in
  `detail`; a failing request under `/__hui/ext` is recorded by the HTTP hook
  (`recorded: true` in the order test). *(V2, V4, proof P1)*
- [x] **A10 — The enable store degrades safely.** Missing, corrupt or unsupported
  `extensions.json` reads as empty with `storeError`, a successful toggle rewrites
  it atomically with mode 0600, and ids are deduped, sorted and capped at 64.
  *(V4)*
- [x] **A11 — The use-case catalogue is current.** The two collected route
  surfaces are claimed in `e2e/catalogue/not-ui.ts` with reasons and
  `SPEC.md#gateway-extensions` is listed in `SPEC_EXEMPT`; the catalogue test
  reports no unclaimed, stale or uncovered entry. *(V2)*
- [x] **A12 — Documentation is in place.** `docs/api.md` has
  `### \`GET /__hui/ext\`` and `### \`PUT /__hui/ext/:id\`` sections plus the
  namespace, limits and trust statement; `docs/guide.md` explains installing,
  enabling and disabling; `docs/map.md` names `server/extensions/`; `SPEC.md` has
  `## Gateway extensions` and a decision-log entry. *(V2, review)*
- [x] **A13 — The repository checks pass.** `npm run typecheck` and `npm run build`
  are green; `npm test` has exactly the baseline's 33 environmental failures and no
  new one; no assertion was weakened or skipped. *(V3)*
- [x] **A14 — A real gateway proves it end to end.** The isolated launcher instance
  answered the manual proof in §4b: disabled, enable, call, failure, disable,
  doctor passes, cleanup. *(proof)*
- [x] **A15 — One green PR awaits the owner.** One branch, one PR, template filled,
  exact checks listed, no screenshots required (no browser surface changed) with
  that reason stated, not merged. *(§5)*

## 4a. Verification runs

**V1 — Schema regeneration**

```
npm run api:schema && git status --short docs/api.schema.json src/api/schema/ && npx vitest run scripts/api-schema.test.ts
Result: M docs/api.schema.json; ?? src/api/schema/extensions.ts (new area); 5 tests passed.
Exit: 0
```

`docs/api.schema.json` gains the `extensions` area (142 lines: six payloads and the
two routes); the generated file is `src/api/schema/extensions.ts`. Re-running the
generator after the commit leaves nothing to commit (A3).

**V2 — Focused tests**

```
npx vitest run server/extensions scripts/api-schema.test.ts server/routes/order.test.ts scripts/use-cases.test.ts scripts/module-headers.test.mjs scripts/boundaries.test.mjs
Result: 9 files passed, 86 tests passed.
Exit: 0
```

**V3 — Typecheck, full suite, build**

```
npm run typecheck
Result: exit 0 (server, web and base projects).

npm test
Result: 33 failed / 2771 passed, 419 files; the 33 failures are the identical
baseline set (diffed by file and title: 0 added, 0 removed). All 20 new tests pass.
Exit: 1 (pre-existing failures only).

npm run build
Result: exit 0, client built.
```

**V4 — Extension service and route tests** (covered by V2)

```
server/extensions/registry.test.ts   6 passed
server/extensions/store.test.ts      4 passed
server/extensions/service.test.ts    9 passed
server/extensions/routes.test.ts     1 passed (real middleware, temp HUI_CONFIG_DIR)
```

Cases: id grammar; manifest/entry/route validation; store normalization, atomic
0600 write and corrupt-store repair; disabled → never imported (marker file);
enable → loaded and answering; import throw isolated; `apiVersion: 2` and escaping
`main` failed and unimported; an entry symlink that leaves the directory refused;
enabled id without directory `missing`; disable → routes gone and re-enable does not
re-import; 201/400/413/405/404/500 mappings;
`extension_failed` diagnostics; store error surfaced at reconcile and repaired.

**V5 — Gate spot-check** (order test)

```
server/routes/order.test.ts: 4 passed, including
GET /__hui/ext → 200 ["extensions"] (not recorded, a successful GET),
PUT /__hui/ext/hello → 404 PluginError (recorded),
GET /__hui/ext/hello/hello → 404 PluginError (recorded).
```

## 4b. Manual proof through a real gateway

Launcher: `node e2e/visual-verification.mjs launch --branch danifdz/gateway-extensions`
(isolated HUI config, PI fixture, deterministic provider, OS-assigned port), then
the fixture copied to `$huiConfig/extensions/hello` and driven with Node `fetch`.
Launch doctor, final doctor and cleanup all passed (`"ok":true`).

```
launcher ready after 2s
PASS GET /__hui/ext anonymous -> 403 {"error":"missing x-hui header"}
PASS GET /__hui/ext (disabled fixture) -> 200 {"extensions":[{"id":"hello","enabled":false,"routes":[],"name":"Hello",...,"state":"disabled"}]}
PASS GET /__hui/ext/hello/hello while disabled -> 404 {"error":"unknown extension route: hello"}
PASS PUT /__hui/ext/hello enabled -> 200 {"id":"hello","enabled":true,"routes":[{"method":"GET","path":"hello",...}],"state":"loaded"}
PASS GET /__hui/ext/hello/hello -> 200 {"greeting":"hello, Ada"}
PASS POST /__hui/ext/hello/echo -> 201 {"echo":{"ok":true}}
PASS GET /__hui/ext/hello/boom -> 500 {"error":"extension failed"}
PASS GET /__hui/ext/hello/hello still answers -> 200 {"greeting":"hello, world"}
PASS PUT /__hui/ext/hello disabled -> 200 {"id":"hello","enabled":false,"routes":[],...,"state":"disabled"}
PASS GET /__hui/ext/hello/hello after disable -> 404 {"error":"unknown extension route: hello"}
PASS GET /__hui/ext after disable -> 200 {"extensions":[{"id":"hello",...,"state":"disabled"}]}
PASS extensions.json -> {"version":1,"enabled":[]}
PASS extension_failed diagnostic recorded
doctor: {"ok":true,...,"checks":["owned-instance","unchanged-checkout","x-hui-guard","hui-api","provider-health"]}
cleanup: {"ok":true,"state":"stopped",...,"portsClosed":true}
```

The proof found and fixed one real defect before it shipped: a TypeScript
parameter property (`constructor(readonly id: string)`) is rejected by the
gateway's strip-only TypeScript loader (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), which
`vitest`'s transpiler does not surface. The field is declared explicitly instead.

## 5. Pull request

| Field | Value |
|---|---|
| URL | https://github.com/DaniFdz/hui/pull/408 |
| Checks | `npm test` — 33 baseline failures, 0 new · `npm run typecheck` — pass · `npm run build` — pass · `npm run test:package` — not run (no packaging change) · `npm run e2e` — not run (no browser surface changed) |
| Screenshots | Not applicable: no browser surface changed. Stated in the PR body. |
| CI | all required checks pass on the PR HEAD: Analyze, CodeQL, catalogue, lockfile, package, plan, test, web (1/4–4/4); nix, package (release) and publish are skipped by the workflow for a non-release PR |
| Proof gaps | §7 |
| Merged | No — the owner reviews and merges |

## 6. Milestones

| Milestone | State | Commit |
|---|---|---|
| M0 baseline | done | `docs: add the gateway extension plan` (PLAN.md) |
| M1 schemas | done | `feat(api): publish the gateway extension contract` |
| M2 registry + store | done | `feat(gateway): load trusted extension routes` |
| M3 service | done | `feat(gateway): load trusted extension routes` |
| M4 routes + dispatch | done | `feat(gateway): serve and toggle extensions` |
| M5 docs + catalogue | done | `docs: document gateway extensions` |
| M6 verification | done | `docs: record gateway extension verification` |
| M7 PR | open | PR #408 |

## 7. Proof gaps

- The 33 pre-existing failures above could not be turned green in this environment
  (they need process control, local sockets, a browser and a network download); they
  are identical before and after, and CI runs them properly.
- `npm run e2e` and `npm run e2e:ios` were not run: this PR adds no browser surface
  (D9), so there is no journey to drive. The gateway proof in §4b exercises the real
  server instead.
- `npm run test:package` was not run: no package lifecycle or dependency changed.

## 8. Deviations and decisions taken without the owner

- **Enablement store instead of `settings.json` (D3 kept, PLAN §2 made this explicit).**
  No settings field was added, so no `setting:` catalogue surface and no fixture
  churn; the store is `<CONFIG_DIR>/extensions.json` as planned.
- **One extra payload shape.** `ExtensionToggleRequest` is a named schema, as the
  plan required; no `ExtensionState` schema was added (the state union is inline),
  so the generated area exports exactly the six planned names.
- No other deviation from D1–D13.

## 9. Owner sign-off (owner only)

- [ ] Reviewed the diff and the manual proof
- [ ] Approved the PR
- [ ] Merged
