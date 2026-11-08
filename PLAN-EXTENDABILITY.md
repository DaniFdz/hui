# PLAN — Full harness extendability

Program plan for making HUI's gateway a first-class extension host, not just a
route seam. It follows phase 0 — the JSON routes, enable store, status/toggle API
and documentation in PR #408 (its `PLAN.md` / `GOAL.md` live on that branch).

The owner runs the whole program as **one long-running goal**: one branch, **one
pull request for every phase**, and each phase as a checkpoint of commits inside
it. There is no per-phase PR, no second program PR and no follow-up PR. Phase 0
already exists as PR #408 and is this branch's base, not another program PR; the
program PR carries its commits until #408 merges. Every decision this program needs
is made below; do not reopen them. Record each phase's evidence in
[GOAL-EXTENDABILITY.md](GOAL-EXTENDABILITY.md), which is the source of truth for
resuming after an interruption.

Suggested goal:

> Implement all phases of PLAN-EXTENDABILITY.md; verify through GOAL-EXTENDABILITY.md.

## 1. Target

A trusted local extension — a directory under `$XDG_CONFIG_HOME/hui/extensions/<id>/` —
can add to HUI:

1. JSON routes on the gateway (shipped: phase 0).
2. A sandboxed panel in the Work pane that talks only through HUI's bridge.
3. Static prompt sections and in-process agent tools for Durable sessions.
4. Server-sent event streams on its own routes.
5. An explicit reload, a compatibility range, install/remove lifecycle and doctor
   reporting.
6. Opt-in out-of-process execution for crash isolation (routes, streams and prompt
   text only).

Plus the operator surface for all of it: a Settings page, `hui extension` CLI
commands, documentation and diagnostics.

## 2. What "full" means — and what it never means

| Capability | Phase 0 (#408) | This program | Phase |
|---|---|---|---|
| JSON routes on `/__hui/ext/<id>/…` | yes | stays | 0 |
| Settings → Extensions page, enable/disable | no | yes | P1 |
| `hui extension list/enable/disable` | no | yes | P1 |
| Sandboxed panel in the Work pane | no | yes | P2 |
| Extension assets under `/__hui/ext-ui/<id>/…` | no | yes | P2 |
| PostMessage bridge (calls limited to the extension's routes) | no | yes | P2 |
| Static prompt sections (Durable) | no | yes | P3 |
| In-process agent tools (Durable) | no | yes | P3 |
| Server-sent events on extension routes | no | yes | P4 |
| Explicit reload, `engines.hui`, doctor, install/remove CLI | no | yes | P5 |
| Opt-in out-of-process mode (crash isolation) | no | yes | P6 |
| WebSocket extension routes | no | **never** | — |
| HTML/files served from HUI's own origin | no | **never** | — |
| Per-extension types inside HUI's browser bundle | no | **never** | — |
| Runtime adapter plugins | no | **never** | — |
| Marketplace / remote registry | no | **never** | — |
| Approval or permission prompts | no | **never** | — |

"Never" items are decisions, not omissions:

- **WebSocket** would need a ticket flow, an upgrade multiplexer and its own auth
  story; SSE covers one-way streaming and panels call routes over HTTP.
- **HUI-origin HTML/files** would let extension markup run on HUI's origin, where
  the browser can send `x-hui`. All extension markup is served from the asset
  prefix inside a sandboxed frame instead.
- **Browser-bundle types** are generated at build time; extension code is runtime
  code. Panels ship their own code and types; HUI publishes schemas, not modules.
- **Runtime adapters** own session lifecycle, persistence and migrations. They stay
  a core change with their own product decision (see `server/runtimes/types.ts`).
- **Marketplace** is a supply-chain product with its own trust model. Installation
  is local: a path on disk, then an explicit enable.
- **Approvals** contradict HUI's agreed Full Access posture (`AGENTS.md`). Installing
  an extension is the trust decision, and the docs say so plainly.

## 3. Locked decisions

| # | Decision |
|---|---|
| E1 | **Exactly one program PR**: one branch, one pull request for P1–P6, and one commit series per phase. No per-phase PR, no second program PR, no follow-up PR. The branch starts from `main` when #408 is merged, or carries #408's commits until it merges (E23); either way there is one program PR. Nothing is merged mid-program. |
| E2 | Extension UI is a **sandboxed iframe** rendered in the Work pane; assets are served pre-gate from `/__hui/ext-ui/<id>/…`, never `/__hui/ext/…`. |
| E3 | The CSP `sandbox allow-scripts allow-forms` makes the frame an opaque origin; `connect-src 'none'` means the frame **cannot** call HUI, and every source is limited to that extension's own `/__hui/ext-ui/<id>/` prefix. Everything goes through the parent bridge. |
| E4 | The bridge forwards only `method + path` pairs that the panel's own extension declared and that are active now, always prefixed with `/__hui/ext/<id>/`. It adds no HUI service handles and no extra headers. The parent rejects empty, `.` or `..` segments and encodes each segment itself, so a crafted path cannot leave the extension's namespace. |
| E5 | Bridge limits: 64 KiB request, 256 KiB response, 20 in-flight calls, 30 s per call, JSON only. The parent answers `error` on any violation. |
| E6 | A panel receives `{ extensionId, sessionId, theme, locale }` in one `init` message. The session id is informational: an extension that needs it passes it in its own query or body. |
| E7 | Prompt sections and tools are **Durable-only**. Sessions on the old PI worker keep their PI extensions and get no gateway-extension contributions (documented, with the SPEC anchor). |
| E8 | Prompt contributions are static text loaded from the manifest, at most 4 000 characters each and 16 000 in total per extension, rendered under one `extensions` section between `hui_goal` and `hui_ultra`. |
| E9 | Tools run in-process, get `{ args, conversationId, signal }`, return text or content blocks, and never receive a bridge token or a HUI service object. A throw becomes an `isError` result plus one diagnostic. |
| E10 | Streaming is SSE only: a route declares `stream: true`; the handler returns an async iterable of JSON objects. Caps: 10 minutes, 5 000 events, 256 KiB per event, 5 MiB total. |
| E11 | Reload is explicit (`POST /__hui/ext/:id/reload`), cache-busts that module, and has no file watcher. A failed reload withdraws the routes and marks the extension `failed`. |
| E12 | Compatibility is `apiVersion: 1` plus an optional `engines: { hui: { min?: string, max?: string } }` of dotted numeric versions. A version outside the range refuses to load with a named reason. No `semver` dependency; a small tested comparator is added. |
| E13 | Out-of-process mode is `mode: "process"`, one host process per extension, JSON-lines RPC modelled on `server/worker/protocol.ts`. Restart backoff 1 s, 2 s, 4 s; three crashes in five minutes marks it `failed`. Requests during restart answer 503. |
| E14 | Process mode supports routes, SSE and prompt text. It does **not** support tools (they are in-process only). |
| E15 | Process mode is crash isolation, not a security sandbox: the host runs as the same user with the same filesystem access. Docs and SPEC say so; no capability prompt is implied. |
| E16 | Extension assets are public to anyone who can reach the gateway (served before the `x-hui` gate, like the widget sandbox). They must contain no secrets; this is documented and tested. |
| E17 | New extension UI use cases are `web` required and `ios` excluded, with the decision anchor `SPEC.md#extendability` (the iPhone app has no extension surface in this version). Shared tests declare `platforms: ["web"]`. |
| E18 | No new dependencies in any phase. Version comparison, CSP construction and RPC framing are small in-repo helpers with tests. |
| E19 | Every phase updates `docs/api.md`, `SPEC.md`, `docs/guide.md`, `docs/map.md`, the catalogue and `GOAL-EXTENDABILITY.md` in the same PR. A later phase that changes an existing page updates that page's use case and test as well. Every new module gets its header comment. |
| E20 | The existing trust posture holds: extensions are trusted local code with the gateway's access; no sandbox, no approval prompt, no per-extension quota beyond the stated caps. |
| E21 | Phase checkpoints: after a phase's code and tests, update the ledger, commit, push, wait for the required CI jobs on that HEAD, and only then start the next phase. A red required check stops the program until it is fixed or recorded as a proof gap with evidence; the next phase never starts on top of a red HEAD. |
| E22 | Resumption: the ledger is the source of truth. After an interruption or context loss, read the ledger, `git log` and `git status` first, resume at the phase marked IN PROGRESS or at the first NOT STARTED phase after the last DONE one, and never redo a completed phase. |
| E23 | The single program PR carries phase 0's commits (from `danifdz/gateway-extensions`) and the plan documents (from `danifdz/extendability-plan`), then every phase. Open it from those branches if they are unmerged; once it is open, close PR #408 and PR #412 as superseded so exactly one PR remains, and rebase the unreviewed draft onto `main` when they merge. Never force-push after the PR is marked ready. Before each phase, check the PR for unresolved review comments and address them first. If the program PR is merged before P6, mark the remaining phases NOT DONE, stop, and do **not** open another PR. |
| E24 | A phase that cannot complete after two focused attempts at the same failing check is marked BLOCKED in the ledger with the exact error and evidence, and the session stops. Dependent phases are not started; independent ones (P4 does not depend on P2/P3) may continue only if the ledger says so explicitly. |

## 4. Where we are

**P0 — shipped in PR #408** (`danifdz/gateway-extensions`, open): `/__hui/ext`,
`/__hui/ext/:id`, `/__hui/ext/<id>/…`, `extensions.json`, manifest validation,
diagnostics, docs, tests. Preferred start: merge it, then branch from that `main`.
If the goal starts before it merges, E23 stacks the program branch on #408 and
rebases it once #408 merges. P1's checkpoint updates P0's row to MERGED with the
merge commit.

Until #408 is merged, no phase below starts. If the owner sets a phase goal while
#408 is still open, the implementer says so and stops.

## 5. Phases

Each phase is one PR. "Files" lists the owning modules; the implementer may add
what the work needs but must not move a contract into an unrelated area.

### P1 — Operator surface

**Objective.** An operator can see, enable and disable installed extensions without
HTTP, from the browser and the CLI.

**Contract.**

- Settings page `extensions` at `/settings/extensions`, label **Extensions**, group
  **Extensions**. It lists every installed extension sorted by id: name, id,
  description, state chip (`Loaded`, `Disabled`, `Failed`, `Missing`), its route
  count and methods, the error text when failed, and an enable switch. A store
  error is a banner above the list; an empty install says *No gateway extensions
  installed* with a link to the guide. A permanent trust note states that extensions
  run with the gateway's access.
- The switch calls `PUT /__hui/ext/:id`, disables itself while pending, and shows
  the returned state; a failure shows the error and re-reads the list.
- `hui extension list [--json]`, `hui extension enable <id>`, `hui extension disable <id>`
  talk to the running gateway through `cli/gateway-client.ts`; with no gateway they
  fail with the same message the other gateway commands use.
- No API schema changes.

**Files.** `src/api/extensions.ts` (new: `fetchExtensions`, `setExtensionEnabled`),
`src/controllers/extensions-controller.ts` (new: load, retry, toggle, busy state),
`src/views/settings-extensions.ts` (new), `src/lib/settings/pages.ts`,
`src/lib/navigation.ts`, `src/views/settings.ts`, `src/hui-app.ts`,
`cli/extensions.ts` (new), `cli/main.ts`, `cli/commands.ts` (flags and HELP),
`docs/guide.md`, `SPEC.md` (`## Extendability`, a screen subsection), `docs/map.md`.

**Tests.** Controller tests (load, error, toggle, race: a second toggle while one is
in flight); CLI tests with a fake gateway client (list/enable/disable, 404);
`e2e/tests/set/extensions.e2e.ts` toggling the fixture extension and reading the
state; the launcher (`e2e/visual-verification.mjs`) installs
`e2e/fixtures/extensions/hello` **disabled** so the page has a subject.

**Verification.** Catalogue entry `SET-NNN` (web required, iOS excluded per E17);
`npm run e2e` on web; Browser-tool run through the real page at desktop 1440×900 and
mobile 390×844 with screenshots for the PR and the chat; focused tests, typecheck,
full suite (baseline-diffed), build.

### P2 — Sandboxed panels

**Objective.** An enabled extension with a `ui` entry shows a working panel in the
Work pane, and that panel can call its own routes without ever running on HUI's
origin.

**Contract.**

- Manifest adds `ui: { title: string, entry?: string }`: `entry` is relative to the
  extension's `ui/` directory, defaults to `index.html`, must be `.html` and stay
  inside `ui/`. No `ui` means no panel. `ExtensionStatus` gains
  `panel?: { title: string, entry: string }` so the browser knows what to open.
- Assets are served **before** the `x-hui` gate at `/__hui/ext-ui/<id>/<path>`,
  mapping to `<extension>/ui/<path>`: containment by `realpath` (inside `ui/`), MIME allowlist (`html`, `js`, `mjs`, `css`, `json`,
  `svg`, `png`, `webp`, `jpg`, `woff2`), 10 MiB per file, `no-store`, `nosniff`,
  `cross-origin-resource-policy: same-origin`, `GET`/`HEAD` only (every other
  method 405), and a per-request CSP built like the widget sandbox's
  (`default-src 'none'`, `script-src <origin>/__hui/ext-ui/<id>/ 'unsafe-inline'`,
  `style-src <origin>/__hui/ext-ui/<id>/ 'unsafe-inline'`,
  `img-src <origin>/__hui/ext-ui/<id>/ data: blob:`,
  `font-src <origin>/__hui/ext-ui/<id>/ data:`, `connect-src 'none'`,
  `frame-ancestors 'self'`, `sandbox allow-scripts allow-forms`, `base-uri 'none'`,
  `form-action 'none'`), where `<origin>` is the request's own scheme, host and
  port and nothing else (E3, E16). Every asset response carries that CSP, so an
  HTML or SVG opened directly (not in a frame) is also opaque and network-less.
  `permissions-policy`, `referrer-policy: no-referrer` and
  `x-content-type-options: nosniff` match the widget sandbox. No directory listing.
- The Work pane gains `{ kind: "extension", id }` (restorable from its saved
  state); Settings → Extensions gains **Open panel** on an enabled extension with
  a `ui`, which opens that Work view on the conversation the app last showed and is
  disabled with *Open a conversation first* when there is none. The view renders
  one iframe with `sandbox="allow-scripts allow-forms"`,
  `referrerpolicy="no-referrer"`, `src` under `/__hui/ext-ui/<id>/<entry>`. A
  launcher entry in the Work pane's “+” menu is a later enhancement, not part of
  this phase.
- Bridge (E4–E6): `init` (extensionId, sessionId, theme, locale), `ready`, `call`
  (`callId`, `method`, `path`, `body`), `result` (`status`, `body`), `error`,
  `height`, `theme` on theme change, `open` for an `https:` link opened with
  `noopener`. The parent validates `event.source === iframe.contentWindow` and
  the call against the extension's active routes; it performs the `fetch` with
  `x-hui: 1` and its own origin. Unknown call ids, oversized messages, timeouts and
  routes of another extension answer `error` and record one diagnostic.
- The panel is torn down with its Work view; no listener survives.

**Files.** `server/extensions/assets.ts` (new: containment, MIME, CSP, size),
`server/extensions/registry.ts` (the `ui` manifest field),
`server/extensions/service.ts` (the panel entry in the status),
`server/api/extensions.ts` (the `panel` field), `server/hui.ts` (pre-gate branch),
`src/components/extension-frame.ts` (new: iframe + bridge),
`src/views/work/extension.ts` (new), `src/views/settings-extensions.ts` (Open
panel), `src/hui-app.ts` (the open-panel action), `src/lib/work-pane.ts`,
`src/controllers/work-layout-controller.ts`, `docs/map.md`, `docs/api.md` (the
asset prefix and the `panel` field), `SPEC.md`.

**Tests.** Asset containment (`../`, symlink escape, absolute path), MIME
allowlist, size cap, pre-gate access, CSP contents, `nosniff`; registry `ui`
validation; bridge unit tests with a fake `postMessage` window (init, allowed call,
foreign-extension call refused, `../other/...` refused, oversized message, timeout,
theme, open); integration test through `middleware`; `e2e/fixtures/extensions/hello/ui/index.html`
(new) with a real panel that greets by name from its own route and resizes;
screenshots.

**Verification.** Catalogue entry `WORK-NNN` (web required, iOS excluded per E17);
`npm run e2e`; Browser-tool run at desktop and mobile; the bridge refusals exercised
by the e2e fixture; focused tests, typecheck, full suite, build.

### P3 — Agent contributions

**Objective.** An enabled extension adds a prompt section and a tool to new Durable
sessions, with visible provenance and contained failure.

**Contract.**

- Manifest adds `prompt: [{ id, title, text }]` and `tools: [{ name, description,
  parameters, promptSnippet?, promptGuidelines?, handle }]`. `name` matches
  `^[a-z][a-z0-9_]{0,47}$` (the `ext_<id>_` prefix keeps the runtime name within 64
  characters). `parameters` is a JSON
  Schema object (object at the root; string, number, integer, boolean, array, enum
  and required properties; no `$ref`; depth at most 8). HUI validates that shape and
  hands it to the runtime unchanged — no TypeBox dependency reaches extension code;
  if the runtime rejects a plain schema, the same subset is converted with TypeBox
  builders inside HUI. `handle(args, context)` is a function exported by the module
  (E9).
- Prompt: `DurablePrompt` gains one `extensions` section rendered between
  `hui_goal` and `hui_ultra`: for each enabled extension, a heading with its name
  and id, then its sections' texts, capped per E8. A throwing or empty contribution
  is omitted and recorded once per assembly; it never fails the turn.
- Tools: an enabled extension's tools join the conversation's offer when it starts
  (a new session, not a running one), with a `Contribution` carrying `promptSnippet`
  and `promptGuidelines`. Names are namespaced `ext_<id>_<tool>`; a collision with a
  HUI tool refuses that extension's tool with a diagnostic. Calls validate arguments
  against the schema; a throw or invalid result becomes `isError` text plus one
  diagnostic, never a failed turn.
- Settings → Extensions shows each enabled extension's sections (title and a
  character count, with the text behind a disclosure) and tools (name and
  description).
- **Not offered** to PI worker sessions (E7); a bot's chat keeps its own PI tool
  policy.

**Files.** `server/extensions/registry.ts` (manifest fields and namespacing),
`server/extensions/agent.ts` (new: prompt text and tool definitions),
`server/runtimes/durable-prompt.ts` (the `extensions` section),
`server/runtimes/durable.ts` (`applyTools`), `server/runtimes/durable-host.ts`
(contribution wiring), `server/api/extensions.ts` (prompt/tool metadata in
`ExtensionStatus`), `src/views/settings-extensions.ts`, docs/SPEC/map.

**Tests.** Prompt assembly (enabled/disabled/ordering/caps/throwing section);
namespacing and collision; tool offer at session start, where a running session
keeps its offer; schema validation; an end-to-end Durable test with the
deterministic provider where the model calls an extension tool and the answer
returns; a failed tool call keeps the turn; disabling affects the next session.

**Verification.** API schema regenerated and documented; focused tests; the
Durable end-to-end proof; typecheck, full suite, build; a browser check of the
Settings disclosures with screenshots (the page changed again).

### P4 — Server-sent events

**Objective.** An extension route can stream a sequence of JSON events to the
browser.

**Contract.**

- A route declares `stream: true`; its handler returns `{ events: AsyncIterable<Record<string, unknown>> }`
  (no `status`, no `body`). `ExtensionRouteInfo` gains `stream?: boolean`, so the
  schema is regenerated and the status page can mark a stream.
- The route answers `text/event-stream` with one unnamed `data:` event per object,
  a 15 s heartbeat comment, and the E10 caps. The client disconnecting aborts the
  iterable through `signal`. A throw ends the stream with `event: error`, data
  `{ error: "extension failed" }`, and one diagnostic. Caps exceeded end the same
  way with a named error.
- Non-streaming routes keep the phase-0 contract; a streaming handler on a
  non-streaming route is a 500; a non-iterable result on a streaming route is a 500.
- `HEAD` of a streaming route is 405 like every other method mismatch.

**Files.** `server/http/route.ts` (a new `RouteResult` variant for event streams),
`server/hui.ts` (write it with heartbeat and close handling),
`server/extensions/registry.ts` + `service.ts` (declaration, validation, invocation),
`docs/api.md`, `SPEC.md`.

**Tests.** Real HTTP client: ordering, heartbeat presence, client abort ends the
iterator, throw path, caps, wrong-handler paths, order test. No UI.

### P5 — Lifecycle, compatibility and installation

**Objective.** Extensions can be reloaded, versioned, installed and removed, and a
broken one is reported.

**Contract.**

- `POST /__hui/ext/:id/reload` cache-busts and re-imports that module, rebuilding
  its routes and prompt text; plain routes and panels use the new table at once,
  prompt text on the next assembly and tools at the next new session (E11). Success
  answers `ExtensionStatus`
  (`reloadedAt` present); failure answers 200 with `state: "failed"` and the error,
  as the enable toggle does.
- `ExtensionStatus` gains `version?`, `engines?` (`{ min?, max? }`), `reloadedAt?`,
  `mode` (`"in-process"` for now, `"process"` from P6) and `restarts` (0 until P6).
- The manifest accepts optional `version` (dotted numeric) and `engines.hui`
  (E12); the comparator is a tested helper. Ranges are `min`/`max` dotted numeric
  versions compared field by field; a prerelease or wildcard is rejected as an
  unsupported range rather than guessed.
- `GET /__hui/ext` and the Settings page gain a **Reload** action, disabled while
  the extension is off or busy.
- `hui extension add <path> [--link]` validates the manifest, refuses an existing
  id, copies (or symlinks with `--link`) into the extensions directory and enables
  it through the running gateway; with no gateway, it writes the store and says the
  change applies at next start. `hui extension remove <id> [--delete]` requires the
  extension to be disabled; `--delete` removes its directory only after confirming
  it is a direct child of the extensions directory and printing its absolute path.
  A `--link` install is a symlink: `--delete` unlinks the symlink itself and never
  the target.
- `hui doctor` gains an `extensions` check: an enabled id with no directory, a
  failed manifest/import, or an unsupported `engines` range is an issue with its
  reason. It has no `--fix` (HUI cannot repair or delete operator code).
- `extensions.json` keeps `version: 1`; no migration.

**Files.** `server/extensions/registry.ts` (versions, engines, comparator),
`server/extensions/service.ts` (reload, status fields), `server/routes/extensions.ts`,
`server/api/extensions.ts`, `server/hui.ts` (no change beyond the route),
`cli/extensions.ts`, `cli/main.ts`, `cli/commands.ts`, `cli/doctor.ts` +
`cli/doctor-extensions.ts`, docs/SPEC/map.

**Tests.** Reload success (module changed on disk) and failure (broken reload
withdraws routes); engines accept/reject; comparators; status fields; CLI add
(copy/link/refuse existing), remove (disabled only, `--delete`), list; doctor
issues; order test; schema regeneration.

### P6 — Out-of-process mode

**Objective.** An extension can run in its own process so a crash cannot take the
gateway with it, with route behaviour and streaming unchanged.

**Contract.**

- Manifest adds `mode?: "in-process" | "process"` (default `in-process`).
- One host child per process-mode extension, started on enable/reload, supervised
  with E13. The host imports the module, validates its routes, and answers
  `call`/`stream` frames; prompt text travels once at start (E14). Tools are
  refused with a named reason. A start that does not handshake in 10 s is failed.
- Frames are newline-delimited JSON under `EXTENSION_PROTOCOL_VERSION = 1` with a
  start handshake (extension id, apiVersion, protocol version); a mismatch refuses
  to load with a named reason. Frames carry an `EXT ` prefix on a dedicated line so
  an extension's own `console.log` cannot corrupt the protocol; unmatched stdout
  lines go to a bounded log. Frame size is capped, every call has a timeout and an
  abort frame, at most eight process-mode extensions may run at once (enabling a
  ninth fails with a named reason), and each host's stderr is captured into one
  bounded diagnostic per start. The 64 KiB request / 256 KiB response caps apply at
  the host boundary too.
- Crash: the extension's routes answer 503 `{ "error": "extension process is
  restarting" }` during backoff; a diagnostic records each crash and each restart.
  After three crashes in five minutes the state is `failed` until a reload.
- Shutdown: `stopBackend` and gateway shutdown kill the hosts and wait for exit.
- The `ExtensionStatus.mode` reports `"process"` and `restarts` its count. The
  Settings page shows them; no new page.

**Files.** `server/extensions/host.ts` (new supervisor), `server/extensions/host-main.ts`
(new child entry), `server/extensions/protocol.ts` (new frames), `service.ts`
(delegation), `registry.ts` (mode), `backend.ts` (stop), `api/extensions.ts`,
`src/views/settings-extensions.ts`, docs/SPEC/map.

**Tests.** Fixture host that answers, crashes, hangs and streams; restart/backoff
and the three-crash limit; crash isolation (another extension keeps answering);
timeouts and aborts; prompt text delivered; tools refused; shutdown reaps
processes; frame caps. No UI beyond the status line (checked in the existing page
test).

## 6. Verification model

Every phase checkpoint runs and records, in `GOAL-EXTENDABILITY.md`:

1. `npm run api:schema` — no diff after the commit (or the intended diff, listed).
2. Focused tests for the phase's files.
3. `npm run typecheck`, `npm test`, `npm run build`. The 33 pre-existing
   environment-only failures in this checkout are baseline-diffed: the failure set
   must not grow. A run in CI (`test` job) is the authoritative full-suite result.
4. A manual proof against a real isolated gateway
   (`e2e/visual-verification.mjs launch …`): a Node `fetch` transcript for headless
   phases, the Browser tool for UI phases. Keep artifacts outside the checkout.
5. UI phases: `npm run e2e` (web), screenshots at 1440×900 and 390×844 in the PR
   and the chat, and the catalogue entry. iOS is excluded per E17 and the PR says
   so.
6. CI green on the PR HEAD; the PR stays open for the owner.

The goal's evidence is the ledger, not the PR body alone: a criterion is checked
only with the command's real output pasted under its run.

## 7. Program branch, checkpoints and goals

**One PR, not several.** Branch `danifdz/hui-extendability` from the merged `main`
when #408 has landed; if it has not, branch from `danifdz/gateway-extensions` and
carry its commits, then cherry-pick the plan-document commits from
`danifdz/extendability-plan` (E23). Open exactly one **draft** PR titled
`feat: extend the gateway into a full extension host` and put the phase checklist
in its body. Once it is open, close PR #408 and PR #412 as superseded — their
commits are in it — so exactly one PR is open for the whole work. Every phase is
committed to this branch and this PR. Nothing is merged during the program, and no
second program PR is ever opened.

**Each phase is a checkpoint, not a merge.**

1. Check the PR for unresolved review comments; address those first.
2. Implement the phase, keeping `PLAN-EXTENDABILITY.md` unchanged.
3. Run the phase's runs locally; paste the evidence into the ledger.
4. Commit the code and the ledger together with the phase's Conventional Commit
   message (`feat(gateway): …`). One phase may span several commits.
5. Push and wait for the required CI jobs on that HEAD. Fix and repeat until
   green; unrelated infrastructure failures are recorded as proof gaps and retried
   once before blocking. While #408 is unmerged, this is also the moment to rebase
   the draft onto the new `main` if it just landed (E23).
6. Mark the phase DONE with its CI run and commit in the next push (usually the next
   phase's commit). Only then start the next phase.

**The end.** After P6: run the program-level checks in §6, mark the PR ready, fill
its body with the phase results and the proof, and hand it to the owner. The owner
reviews the whole branch commit by commit and merges once.

**Late review.** If the owner leaves review comments while the session runs, the
next phase's step 1 addresses them. If the branch is merged before P6, the program
ends there: the ledger records the remaining phases as NOT DONE and no other PR is
opened (E23).

**Never:** merge, force-push over reviewed commits, rewrite history after a phase
is marked DONE, or start a phase with the previous phase's required checks red.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A panel escapes the sandbox and acts as HUI's origin | CSP `sandbox` + `connect-src 'none'` + pre-gate assets; the bridge is the only channel and only forwards declared routes (E3, E4) |
| Extension assets leak something | Assets are public by decision (E16); docs say no secrets; tests assert pre-gate access and CSP |
| Prompt sections inflate every request | Per-extension and total caps (E8); one section key; the ledger measures a long-chat request in P3 |
| Tools become a privilege path | In-process only, no bridge token, no service handles, `isError` containment, namespaced names (E9) |
| Reload breaks a working extension | Explicit reload only; failure marks it failed and withdraws routes, never half-registers (E11) |
| Process mode is mistaken for a security boundary | Docs, SPEC and the Settings note state crash isolation only (E15) |
| Extension surfaces multiply the catalogue debt | Each UI phase adds exactly one use case and one shared test; iOS excluded once with an anchor (E17) |
| A very large PR is hard to review | One branch and one PR by request, but a commit series per phase and a ledger with per-phase evidence; the owner can review commit by commit |
| A long session loses context or is interrupted | The ledger records resume state after every phase (E22); commits and CI runs are the checkpoints |
| CI minutes pile up | One push per phase plus the fixes it needs; the ledger marks each run on the single PR |

## 9. Effort (judgment, not measured)

| Phase | Rough effort |
|---|---|
| P1 operator surface | 3–5 days |
| P2 sandboxed panels | 2–3 weeks |
| P3 agent contributions | 2–3 weeks |
| P4 server-sent events | 4–6 days |
| P5 lifecycle and installation | 1–2 weeks |
| P6 out-of-process mode | 3–5 weeks |

Total: roughly 9–15 focused weeks of work, executed in one long-running goal
with a checkpoint per phase. The numbers size the scope; they are not a
commitment.

## 10. P7 — page extensions

The follow-up program turns Contributions, Dashboard and Kanban into bundled
extensions. Its detailed plan and P7 acceptance criteria live in
[PLAN-PAGE-EXTENSIONS.md](PLAN-PAGE-EXTENSIONS.md); P7 is the foundation only:

- a sandboxed page contribution (`ui.page`, `/ext/<id>`, sidebar entry, page
  bridge with an allowlisted conversation `navigate`);
- a read-only `context.hui` facade (GitHub contributions first);
- a fixture page and its shared e2e test; the native pages stay untouched.

The Contributions port is P8. Packaged/default-on/eject and the process-mode
context proxy move with P8 because they need a real shipped page.
