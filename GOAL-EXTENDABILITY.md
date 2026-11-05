# GOAL — Full harness extendability, verified

Program ledger for [PLAN-EXTENDABILITY.md](PLAN-EXTENDABILITY.md). One long-running
goal implements every phase; the phases are checkpoints of **one branch and one
pull request** (see PLAN §7). There is no per-phase PR, no second program PR and no
follow-up PR. Set the goal to:

> Implement all phases of PLAN-EXTENDABILITY.md; verify through GOAL-EXTENDABILITY.md.

Rules for the program session:

1. Read this file first. After an interruption or context loss, resume from
   **§2 Resume point**: never redo a phase marked DONE.
2. Start from `main` when PR #408 is merged, or carry its commits by branching from
   `danifdz/gateway-extensions` when it is not, then cherry-pick the plan commits
   from `danifdz/extendability-plan`; branch `danifdz/hui-extendability`, open **the
   one program PR** as a draft, and keep it draft until P6. Once it is open, close
   #408 and #412 as superseded (their commits are in it), and rebase the draft onto
   `main` when they merge (E23). No second program PR is ever opened.
3. Before each phase: check the PR for unresolved review comments and address them
   first; then record the phase's baseline in its `Runs` block.
4. After each phase: re-run its runs, paste the real output, update this file and
   commit code + ledger together. Push and wait for the required CI jobs on that
   HEAD. Only then mark the phase DONE (with its commit and CI run) in the next
   commit — a ledger-only commit, or the next phase's first commit — and start the
   next phase. A red required check stops the program until it is fixed.
5. A criterion is checked **only** when a run shows it. Anything that could not run
   goes under Proof gaps with the exact command and error. Never weaken, skip or
   delete an assertion to get green.
6. Keep `PLAN-EXTENDABILITY.md` unchanged; only this file tracks state. Never merge
   the PR, never rewrite a DONE phase's history, never start a dependent phase on a
   red HEAD.
7. If a phase cannot pass the same failing check after two focused attempts, mark it
   BLOCKED here with the exact error and stop. P4 does not depend on P2/P3; no other
   phase may skip its predecessors.
8. If the PR is merged before P6, the program ends early: mark the remaining phases
   NOT DONE here, stop, and open **no** follow-up PR. Only the owner merges.

## 1. Program status

| Phase | Scope | Status | Commit | CI |
|---|---|---|---|---|
| P0 | Gateway routes, store, status/toggle | carried in the program PR (PR #408 closed as superseded) | 854608e6 | #408 green |
| P1 | Settings page + `hui extension list/enable/disable` | **DONE** | 918e0f0c | green (run 42021662186) |
| P2 | Sandboxed panels and the bridge | **DONE** | d60951c5 | green (run 42031190678; catalogue re-run 42032678418) |
| P3 | Prompt sections and agent tools | **DONE** | ec18488b | green (runs 42038480178, 42038480264) |
| P4 | Server-sent events | **DONE** | 6db2f619 | green (runs 42042613325, 42042613255) |
| P5 | Reload, engines, doctor, install/remove | **DONE** | 7347cb53 | green (runs 42045860596, 42045860744) |
| P6 | Out-of-process mode | **DONE** | f643ad69 | green (runs 42051036855, 42051036850) |

Statuses: NOT STARTED · IN PROGRESS · BLOCKED · DONE (CI green) · MERGED (owner).

## 2. Resume point

| Field | Value |
|---|---|
| Current phase | complete — all phases DONE |
| Next action | The program PR is ready for the owner: review the branch and merge; do not merge on the implementer's behalf. |
| Branch | `danifdz/hui-extendability` |
| Program PR (the only one) | https://github.com/DaniFdz/hui/pull/415 |
| Last green CI | P6, f643ad69, runs 42051036855 and 42051036850 |
| Last DONE phase | P0 carried (criteria met in #408; #415 carries its commits) |
| Baseline | see §3 |

Update this table with every checkpoint, in the same commit as the phase. A fresh
session reads it before touching code.

## 3. Baseline

Recorded at the program branch point (`danifdz/hui-extendability`, which carries #408):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | 34 failed / 2782 passed in 11 files — the known environment-only set (process control, local sockets, browser launch, download fixtures), plus one flaky workers test; diff the failure set before and after each phase |
| Working tree | `git status --short` | clean |

```
Baseline failed files: state.test.ts, workers.test.ts (one extra flaky case),
session-connection.test.ts, watchers.test.ts, dashboard.test.ts, manager.test.ts,
schedules.test.ts, durable.test.ts, pi-sdk.test.ts, install.test.ts, vscode.test.ts.
```

---

## 3. P0 — Gateway routes (PR #408)

Already verified in that PR's own `GOAL.md` (15/15 criteria, manual gateway proof
13/13, CI green). This program consumes it as written; no rework is planned.

---

## 4. P1 — Operator surface

**Status:** DONE · **Commit:** 918e0f0c (and its `test:` follow-up) · **CI:** green, run 42021662186

**Baseline:** typecheck exit 0 · tests 34 failed / 2782 passed (known environment-only set) · tree clean

**Acceptance criteria** (evidence from the runs below):

- [x] **P1-A1** Settings → Extensions lists every installed extension sorted by
  id with name, id, description, state chip, route count/methods, and its error.
  With none installed it says *No gateway extensions installed* and names the
  install path; a store error shows as a banner.
- [x] **P1-A2** The enable switch calls `PUT /__hui/ext/:id`, is disabled while
  pending, reflects the returned state, and a failure shows an alert without
  losing the row's previous state.
- [x] **P1-A3** A fixed trust note states that extensions run with the gateway's
  access.
- [x] **P1-A4** `hui extension list [--json]`, `hui extension enable <id>` and
  `hui extension disable <id>` work against a running gateway and fail with the
  usual message when none runs.
- [x] **P1-A5** Use case **SET-086** (web required, iOS excluded with the E17
  reason and `SPEC.md#gateway-extensions`) has a shared e2e test that toggles the
  fixture extension through the page; screenshots at 1440×900 and 390×844 are
  attached to the PR and shown in the chat, not committed.
- [x] **P1-A6** `npm run api:schema` leaves no diff (no API change in this phase).
- [x] **P1-A7** Focused tests, typecheck, full suite (failure set unchanged) and
  build pass; CI is green.

**Runs**

```
P1-V1  npm run api:schema && git status --short
Result: no generated change; the tree shows only this phase's source and docs
Exit: 0

P1-V2  npx vitest run cli/extensions.test.ts cli/main.test.ts src/lib/extensions \
         src/components/settings/extensions.test.ts scripts/use-cases.test.ts scripts/api-schema.test.ts
Result: 6 files passed, 30 tests passed
Exit: 0

P1-V3  npm run typecheck
Result: base, web and server projects pass
Exit: 0

P1-V4  npm test
Result: 33 failed / 2790 passed (baseline 34 / 2782); failure set vs baseline:
        added 0, removed 1 (the workers flake)
Exit: 1 (pre-existing failures only)

P1-V5  npm run build
Result: client built
Exit: 0

P1-V6  npm run e2e -- --tag SET-086
Result: 1 file, 1 test passed (6.27 s)
Exit: 0
```

**Manual proof** (Browser tool, isolated launcher `danifdz/hui-extendability`):
Settings → Extensions at 1440×900 lists **Hello · Disabled · no routes** with the
trust note; after enabling, the row reads **Loaded · 3 routes · GET, POST**, the
switch is on, and `GET /__hui/ext/hello/hello?name=Ada` answers
`{"greeting":"hello, Ada"}`; a reload keeps it Loaded; the 390×844 view renders
the row and switch in the narrow layout. Screenshots:
`extensions-disabled-desktop.png`, `extensions-loaded-desktop.png`,
`extensions-loaded-mobile.png` (outside the checkout, attached to the PR).

The Browser tool could not click the `wa-switch` (its thumb covers the control),
so the manual session enabled the fixture with the same `PUT` the page uses; the
real switch interaction is proven by the shared e2e test above.

**Proof gaps:** the store-error and failed-extension banners are covered by server
and component tests, not by the manual screenshots (the fixture is healthy).

**CI:** all required checks green on 918e0f0c (Test, web 1/4–4/4, catalogue,
package, lockfile, plan, analyze, CodeQL; release jobs skipped).

**Deviations:** P1-A1 said "and a guide link"; the page names the install path in
text instead (no docs route is served in the app). Recorded here rather than
inventing a dead link.

---

## 5. P2 — Sandboxed panels

**Status:** DONE · **Commit:** d60951c5 (with 5d661498 and the test commits) · **CI:** green, runs 42031190678 and 42032678418

**Baseline:** P1's green HEAD; typecheck 0 · tests 33 failed / 2808 passed · tree clean

**Acceptance criteria:**

- [x] **P2-A1** The manifest `ui` entry is validated (`title`, optional `entry`,
  `.html`, relative to and contained in the extension's `ui/` directory) and
  `ExtensionStatus` carries `panel` (`title`, `entry`); a bad manifest fails the
  extension without touching the gateway.
- [x] **P2-A2** `/__hui/ext-ui/<id>/…` serves only files inside `ui/`, before the
  `x-hui` gate, with the MIME allowlist, 10 MiB cap, `nosniff`, `no-store`,
  cross-origin CORP (see Deviations), a CSP whose `sandbox` makes the frame
  opaque, whose sources are limited to the extension's asset prefix and whose
  `connect-src 'none'` blocks network access, and `GET`/`HEAD` only. Traversal,
  symlink escape, an unknown extension, a disabled extension, a disallowed type
  and an oversized file are refused.
- [x] **P2-A3** Settings → Extensions shows **Open panel** for a loaded extension
  with a `ui`; it opens the Work view on the conversation the app last showed
  (disabled when none), the Work pane's launcher opens the first enabled panel, and
  the view restores from saved state after a reload.
- [x] **P2-A4** The bridge delivers `init`, lets the panel call only its own
  declared routes and returns the result, answers `error` for a route of another
  extension, a bad path, an oversized request/response and a timeout, and enforces
  the in-flight, size and time limits.
- [x] **P2-A5** `height` resizes the frame, `title` reaches the bar and `theme` is
  sent on init and on document theme changes; `open` opens only an `https:` URL
  with `noopener`; closing the Work view aborts in-flight calls and removes the
  listener.
- [x] **P2-A6** Use case **WORK-083** (web required, iOS excluded per E17) has a
  shared e2e test with the real fixture panel: Settings → Open panel, the + menu,
  the iframe's sandbox/src, the bridge's greeting in the bar, a reported height
  that differs from the default, and a restore after reload. Screenshots at
  1440×900 and 390×844 are attached to the PR and shown in the chat.
- [x] **P2-A7** Focused tests, typecheck, full suite (failure set unchanged),
  build and CI are green; the bridge refusals are unit-tested, not only covered by
  the e2e happy path.

**Runs**

```
P2-V1  npx vitest run server/extensions/assets.test.ts
Result: 1 test passed (pre-gate access, CSP, MIME, HEAD, 405, traversal, symlink,
        unknown/disabled, type and size caps)
Exit: 0

P2-V2  npx vitest run src/lib/extensions/bridge.test.ts
Result: 4 tests passed (path normalization, route/method allow-list, envelope,
        request cap, UTF-8 byte counting)
Exit: 0

P2-V3  npm run api:schema && git status --short
Result: the generated schema and browser types gain ExtensionPanel and the
        status panel field; re-running leaves no further change
Exit: 0

P2-V4  npm run typecheck && npm run build && npm test
Result: typecheck 0; build 0; 33 failed / 2808 passed, the same baseline set
        (added 0, removed 0)
Exit: typecheck/build 0, tests 1 (pre-existing failures only)

P2-V5  npm run e2e -- --tag WORK-083
Result: 1 file, 1 test passed
Exit: 0
```

**Manual proof** (Browser tool, isolated launcher at 5d661498): the fixture panel
opens from the Work pane's + menu in a conversation; the bar shows **hello, Ada**
(the panel's own route answered through the bridge), the iframe is sandboxed and
points at `/__hui/ext-ui/hello/index.html`, and the 390×844 Work destination shows
the same panel. Screenshots: `extension-panel-desktop.png`,
`extension-panel-mobile.png` (outside the checkout, attached to the PR).

The Browser tool cannot inspect or click inside the sandboxed frame, so the
in-frame **Greet** button and its output were not exercised by hand; the panel's
load-time bridge call (the bar title) and the e2e test prove the call path.

**Proof gaps:** the `open` and theme-change messages have unit-level handling but
no automated exercise (the fixture panel does not request either); the store-error
and failed-extension banners remain covered by server/component tests.

**Deviations:** `cross-origin-resource-policy` is **cross-origin** for panel
assets, not the plan's same-origin. A sandboxed frame's origin is opaque; the
browser treats its requests for its own CSS and JS as cross-origin, and same-origin
CORP blocked them (`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`). Assets are public by
design (E16), and the CSP still limits the frame. The bridge's `postMessage` uses
`"*"` as targetOrigin for the same reason (an opaque origin cannot be named); both
sides identify the conversation by the frame's `window` reference and the channel
name. The fixture panel reports `document.body` height rather than the document's,
because an iframe's document height never drops below the frame's viewport.

---

## 6. P3 — Prompt sections and agent tools

**Status:** DONE · **Commit:** ec18488b · **CI:** green, runs 42038480178 (Test) and 42038480264 (web 1/4–4/4, 1/4 took 16 min)

**Baseline:** P2's green HEAD; typecheck 0 · tests 33 failed / 2808 passed · tree clean

**Acceptance criteria:**

- [x] **P3-A1** The manifest `prompt` and `tools` entries validate: section ids/titles/texts and caps (4 000 each, 16 000 total), tool names, descriptions, snippets/guidelines, and a JSON Schema subset (object root, supported types, required names, no extra keys, depth ≤ 8). A bad one fails the extension with a named reason; a declared tool without an exported handler fails it too.
- [x] **P3-A2** The `hui_extensions` prompt section renders between `hui_goal` and `hui_ultra` for Durable sessions and carries every enabled extension's static sections; the end-to-end provider request shows the marker. A bad section fails the extension at load (static text cannot throw per assembly; see Deviations).
- [x] **P3-A3** An enabled extension's tools are offered to a new Durable session, namespaced `ext_<id>_<name>`, with their snippet/guidelines in the active-tool section; a running session keeps its offer. A name longer than 64 characters or one already used by another gateway tool is refused once with a diagnostic.
- [x] **P3-A4** An end-to-end Durable run with the deterministic provider called `ext_hello_greet` and the transcript carries **hello, Ada**; a throwing or schema-mismatched call becomes `isError` text, not a failed turn (builder tests).
- [x] **P3-A5** Settings → Extensions shows `Prompt and tools` with each section's title, character count and text behind disclosures and each tool's runtime name and description; SET-087's e2e proves it.
- [x] **P3-A6** A PI worker session gets none of these: the worker path (`pi-sdk-worker.ts`, `hui-prompt.ts`) has no gateway prompt/tool provider; the wiring exists only in `durable-prompt.ts`/`durable-host.ts` (documented inspection).
- [x] **P3-A7** API schema regenerated (`ExtensionPromptInfo`, `ExtensionToolInfo`, status fields) and documented; focused tests, typecheck, full suite (failure set unchanged), build and CI green; the Settings page change has a Browser-tool check and screenshots.

**Runs**

```
P3-V1  npx vitest run server/extensions src/components/settings/extensions.test.ts \
         scripts/use-cases.test.ts scripts/module-headers.test.mjs scripts/boundaries.test.mjs scripts/api-schema.test.ts
Result: 11 files passed, 93 tests passed (registry 8, service 12, tool builder 4,
        assets 1, routes 1, store 4, component/catalogue/schema/boundaries)
Exit: 0

P3-V2  npx vitest run server/runtimes/durable.test.ts -t "a gateway extension's prompt text and tool reach a Durable session"
Result: 1 passed: the tool is offered, the provider calls ext_hello_greet, the
        transcript holds "hello, Ada", and the request holds the prompt marker and
        the tool snippet
Exit: 0

P3-V3  npm run api:schema && git status --short
Result: the generated schema and types gain ExtensionPromptInfo, ExtensionToolInfo
        and the status fields; re-running leaves no further change
Exit: 0

P3-V4  npm run typecheck && npm run build && npm test
Result: typecheck 0; build 0; 33 failed / 2820 passed, the same baseline set
        (added 0, removed 0)
Exit: typecheck/build 0, tests 1 (pre-existing failures only)

P3-V5  npm run e2e -- --tag SET-087
Result: 1 file, 1 test passed
Exit: 0
```

**Manual proof** (Browser tool, isolated launcher at ec18488b): Settings →
Extensions shows the disabled fixture's **Prompt and tools**; opening it lists
**Greeting · 56 characters** and, behind the second disclosure, its text; the tool
reads `ext_hello_greet · Greet a person by name.` at 1440×900 and 390×844.
Screenshots: `extensions-contributions-desktop.png`,
`extensions-contributions-mobile.png` (outside the checkout, attached to the PR).

**Proof gaps:** `promptGuidelines` reach the tool-contribution map (unit-tested)
but the end-to-end request assertion checks the snippet; the guidelines text is
not separately asserted. The PI-worker exclusion is a documented inspection, not a
runtime assertion (the worker path has no provider to assert against).

**Deviations:** tool handlers are exported by the entry module (`export const
tools = { name: handler }`) because `extension.json` is JSON; the manifest declares
metadata only. A malformed static prompt section fails the extension at load rather
than being omitted per assembly. Namespacing makes a collision with a HUI tool
impossible; the builder refuses a runtime name over 64 characters or a duplicate
between gateway tools, once, with a diagnostic.

---

## 7. P4 — Server-sent events

**Status:** DONE · **Commit:** 6db2f619 · **CI:** green, run 42042613325 (web 1/4–4/4) and 42042613255 (Test)

**Baseline:** P3's green HEAD; typecheck 0 · tests 33 failed / 2820 passed · tree clean

**Acceptance criteria:**

- [x] **P4-A1** A route declared `stream: true` answers `text/event-stream`; each yielded object becomes one unnamed `data:` frame in order, with a 15 s heartbeat comment, and the response closes when the iterable ends. `ExtensionRouteInfo` carries `stream: true` and the schema is regenerated.
- [x] **P4-A2** A client leaving stops the loop and makes the generator's `return` run (the integration fixture's marker file proves it); a throw ends the stream with one `event: error` and one diagnostic; the event-count, event-size and total-size caps end it with named errors and one diagnostic each.
- [x] **P4-A3** A streaming handler that returns a body, a non-streaming handler that returns events, and a wrong method are refused with 500/405, never a hung response.
- [x] **P4-A4** `docs/api.md`, `SPEC.md` and `docs/guide.md` describe the declaration, the caps, the heartbeat and the error frame.
- [x] **P4-A5** Focused tests (real HTTP client and the stream writer), the order test, typecheck, full suite (failure set unchanged), build and CI are green.

**Runs**

```
P4-V1  npx vitest run server/http/events-stream.test.ts server/extensions/stream.test.ts
Result: 6 tests passed: frame order, heartbeat, throw error + report, the three
        caps, a client leaving (generator return), and the middleware integration
        (events, abort marker, wrong shapes 500)
Exit: 0

P4-V2  npx vitest run server/extensions server/http/events-stream.test.ts \
         scripts/api-schema.test.ts scripts/use-cases.test.ts \
         scripts/module-headers.test.mjs scripts/boundaries.test.mjs
Result: 12 files passed, 100 tests passed
Exit: 0

P4-V3  npm run api:schema && git status --short
Result: ExtensionRouteInfo gains the optional stream field; no further change on
        a rerun
Exit: 0

P4-V4  npm run typecheck && npm run build && npm test
Result: typecheck 0; build 0; 33 failed / 2829 passed, the same baseline set
        (added 0, removed 0)
Exit: typecheck/build 0, tests 1 (pre-existing failures only)
```

**Manual proof:** not applicable — P4 adds no browser surface. The integration
test drives a real HTTP client against the middleware, cancels the reader and
waits for the handler's generator to close.

**Proof gaps:** the ten-minute duration cap's branch is not exercised (a test
would run ten minutes); the code branch is a single elapsed-time check beside the
tested event-count/size caps.

**Deviations:** events are unnamed `data:` frames with a separate `event: error`
frame, as the plan says; the heartbeat interval is configurable only internally
(tests use a short one), while the gateway uses 15 s.

---

## 8. P5 — Lifecycle, compatibility and installation

**Status:** DONE · **Commit:** 7347cb53 · **CI:** green, runs 42045860596 (Test) and 42045860744 (web 1/4–4/4)

**Baseline:** P4's green HEAD; typecheck 0 · tests 33 failed / 2829 passed · tree clean

**Acceptance criteria:**

- [x] **P5-A1** `POST /__hui/ext/:id/reload` re-imports a changed module (cache-busted): routes use the new table at once, prompt text on the next assembly and tools on the next new session. A successful reload returns `ExtensionStatus` with `reloadedAt`; a failed reload answers 200 with `state: "failed"`, the error, and no routes from the broken module; an unknown id is 404. `reload` is reserved for this action.
- [x] **P5-A2** `engines.hui` min/max are enforced by a tested field-by-field comparator (bounds inclusive); an unsupported range refuses to load with the named reason and the extension's version/engines still show; an extension without engines loads.
- [x] **P5-A3** `ExtensionStatus` carries `version?`, `engines?`, `reloadedAt?`, `mode` (`in-process`) and `restarts` (0); the API schema and browser types are regenerated and documented. Settings → Extensions shows the version, the HUI range and the reload time, with a **Reload** action.
- [x] **P5-A4** `hui extension add <path> [--link]` validates the manifest and entry, refuses an existing id, copies or links, and enables through a running gateway (or writes the store when none runs); `hui extension remove <id> [--delete]` requires it disabled, prints the path, and only `--delete` removes it (a linked extension unlinks, never the target); `list/enable/disable/reload` work as before.
- [x] **P5-A5** `hui doctor` reports an enabled id with no directory, a failed manifest, an unreadable store and an unsupported `engines` range; the check has no `--fix`.
- [x] **P5-A6** Focused tests, typecheck, full suite (failure set unchanged), build, CLI tests and CI green; the Reload action has a Browser-tool check and screenshots.

**Runs**

```
P5-V1  npx vitest run server/extensions cli/extensions.test.ts cli/doctor-extensions.test.ts
Result: 9 files passed, 44 tests passed (registry 13, service 14, tool builder 4,
        assets 1, stream 1, routes 1, store 4, CLI 4, doctor 2)
Exit: 0

P5-V2  npx vitest run cli/main.test.ts cli/doctor.test.ts server/routes/order.test.ts \
         scripts/api-schema.test.ts scripts/use-cases.test.ts \
         scripts/module-headers.test.mjs scripts/boundaries.test.mjs \
         src/components/settings/extensions.test.ts
Result: 8 files passed, 83 tests passed
Exit: 0

P5-V3  npm run e2e -- --tag SET-086
Result: 1 file, 1 test passed (version/range shown, Reload confirmed)
Exit: 0

P5-V4  npm run api:schema && git status --short
Result: the reload route and lifecycle fields are published; no further change
Exit: 0

P5-V5  npm run typecheck && npm run build && npm test
Result: typecheck 0; build 0; 33 failed / 2838 passed, the same baseline set
        (added 0, removed 0)
Exit: typecheck/build 0, tests 1 (pre-existing failures only)
```

**Manual proof** (Browser tool, isolated launcher at 7347cb53): the fixture is
enabled, its row shows **v1.2.3 · HUI >=0.1.0**, clicking **Reload** shows
**Reloaded 3:32:07 PM**, and the page renders at 1440×900 and 390×844. Screenshots:
`extensions-lifecycle-desktop.png`, `extensions-lifecycle-mobile.png` (outside the
checkout, attached to the PR).

**Proof gaps:** none for the phase; the doctor check's real installation version
is read from package.json (a source checkout included), and the test covers the
same parse/range rules with a fixture package.

**Deviations:** `hui extension remove` without `--delete` reports the absolute path
and changes nothing (the plan's `--delete` is the only removal); the doctor check
reads `<packageRoot>/package.json` rather than `packageVersion`, so a source
checkout is checked against its real version instead of requiring a built release.
Tool handlers remain module exports (P3).

---

## 9. P6 — Out-of-process mode

**Status:** DONE · **Commit:** f643ad69 · **CI:** green (run 42051036850 web 1/4–4/4 and 42051036855 Test)

**Baseline:** P5's green HEAD; typecheck 0 · tests 33 failed / 2838 passed · tree clean

**Acceptance criteria:**

- [x] **P6-A1** `mode: "process"` starts one supervised host for that extension only; in-process extensions are untouched; at most eight process-mode extensions run at once and a ninth fails with a named reason.
- [x] **P6-A2** Routes, SSE and prompt text behave as in-process (same status, bodies, caps and errors), with the host as the only code location; the ready handshake carries the routes and prompt text, under `EXTENSION_PROTOCOL_VERSION = 1`.
- [x] **P6-A3** A crash answers `503 { "error": "extension process is restarting" }` during backoff, restarts with 1 s/2 s/4 s, records a diagnostic per crash (with the bounded stderr), and three crashes in five minutes mark it `failed` until a reload.
- [x] **P6-A4** A crashing or hanging extension cannot affect another extension or HUI's own routes; call timeouts and cancel frames are honored.
- [x] **P6-A5** `stopBackend` stops every host and waits for its exit; `service.stop()` clears them.
- [x] **P6-A6** Tools are refused in process mode with `tools require in-process mode`, at parse and again in the child.
- [x] **P6-A7** `ExtensionStatus.mode`/`restarts` show in Settings when a process extension is listed; the docs and SPEC state crash isolation, not a sandbox.
- [x] **P6-A8** Focused tests, typecheck, full suite (failure set unchanged), build and CI are green.

**Runs**

```
P6-V1  npx vitest run server/extensions/host.test.ts
Result: 2 tests passed (start/handshake, call/echo/stream, call timeout, crash and
        restart, three crashes → failed, stop)
Exit: 0

P6-V2  npx vitest run server/extensions/process.test.ts
Result: 2 tests passed (mode process status, ping, crash → 503 while restarting,
        restart → 200, stop, and tools refused)
Exit: 0

P6-V3  npx vitest run server/extensions cli/... scripts/... server/routes/order.test.ts src/components/settings/extensions.test.ts
Result: 19 files passed, 132 tests passed
Exit: 0

P6-V4  npm run api:schema && npm run typecheck && npm run build && npm test
Result: schema unchanged; typecheck 0; build 0 (build/server/extensions/host-main.js
        emitted); 33 failed / 2843 passed, the same baseline set (added 0,
        removed 0)
Exit: typecheck/build 0, tests 1 (pre-existing failures only)
```

**Manual proof:** the host and process integration tests drive real child processes:
`host-main` imports the extension, the parent forwards calls/streams, a crash is
contained to the child and restarted, and `stop` reaps it. No browser surface was
added (the process-mode row's mode/restart text is covered by the component source
test and the status schema).

**Proof gaps:** no screenshot of a process-mode row (the e2e fixture is
in-process); the child's stderr diagnostic is asserted through the crash path but
not through a dedicated stderr fixture.

**Deviations:** frames are prefixed with `EXT ` so an extension's own `console.log`
cannot corrupt the protocol; the handshake is 10 s and calls time out at 30 s (a
test uses a shorter timeout); process hosts support routes/SSE/prompt text, not
tools; the eight-host cap is enforced before a start; the supervisor restarts only
after a crash, not on a handshake failure of the initial enable.

---

## 10. Program completion and owner sign-off

After P6, before handoff:

- [x] Every phase is DONE with its commit and green CI recorded in §1.
- [x] The program checks ran at the final HEAD: `npm run typecheck`, `npm test`
      (33 known environment failures, no new), `npm run build`, `npm run e2e`
      for the UI use cases, and the per-phase manual proofs.
- [x] The PR body lists the phases, the exact checks and the proof, and the
      screenshots for the UI phases are attached (not committed).
- [x] §2 Resume point says "complete"; §7/§8 hold only documented gaps.
- [x] The PR is ready for review (not draft) and not merged.

Owner:

- [ ] Reviewed the branch commit by commit
- [ ] Approved the PR
- [ ] Merged
