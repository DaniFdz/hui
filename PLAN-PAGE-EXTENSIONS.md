# Page extensions: the plan

Turn three native HUI pages into extensions that ship with HUI, are enabled by
default, can be disabled, and can be edited by an operator:

1. **Contributions** first (read-only GitHub activity and session calendar).
2. **Dashboard** (sessions and host metrics).
3. **Kanban** (backlog reads and writes, drag-and-drop).

This is a port, not a file move. The native pages read HUI's own state and render
Lit components; an extension page needs a safe page slot and a gateway context
first.

## Decisions

- **Sandboxed pages.** Pages are ordinary HTML/CSS/JS in an opaque-origin frame,
  like today's panels, with a typed bridge for theme, height, links, navigation
  and the extension's own routes. Edited or third-party code never shares HUI's
  origin, DOM, `x-hui` token or gateway access.
- **Contributions is the first port.** It proves a read-only page, the GitHub
  context and the session-calendar bridge without writes.
- **Installed and enabled by default.** A bundled page extension replaces the
  native page once it reaches parity. The operator can disable it in Settings;
  the page then disappears, like any extension surface.
- **Editable through an ejected copy.** `hui extension eject <id>` copies the
  packaged source into the config directory. A user extension with the same id
  shadows the packaged one; `hui doctor` reports a stale or conflicting copy.
- **No trusted Lit tier.** Native fidelity is not worth executing user-edited
  modules in HUI's origin. If a bundled-only trusted tier is ever needed, it is a
  later, signed-only decision.

## New contracts

### `ui.page`

```json
"ui": {
  "title": "Contributions",
  "icon": "github",
  "page": { "title": "Contributions", "entry": "page.html", "icon": "pull-request" }
}
```

- `page.entry` is a relative `.html` file inside `ui/`, served from
  `/__hui/ext-ui/<id>/` before the `x-hui` gate.
- `page.title` is the sidebar label and document title; `page.icon` uses the same
  named set as panels.
- The page route is `/ext/<id>`, so it cannot shadow a HUI route. The sidebar
  shows enabled pages after the built-in navigation.
- `ExtensionStatus.page` carries the title, entry, icon and route so the browser
  can build navigation without guessing.

### `context.hui`

Every route handler gets a typed, read-only gateway facade:

```ts
context.hui.github.contributions({ year?: number }): Promise<GitHubContributions>;
context.hui.sessions.list(): Promise<SessionView[]>;
context.hui.sessions.transcript(id: string): Promise<TranscriptItem[]>;
context.hui.metrics.host(): Promise<HostMetrics>;
context.hui.usage.report(query: UsageQuery): Promise<UsageReport>;
```

- Values are plain JSON; no service handles, file paths or modules.
- The same facade works in `mode: "process"` through the host protocol; the parent
  executes the call.
- Capabilities are additive within `apiVersion: 1`.
- Writes (backlog, goals) are a later phase; P7 is read-only.

### Page bridge

The panel channel (`hui-extension`) gains a page mode:

- parent → page: `init` (extensionId, theme, page id), `theme`, `result`, `error`.
- page → parent: `ready`, `call`, `height`, `title`, `open` (https only),
  `navigate` (`/sessions/<id>` and other allowlisted HUI paths).
- The parent enforces the declared routes and the same size, count and time
  limits as panels. A page cannot call HUI routes directly.

### Bundled extensions

- HUI's package ships `extensions/<id>/` next to `server/` and `skills/`.
- The registry merges packaged and config extensions; a config extension with the
  same id wins and marks the packaged one `overridden`.
- The shipped store enables page extensions by default; disabling one persists in
  `extensions.json`.
- `hui extension eject <id>` copies the packaged directory to the config directory
  without enabling the copy; the operator edits it, reloads, and the copy wins.
- `hui doctor` reports an override that no longer loads, a packaged extension
  shadowed by a broken copy, and a copy older than the packaged source.

## Phases

### P7 — primitives (this goal)

- The `ui.page` manifest, status, schema and validation.
- `context.hui` read-only in-process: GitHub contributions first; sessions and
  host metrics as the facade takes shape. The process-mode proxy is P8, not P7.
- The sandboxed page host, sidebar entry, `/ext/<id>` route and bridge.
- A fixture page extension with an e2e test, proving page rendering, bridge calls
  and disable/restore.
- Packaged discovery, default enablement, eject and doctor are **P8**: they need a
  real page to ship and belong with the first port.
- Spec, guide and API documentation; no native page is moved yet.

### P8 — Contributions

Port the GitHub calendar/weekly chart, account and metric pickers, the session
calendar and its `navigate` into `extensions/contributions/`; keep the native page
until the port passes the same use cases; then remove it and enable the extension
by default.

### P9 — Dashboard

Port sessions, stages, waiting list, host metrics and the activity chart after the
Contributions page proves the contract.

### P10 — Kanban

Add the writable backlog context, then port the board and its drag-and-drop.

## Acceptance for P7

- An extension manifest with `ui.page` loads and lists a sidebar page at
  `/ext/<id>`; an invalid entry or icon is refused with a named reason.
- The page renders in a sandboxed frame with the HUI theme, reports its height,
  calls only its declared routes, and cannot reach HUI directly.
- `context.hui.github.contributions` answers real GitHub data to a route in both
  in-process and process mode, and never exposes a service handle.
- Packaged extensions are enabled by default, disableable, ejectable, and a config
  copy shadows the packaged one; `hui doctor` reports the edge cases.
- The fixture page's e2e test passes on the web; the existing extension, page and
  use-case checks stay green.
- `npm run typecheck`, `npm run build`, the focused suites and the full known
  baseline pass; CI is green.

## Risks

- Rewriting a page can lose design, accessibility and performance parity; each
  port keeps its existing use cases and measures the session and page load.
- A default-on extension that fails removes a page; the registry must contain the
  failure to that page and `hui doctor` must name it.
- Page code is public and untrusted; no secrets, no HUI origin, no direct API.
- Packaged and user copies can drift; the override, eject and doctor states must
  be explicit and tested.
- The bridge's `navigate` is a new surface: allowlisted paths only, never arbitrary
  URLs or HUI API calls.
