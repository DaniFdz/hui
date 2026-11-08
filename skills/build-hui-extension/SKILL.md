---
name: build-hui-extension
description: "Create or update a HUI gateway extension: a trusted local plugin that adds JSON routes, a sandboxed Work-pane panel or full page, static prompt sections or agent tools. Use when asked to build a HUI extension or plugin, to expose local data or actions in HUI, or to add a panel or page; check the v1 limits before promising a design."
license: MIT
metadata:
  tags: "good practices"
---

# Build a HUI extension

A gateway extension is a local ES module that HUI loads into its gateway. It can
answer JSON routes, serve a sandboxed panel or page, read a narrow gateway context,
add prompt sections and give Durable agents tools. It runs with the gateway's
access to the machine, credentials and data; the panel and page documents are the
only sandboxed parts. Only build code the operator would run.

The reference in `references/hello/` is a working extension: one route, a panel
and a page. Copy it, rename the directory and the manifest, then change the route
and documents. HUI also ships packaged extensions; a config copy with the same id
overrides one.

## 1. Check that the request fits v1

| The request needs… | v1 can… |
| --- | --- |
| JSON data or actions under `/__hui/ext/<id>/` | yes, a route |
| A panel beside the conversation | yes, a sandboxed Work-pane panel |
| A page in the sidebar | yes, a sandboxed page at `/ext/<id>` |
| Read-only gateway data in a route | yes, `context.hui` (GitHub contributions first) |
| A prompt section or an agent tool (Durable sessions) | yes |
| Streaming events | yes, `stream: true` routes |
| The app header or a status bar | no — that is a core HUI change |
| A new Work view (terminal, diff, VS Code…) | no — that is a core HUI change |
| A transcript row, tool card or message renderer | no — that is a core HUI change |
| HUI's session data, usage, backlog, goals or settings | not yet beyond `github.contributions`; a route has no session or cwd |
| A provider, model or MCP registration | no — HUI owns model routing |

If the request needs a “no”, say so before writing code and propose the panel or
route that covers what is possible. Do not edit HUI's source for an extension:
that turns it into a core change with its own tests, docs and release.

The panel does receive the browser `sessionId` in its `init` message, but that is
not a gateway context and the panel cannot call HUI's own routes. Do not reach
into HUI's files or HTTP API to fake it; ask for a core change instead.

## 2. Place the extension

The gateway only reads `extensions/` in its config directory:

```
$HUI_CONFIG_DIR/extensions/<id>/     # when HUI_CONFIG_DIR is set
${XDG_CONFIG_HOME:-$HOME/.config}/hui/extensions/<id>/
```

An `<id>` is a lowercase directory name: letters, digits and `-`, at most 32
characters. The directory holds `extension.json`, the entry module, and optionally
`ui/`:

```
extensions/hello/
  extension.json
  index.mjs
  ui/
    index.html
    panel.js
```

## 3. Manifest

```json
{
  "apiVersion": 1,
  "name": "Hello",
  "description": "One sentence about what this adds.",
  "main": "index.mjs",
  "version": "0.1.0",
  "engines": { "hui": { "min": "0.1.0" } },
  "ui": { "title": "Hello", "icon": "package" }
}
```

- `main` is relative and stays inside the directory; it is a `.mjs` or `.js`
  module.
- `ui` is optional. `entry` defaults to `index.html`; `icon` is `package`,
  `github` or `pull-request`.
- `ui.page` adds a full page: `{ "title": "Hello page", "entry": "page.html",
  "icon": "github" }`. It is served at `/ext/<id>`, listed in the sidebar while
  loaded, and rendered in the same sandbox as a panel.
- `version` and `engines.hui` are optional; a gateway outside the range refuses to
  load with a named reason.
- `mode: "process"` runs routes and streams in a supervised child, but **no
  tools**. Use it only for crash isolation: it is not a sandbox.
- `prompt` and `tools` are optional (see below).

## 4. Routes

`index.mjs` exports `routes`:

```js
export const routes = [{
  method: "GET",
  path: "hello",
  description: "Greets a name.",
  handle: async ({ query }) => ({ body: { greeting: `hello, ${query.get("name") ?? "world"}` } }),
}];
```

A path is one to four clean segments below `/__hui/ext/<id>/`; a route cannot
shadow a HUI route. A handler gets `{ method, path, query, body, signal,
extension, hui }` and returns `{ status?, body }`. The body is a JSON object (at most
256 KiB); there are no response headers, files or redirects. A request body is
JSON under 64 KiB. If the operator leaves, `signal` aborts.

For server-sent events, declare `stream: true` and return an async iterable; HUI
writes `data:` frames, a heartbeat and an `error` event, with event, size and time
caps. The reference does not stream; add it only when the request needs live data.

## 5. A panel

Files under `ui/` are served at `/__hui/ext-ui/<id>/` **before the `x-hui` gate**,
so they are public to anyone who can reach the gateway: never put secrets in them.
The document runs in a sandboxed iframe with no network. It can only ask its
parent, over `postMessage`, for this extension's own declared routes:

- panel → parent: `{ channel: "hui-extension", type: "ready" }`, `{ type: "call",
  callId, method, path, body }`, `{ type: "height", value }`, `{ type: "title",
  value }`, `{ type: "open", value }` (https only).
- parent → document: `{ type: "init", extensionId, sessionId, theme }`, `{ type:
  "theme" }`, `{ type: "result", callId, status, body }`, `{ type: "error",
  callId, error }`.
- a page adds `{ type: "navigate", value: "/sessions/<id>" }`; only that HUI
  conversation path is accepted, never an arbitrary URL or API route.

`ui/panel.js` in the reference has the complete small client. Reuse it; do not
invent another channel. The parent enforces the route list, method, path, body,
response and time limits. The frame's height comes from the panel's `height`
message, so measure `document.documentElement` after rendering. Render with
`textContent`/DOM nodes, not untrusted HTML.

## 6. Gateway context

A route handler receives `context.hui`: read-only plain JSON for gateway data,
starting with `hui.github.contributions(year?)`. It is not a handle to HUI's
services. In-process handlers call the gateway; a process-mode handler asks the
parent over the host protocol, so the same code works in both modes. Keep HUI's
state out of the page itself; ask the route.

## 7. Prompt sections and tools

Declare them in the manifest; export each tool's handler under the tool's name:

```json
"prompt": [{ "id": "hello", "title": "Hello", "text": "Use the greet tool for greetings." }],
"tools": [{
  "name": "greet",
  "description": "Greet someone by name.",
  "parameters": {
    "type": "object",
    "properties": { "name": { "type": "string" } },
    "required": ["name"]
  }
}]
```

```js
export const tools = {
  greet: async (args) => `hello, ${args.name}`,
};
```

The host prefixes the runtime tool name with `ext_<id>_` (here
`ext_hello_greet`), checks arguments against the declared JSON Schema and answers
a failure with `isError` instead of failing the turn. Tools reach **new Durable
sessions** only; already-running sessions keep what they started with. A prompt
section is static text for new sessions after the goal. Process-mode extensions
cannot provide tools.

## 8. Install, enable, verify

From the installed HUI:

```sh
hui extension add <path-to-extension-directory>   # validates, installs, enables
hui extension list
hui extension reload <id>                         # after changing a module or ui/
hui extension eject <id>                          # copy a packaged one to edit
hui doctor                                        # load, override and stale-copy checks
```

`hui extension add --link <path>` keeps the directory in place for development.
The same actions are in **Settings → Extensions** (switch, Reload, Open panel).
An extension installed by copying the directory starts disabled; turn it on in
Settings. A packaged extension listed in `extensions/defaults.json` is on until
the operator's `extensions.json` exists. `eject` copies the packaged source into
your config without enabling it; your copy wins, and `hui doctor` reports a broken
override or an older copy. Install/enable needs a running gateway for the
immediate effect, otherwise it applies at the next start.

Verify with the real gateway, not just the manifest:

```sh
curl -sS 'http://127.0.0.1:<port>/__hui/ext/<id>/hello?name=Ada' -H 'x-hui: 1'
```

The answer must be the JSON body from the handler. Then open **Settings →
Extensions → Open panel** (or the Work pane's **+ → Extension panel**) and check
the panel, its route call and its reload behavior. A failed reload withdraws the
routes and reports `failed`; `hui doctor` names the reason.

## 9. Checklist

- [ ] The manifest parses and the entry stays inside the directory.
- [ ] Every route answers under `/__hui/ext/<id>/` with a JSON body; no secrets
  in the response.
- [ ] The panel/page calls only its own routes through the bridge; no inline
  secrets, no network assumptions.
- [ ] Installing, enabling, reloading, ejecting and disabling all work;
  `hui doctor` is clean.
- [ ] The panel/page still works at 390×844 and after a reload; the tab icon is
  one of the allowed names.
- [ ] If the request needed a header, Work view, transcript renderer or HUI
  session data beyond `github.contributions`, say clearly that v1 cannot do it
  and what a core change would cover.
