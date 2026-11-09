# PLAN — Gateway extensions in HUI

Task contract for one unattended PR. The owner is away: every decision this work
needs is made below. Do not ask; implement, verify and record the result in
[GOAL.md](GOAL.md), which is the single status ledger.

Suggested goal: **“Implement PLAN.md, verify the status through GOAL.md.”**

`PLAN.md` and `GOAL.md` ship in this PR as the task's own documentation. The owner
may delete them afterwards; do not delete them in this PR.

## 1. Mission

Let a trusted local module add JSON routes to HUI's gateway, under a namespace HUI
owns, with the same `x-hui` gate, diagnostics and documentation as HUI's own
routes — while every existing route, payload type and committed schema stays
exactly as it is for a gateway with no extensions installed.

This is v1 of a platform seam, not a plugin economy. It is deliberately small:
JSON in, JSON out, no UI, no sandbox, one process.

## 2. Locked decisions (do not reopen)

| # | Decision | Value |
|---|---|---|
| D1 | Feature name | **Gateway extensions** (code: `extensions`) |
| D2 | Installed layout | `<CONFIG_DIR>/extensions/<id>/extension.json` plus its entry module |
| D3 | Enablement store | `<CONFIG_DIR>/extensions.json`, `{ "version": 1, "enabled": ["<id>"] }` |
| D4 | Route namespace | `/__hui/ext` (status), `/__hui/ext/<id>` (toggle), `/__hui/ext/<id>/<path…>` (extension routes) |
| D5 | Payloads | JSON objects only; no HTML, files, redirects, headers, SSE or WebSocket |
| D6 | Typed contract | Two published routes (`GET /__hui/ext`, `PUT /__hui/ext/:id`); extension routes always answer `PluginPayload` or `PluginError` and are **not** published in the schema |
| D7 | Trust | In-process, trusted code with the gateway's full access. No sandbox, no timeout, no permission prompt. Documented, off by default (empty enable list) |
| D8 | API version | `apiVersion: 1` in the manifest; any other value refuses to load with a named reason |
| D9 | No new UI | No page, no Settings entry, no browser code in this PR. Operator drives it over HTTP and `extensions.json` |
| D10 | No new dependencies | None, in any workspace |
| D11 | No `hui doctor` check | Nothing persisted by older HUI is left behind; load failures are diagnostics and API state |
| D12 | Lifecycle | Import at gateway start and when enabled; disabling drops the routes but does not unload the module (Node caches it) |
| D13 | One PR | One branch, one PR, no merge: the owner reviews and merges |

Do **not** put enablement in HUI settings (`settings.json` / `Settings`). That would
add a `setting:` catalogue surface and force edits to 109×2 fixture objects. D3 is
final.

## 3. Why the shape is what it is (read before coding)

- Browser payload types are generated at build time from `server/api/index.ts` →
  `docs/api.schema.json` → `src/api/schema/<area>.ts`. A plugin's routes exist only
  at runtime, so per-plugin typed payloads are impossible without a build step.
  Hence D6: one typed envelope, `PluginPayload = Record<string, unknown>`.
- `scripts/api-schema.test.ts` fails if a `server/routes/*.ts` module exports no
  `routeSchemas`, or if a published route has no `### \`METHOD /__hui/…\`` heading
  in `docs/api.md`. Extension handlers therefore live in `server/extensions/`, and
  only the two fixed routes are published.
- `server/hui.ts` is a hand-ordered chain; `server/routes/order.test.ts` pins it.
  A path-confined namespace cannot shadow anything, so the extension station slots
  in after `piRoutes` without restructuring the chain.
- `scripts/module-headers.test.mjs` requires a header comment on every source
  module under `server/` and a `docs/map.md` mention of every source directory.
  Keep test fixtures out of `server/` (D3/D2 tests write them into temp dirs from
  inline strings); the demo extension for manual proof lives in `e2e/fixtures/`.
- `scripts/use-cases.test.ts` (part of `npm test`) requires every collected
  surface to be claimed by a catalogue use case or `e2e/catalogue/not-ui.ts`, and
  every `##` section after `# Part 2` in `SPEC.md` to be cited or exempted. It also
  fails on stale entries, so add exactly what the run demands.
- Never write a literal `METHOD /__hui/ext/<id>/…` sequence in Markdown.
  `e2e/catalogue/surfaces-server.ts` collects such sequences from `docs/api.md` as
  surfaces. Describe the dynamic shape as `/__hui/ext/<id>/<path>` with the method
  words separate from the path.
- `lib/api` schema composition: pass schema objects directly
  (`Type.Array(ExtensionStatus)`), never `Type.Ref(...)`. `buildApiSchema` hoists
  nested `$id`s into `$defs`; a bare `Type.Ref` would emit an unresolvable
  `{"$ref":"ExtensionStatus"}`.

## 4. The contract

### 4.1 Installed extension

```
<CONFIG_DIR>/extensions/hello/
  extension.json
  index.mjs
```

`id` is the directory name: `^[a-z][a-z0-9-]{0,31}$`.

`extension.json`:

```json
{
  "apiVersion": 1,
  "name": "Hello",
  "description": "One optional sentence.",
  "main": "index.mjs"
}
```

Rules: `apiVersion === 1`; `name` a non-empty string ≤ 80 characters without
control characters; `description` a string ≤ 240 (missing = `""`); `main` a
relative path ending in `.mjs` or `.js`, with no `..` segment, whose `realpath`
resolves inside the extension's own directory (reject escaping symlinks).

`index.mjs` (ESM only; TypeScript is not supported in v1):

```js
export const routes = [
  {
    method: "GET",
    path: "hello",
    description: "Greets a name.",
    handle: async ({ query }) => ({ body: { greeting: `hello, ${query.get("name") ?? "world"}` } }),
  },
];
```

`routes` is a non-empty array of at most 32 entries. `method` is one of `GET`,
`POST`, `PUT`, `PATCH`, `DELETE`. `path` is 1–4 `/`-separated segments, each
matching `^[A-Za-z0-9._~-]{1,64}$` and not `.` or `..`; duplicates of
`method + path` make the extension `failed`.

`request.json()` throws one `Error` for both malformed JSON and an oversized
body (`"request body too large"`); the service maps that message to 413 and every
other throw to 400.

`handle` receives `{ method, path, query, body, signal, extension }`:
`path` is the subpath below `/__hui/ext/<id>/`, `query` is a `URLSearchParams`,
`body` is the parsed JSON request body (or `undefined`), `signal` aborts when the
client goes away, `extension` is the id. It returns (or resolves to)
`{ status?, body }`: `status` an integer 100–599 (default 200), `body` a plain
JSON object (not an array, not `null`) that serializes to at most 256 KiB.

### 4.2 Routes

| Route | Behavior |
|---|---|
| `GET /__hui/ext` | `ExtensionsResponse`: every installed directory plus every enabled id, sorted by id |
| `PUT /__hui/ext/<id>` | Body `{ "enabled": boolean }` → persists and reconciles → `ExtensionStatus`. Unknown id → 404 `unknown extension: <id>`. Invalid body → 400 `body must be { "enabled": boolean }`. Other methods → 405 `method not allowed` |
| `<method> /__hui/ext/<id>/<path>` | The extension's route. Unknown id → 404 `unknown extension: <id>`. Known id without a matching subpath → 404 `unknown extension route: <path>`. Known subpath with another method → 405 `method not allowed`. Handler throw → 500 `extension failed`. Non-object or oversized response → 500. Invalid request JSON → 400 `body must be JSON`. Request body > 64 KiB → 413 `request body too large` |

Every failure body is `PluginError` (`{ "error": string }`). All of `/__hui/`
keeps the `x-hui: 1` gate; an anonymous request is rejected before any extension
code runs. Successful GETs are not recorded in diagnostics; every other outcome is
recorded by `server/hui.ts`'s existing finish hook. A handler failure also records
one `area: "gateway"`, `action: "extension_failed"`, `level: "error"` event with
the message in `detail` (two entries for one 500 is expected: the HTTP outcome and
the extension failure).

### 4.3 State and store

`<CONFIG_DIR>/extensions.json`:

```json
{ "version": 1, "enabled": ["hello"] }
```

A missing file means no extensions. A corrupt or unsupported file reads as empty
and surfaces `storeError` in `ExtensionsResponse` (and one warning diagnostic at
startup); it is rewritten only when a toggle succeeds. Normalization: array of
strings, keep ids matching the grammar, dedupe, sort, cap 64. Writes are atomic
(temp file + rename, mode 0600) after `ensureConfigDir()`.

`list()` rescans `<CONFIG_DIR>/extensions/` on every call, so an extension copied
in while the gateway runs appears as `disabled` without a restart; only enabling
imports it. `reconcile()` handles imports, not listing.

Per-id state (`ExtensionStatus.state`): `loaded` (enabled, imported, routes
registered), `disabled` (installed, not enabled — manifest still parsed for the
list, module never imported), `failed` (bad manifest, bad entry, import throw or
bad routes; `error` explains it), `missing` (enabled id with no directory).
`enabled` always mirrors the store. Scan at most 200 directories.

A toggle is a recorded choice, not a promise it loaded: enabling an extension whose
manifest or import fails answers 200 with `state: "failed"` and its `error`; only
the unknown-id and malformed-body cases are 4xx.

## 5. Files

New:

- `server/api/extensions.ts` — `ExtensionRouteInfo`, `ExtensionStatus`,
  `ExtensionsResponse`, `ExtensionToggleRequest`, `PluginPayload`, `PluginError`,
  and `routeSchemas` for exactly these two published routes (paths are literals
  and the catalogue reads them):
  `{ method: "GET", path: "/__hui/ext", response: ExtensionsResponse }` and
  `{ method: "PUT", path: "/__hui/ext/:id", request: ExtensionToggleRequest,
  response: ExtensionStatus }`. Register the `extensions` area in
  `server/api/index.ts`. Compose with schema objects, never `Type.Ref`.
- `server/extensions/registry.ts` — pure parsing/validation: id, manifest, entry
  path containment, routes, sorting. No filesystem writes, no imports of modules.
- `server/extensions/store.ts` — `readExtensions()`, `writeExtensions()`,
  normalization, atomic write, `storeError`.
- `server/extensions/service.ts` — scan, import, state, `list()`,
  `setEnabled(id, enabled)`, `reconcile()`, `match(method, path)`,
  `invoke(match, request)`. `createExtensionsService({ record = recordDiagnosticEvent } = {})`
  so tests can capture diagnostics. Serialize reconciles with a promise chain.
  Record `extension_load_failed` once per extension per reconcile.
- `server/routes/extensions.ts` — `routeSchemas` re-export and
  `createExtensionRoutes({ extensions })` with `handle(request)`.
- `e2e/fixtures/extensions/hello/extension.json` and `index.mjs` — the demo used by
  the manual proof (`GET hello`, `POST echo`, `GET boom`).

Edit:

- `server/paths.ts` — `EXTENSIONS_DIR`, `EXTENSIONS_FILE`.
- `server/hui.ts` — one station after `piRoutes`:
  `if (answered(response, path, await extensionRoutes.handle(routed))) return;`.
- `server/services.ts` — create the service and the routes (`extensionRoutes`).
- `server/backend.ts` — `await extensions.reconcile()` after `ensureConfigDir()`.
- `server/routes/order.test.ts` — cases and schema assertions (see §7).
- `docs/api.md` — `### \`GET /__hui/ext\`` and `### \`PUT /__hui/ext/:id\``
  sections, the namespace contract, limits, trust statement, `PluginPayload`.
- `docs/guide.md` — operator section: layout, example, enabling over HTTP,
  disabling, trust warning.
- `docs/map.md` — `server/extensions/` row.
- `docs/implementation-roadmap.md` — item for this seam.
- `SPEC.md` — `## Gateway extensions` before `## Decisions`, plus one decision-log
  entry.
- `e2e/catalogue/not-ui.ts` — after `npm run api:schema`, add the two collected
  route surfaces with reasons, and `SPEC_EXEMPT["gateway-extensions"]` if the
  use-cases test demands it. Remove any entry that becomes stale.

Every new `.ts` module starts with a header comment saying what it owns.

## 6. Order of work

1. **M0 baseline.** `git status --short`; if `node_modules` is missing in this
   checkout, `npm ci` first (this worktree may not have one; never borrow another
   checkout's unless its lockfile is identical). Then `npm run typecheck` and
   `npm test`; record the baseline (pass/fail) in `GOAL.md`. Do not "fix" unrelated
   failures.
2. **M1 schemas.** `server/api/extensions.ts` + area registration +
   `npm run api:schema`. Expected diff: `docs/api.schema.json`,
   `src/api/schema/extensions.ts`, nothing else. Run
   `npm test -- scripts/api-schema.test.ts`.
3. **M2 registry + store.** Pure modules and their tests.
4. **M3 service.** Scan/import/state/reconcile; tests with inline fixture files in
   temp directories.
5. **M4 routes + dispatch.** Route module, `hui.ts`, `services.ts`, `backend.ts`,
   `order.test.ts` cases, integration test.
6. **M5 docs + catalogue.** `docs/api.md`, `docs/guide.md`, `docs/map.md`,
   roadmap, `SPEC.md`, `not-ui.ts`. Run `npm test -- scripts/use-cases.test.ts
   scripts/module-headers.test.mjs scripts/boundaries.test.mjs` and fix what it
   names.
7. **M6 verification.** §8 end to end, including the manual proof.
8. **M7 PR.** §9.

## 7. Tests

`server/extensions/registry.test.ts` — id grammar; manifest fields (`apiVersion`,
`name`, `description`, `main` type/suffix/escape, symlink escape); route methods,
segments, depth, duplicates; deterministic sorting.

`server/extensions/store.test.ts` — missing/corrupt/unsupported file; dedupe, sort,
cap; atomic rewrite; mode 0600; `storeError`.

`server/extensions/service.test.ts` — inline fixtures written to a temp
`CONFIG_DIR`:
- enabled + valid → imported, `loaded`, route matched;
- disabled → listed `disabled`, **not imported** (fixture appends to a marker file
  named by an env var; assert the file is absent);
- import throw → `failed` with `error`, gateway unaffected;
- bad `apiVersion` and escaping `main` → `failed`, never imported;
- enabled id without directory → `missing`;
- disable → routes gone immediately, module not re-imported on re-enable;
- `setEnabled` persists to `extensions.json` and reconciles;
- handler throw/non-object/oversized/status out of range → 500 `PluginError` and
  one `extension_failed` diagnostic (through the injected recorder).

`server/extensions/routes.test.ts` — real `middleware` with a temp
`HUI_CONFIG_DIR` (model: `server/routes/order.test.ts`). Set the env var **before**
the dynamic `import("../hui.ts")`; `server/paths.ts` freezes `CONFIG_DIR` at import:
- anonymous `GET /__hui/ext` → 403;
- `GET /__hui/ext` → 200 and `ExtensionsResponse` schema;
- fixture `GET /__hui/ext/hello/hello?name=Ada` → 200 `{ "greeting": "hello, Ada" }`;
- `POST …/echo` → 201 echo; invalid JSON → 400; >64 KiB → 413;
- `PUT /__hui/ext/hello` true → 200, route works without restart; false → route
  404 and state `disabled`;
- unknown id, unknown subpath → 404 `PluginError`; wrong method → 405;
- `GET /__hui/ext/hello/boom` → 500 `PluginError`, gateway still answers the next
  request, `extension_failed` recorded.

`server/routes/order.test.ts` — add to `CASES` (order and recording proof):

```ts
["GET /__hui/ext", 200, ["extensions"], false],
["PUT /__hui/ext/hello", 404, ["error"], true],
["GET /__hui/ext/hello/hello", 404, ["error"], true],
```

and in `answer()`: errors under `/__hui/ext` use `PluginError`; a 200 on
`/__hui/ext` uses `ExtensionsResponse`.

## 8. Verification (paste real output into GOAL.md)

```sh
npm run api:schema
git diff --stat                      # only the schema, the new area file, nothing else
npm test -- server/extensions scripts/api-schema.test.ts server/routes/order.test.ts scripts/use-cases.test.ts scripts/module-headers.test.mjs scripts/boundaries.test.mjs
npm run typecheck
npm test
npm run build
```

Manual proof through a real gateway (no browser needed; this PR has no UI). Use the
repository launcher so the instance is isolated and its port is known:

```sh
mkdir -p /tmp/hui-ext-proof
# in a background exec; it stays in the foreground until stopped
nohup node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)" \
  > /tmp/hui-ext-proof/launch.json 2>/tmp/hui-ext-proof/launch.log &
```

Wait until `/tmp/hui-ext-proof/launch.json` holds one JSON object with
`state: "ready"` (poll the file; never a fixed sleep). If `launch.log` shows a
failure instead, record it under Proof gaps and continue with the rest. That
object carries `url`, `huiConfig` and `receipt` (the **private** receipt path).
`doctor` and `cleanup` need the private path — the `receipt-<port>.json` file a
`--receipt-dir` run publishes has its token stripped, so never use it for this
proof.

Then:

1. `huiConfig` from the launch JSON, `cp -R e2e/fixtures/extensions/hello
   "$huiConfig/extensions/hello"`.
2. `GET <url>/__hui/ext` → `hello`, `disabled`, `enabled: false`.
3. `PUT <url>/__hui/ext/hello` `{ "enabled": true }` → `loaded`; then
   `GET <url>/__hui/ext/hello/hello?name=Ada` → `200 { "greeting": "hello, Ada" }`;
   `GET …/boom` → 500 `{ "error": … }`; anonymous request → 403.
4. `PUT … { "enabled": false }` → route 404, state `disabled`.
5. `node e2e/visual-verification.mjs doctor --receipt "$receipt"` passes.
6. `node e2e/visual-verification.mjs cleanup --receipt "$receipt"` stops it.

Use `fetch` from Node (this machine has no `curl`). Keep the transcript in
`GOAL.md` and the PR body; keep every artifact outside the checkout.

## 9. PR protocol

- Shared checkout: start with `git status --short`. Carry unrelated work through
  untouched; stage only this task's files (use the `git-selective-staging` skill
  when anything else is dirty). Never `git add -A`, stash, reset or clean.
- Branch from an up-to-date `origin/main` named `danifdz/gateway-extensions`. If
  the current worktree holds unrelated changes, create a separate worktree and
  carry `PLAN.md`/`GOAL.md` there.
- Commit messages start with a Conventional Commit type. Suggested commits:
  `docs: add the gateway extension plan and status ledger`,
  `feat(api): publish gateway extension payloads`,
  `feat(gateway): load trusted extension routes`,
  `feat(gateway): serve and toggle extensions`,
  `docs: specify gateway extensions`,
  `docs: record gateway extension verification`.
- Update `GOAL.md` in the same commit as the work it records. Push; open one PR
  using `.github/pull_request_template.md`.
- PR body: what changed, why, the exact checks with their real results,
  `npm run test:package` only if packaging changed, **screenshots: not applicable —
  no browser surface changed**, the manual proof transcript, the use-case lines
  (`Unchanged behaviour:` or the exempted surfaces), and any remaining proof gap.
- Do not merge. The owner approves and merges.

## 10. Operating rules

- No operator decisions arrive. If something is ambiguous, choose the narrower
  option, keep D1–D13, and record the choice under “Deviations” in `GOAL.md`.
- Never weaken, skip or delete an assertion to get green. A check that cannot run is
  a recorded proof gap plus the exact error, not a pass.
- A pre-existing failure is reported with its baseline evidence and left alone.
- Keep `PLAN.md` unchanged once implementation starts; only `GOAL.md` tracks state.
- Timebox: if a milestone's tests cannot pass in two focused attempts, ship the
  narrowest working version (registry, store, status route, toggle, dispatch,
  tests, docs) and mark the rest as a documented gap rather than silently dropping
  a locked decision.

## 11. Definition of done

Every criterion in `GOAL.md` is checked with pasted evidence, except any recorded
under Proof gaps with its exact error, and the full suite, typecheck and build
pass. The manual proof transcript is in the PR, and the PR is open, green and
awaiting the owner.

## 12. Non-goals (v2 candidates, do not build here)

Browser UI for extensions; per-plugin generated payload types; SSE and WebSocket
routes; HTML/file responses; out-of-process isolation or sandboxing; hot reload of
extension code; extension-contributed prompt sections or agent tools (the other
extendability axes); `hui doctor` integration.
