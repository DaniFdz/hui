# What a gateway extension can do

A **gateway extension** is a trusted local ES module that HUI loads into its
gateway. It can answer JSON routes, contribute a sandboxed panel or page, add
static prompt text and give Durable agents tools. It runs with the gateway's
access to the machine; only the panel and page documents are sandboxed.

This is the capability contract for `apiVersion: 1` after P7. The detailed
manifest and route rules are in [guide.md](guide.md#gateway-extensions); the
product contract is in [SPEC.md](../SPEC.md#gateway-extensions).

## At a glance

| You want to… | Possible? | What v1 gives you |
| --- | --- | --- |
| Answer data or run an action under `/__hui/ext/<id>/` | **Yes** | `export const routes`; JSON in and out |
| Show a small UI beside the conversation | **Yes** | Sandboxed Work-pane panel from `ui/` |
| Add a full page and sidebar entry | **Yes** | `ui.page`; `/ext/<id>`; sandboxed frame |
| Give the agent instructions or a callable tool | **Yes** | Static `prompt` sections and in-process `tools` |
| Stream live events | **Yes** | `stream: true` route; `text/event-stream` |
| Read some gateway data from a route | **Partly** | `context.hui.github.contributions` today; sessions and host metrics are next |
| Reload code, require a HUI version, crash-isolate | **Yes** | Reload, `engines.hui`, `mode: "process"` |
| Ship with HUI and let the operator disable or edit it | **Yes** | Packaged defaults, config override, `hui extension eject` |
| Add a header/status-bar item | **No** | No shell contribution point; a page or panel is the available surface |
| Add a transcript row, tool card or message renderer | **No** | HUI owns the transcript renderer |
| Add a new Work view kind (terminal, diff, VS Code…) | **No** | Core HUI owns Work views and their processes |
| Add a Settings page | **No** | No settings contribution point |
| Call HUI's own routes or DOM from a panel/page | **No** | The bridge forwards only the extension's declared routes |
| Read HUI's sessions, backlog, usage or settings | **Not yet** | No general context API; `github.contributions` is the first capability |
| Register a provider, model, MCP server or theme | **No** | HUI owns model routing and themes |
| Add slash commands, keyboard shortcuts or flags | **No** | The agent layer has PI extensions; gateway extensions do not register UI commands |
| Put secrets in a panel or page | **No** | Page files are served before the `x-hui` gate and are public |
| Make network calls from a panel/page | **No** | The frame's CSP has no network; ask a route through the bridge |
| Run in a native phone app | **No** | Extension surfaces are web-only in v1 |

## Routes

- The path is one to four clean segments below `/__hui/ext/<id>/`; it cannot
  shadow a HUI route.
- A handler gets `{ method, path, query, body, signal, extension, hui }`.
- Return `{ status?, body }`; `body` is a JSON object up to **256 KiB**.
- Request bodies are JSON up to **64 KiB**. There are no response headers,
  files, redirects or cookies.
- `stream: true` returns an async iterable. HUI sends `data:` frames, a 15 s
  heartbeat and an `error` event, capped at 10 minutes, 5 000 events, 256 KiB
  per event and 5 MiB total. Aborting the client aborts `signal`.
- At most **32 routes** per extension.

## Panels and pages

- Both are documents under `ui/`, served at `/__hui/ext-ui/<id>/` **before the
  `x-hui` gate**. Treat every file there as public and cacheable.
- The frame has an opaque origin, `sandbox="allow-scripts allow-forms"`, no
  network and no access to HUI's DOM or `x-hui` header.
- The bridge is the only channel:
  - document → parent: `ready`, `call`, `height`, `title`, `open` (https only),
    `navigate` (pages; `/sessions/<id>` only).
  - parent → document: `init`, `theme`, `result`, `error`.
- Calls are limited to the declared routes, **20 in flight**, **30 s** each,
  64 KiB request and 256 KiB response.
- A panel lives in the Work pane; a page is a sidebar destination at
  `/ext/<id>`. Neither can add a header item or another shell region.
- Extension pages are web-only. A native phone app has no extension surface.

## Prompt sections and tools

- A prompt section is static text (4 000 characters each, 16 000 total) and
  reaches new Durable conversations after the goal.
- A tool is declared in `extension.json` and exported by name from `index.mjs`;
  the runtime name is `ext_<id>_<name>`. Arguments are checked against a JSON
  Schema subset; a failure is an `isError` result, not a failed turn.
- At most **16 tools** per extension. Tools require in-process mode; a
  process-mode extension cannot declare them.
- Existing Durable conversations keep the tools and prompt they started with;
  the next new session gets changes.

## Gateway context

A route handler gets `context.hui`, a typed read-only facade. It returns plain
JSON, never service handles, file paths or modules.

| Capability | In-process | Process mode |
| --- | --- | --- |
| `github.contributions(year?)` | Yes | Yes, proxied to the parent |
| `sessions.*`, `metrics.*`, `usage.*` | Not yet | Not yet |

The process proxy uses additive `context` / `context-result` host frames; the
extension never imports gateway internals. New capabilities are additive within
`apiVersion: 1`.

## Lifecycle, packaging and trust

- `version` and `engines.hui` are optional; an out-of-range gateway refuses to
  load with a named reason.
- `hui extension add <path> [--link]`, `list`, `enable`, `disable`, `reload`,
  `remove [--delete]` and `eject <id>` are the CLI. Settings → Extensions has
  the switch, Reload and Open panel.
- Packaged extensions live beside `skills/` in HUI's package. A config extension
  with the same id overrides one. `extensions/defaults.json` lists packaged ids
  enabled until `extensions.json` exists; the operator can disable them.
- `hui extension eject <id>` copies a packaged extension into
  `HUI_CONFIG_DIR/extensions/<id>/` without enabling it. Edit the copy, reload,
  and it wins over the packaged source. `hui doctor` reports a broken override,
  a stale copy or a failed default.
- `mode: "process"` is **crash isolation, not a sandbox**: the child runs as the
  same user with the same file access. At most eight process extensions; a crash
  restarts after 1/2/4 s, routes answer 503 while restarting, and three crashes
  in five minutes leave it `failed` until a reload.
- In-process extensions already have the gateway's full access. Do not treat the
  bridge as a security boundary between an extension and the gateway; it is a
  boundary between the **panel/page** and HUI.

## When the answer is no

A “no” above is a core change, not a missing flag:

- **Header, status bar, transcript, Work view or Settings page:** needs a new UI
  contribution point and a versioned component contract.
- **Sessions, backlog, usage or settings data:** needs the gateway context to
  grow read (and later write) capabilities, with tests and a schema.
- **Providers, models, MCP or themes:** HUI owns routing and presentation;
  those need a deliberate product decision.

The page program is porting Contributions, Dashboard and Kanban in that order;
the packaged/default/eject machinery is already in place. Until then, a page or
panel can expose the part of those features that their routes can serve.

## Checklist before promising a design

- [ ] The data can be fetched by this extension's own routes (or is already in
      `context.hui`).
- [ ] The UI fits a panel or a page; it is not asking for the header, a
      transcript renderer or a new Work view.
- [ ] Page files contain no secrets and assume no network.
- [ ] The operator can disable it; a failed extension removes only its own
      surface and `hui doctor` names it.
- [ ] The extension still works after a reload and at 390×844.
