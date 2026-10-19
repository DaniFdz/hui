# Code map

A short map for finding your way around HUI. It names owners, not every file:
each module starts with a header comment saying what it owns, so open the
file the map points at and read its first lines. Product contracts live in
`SPEC.md` and `docs/api.md`; the scoped `AGENTS.md` files hold the rules for
editing each directory.

## The shape

```
browser (src/)  ──/__hui/ JSON + WebSocket──▶  gateway (server/)  ──▶  Pi Durable harness (SQLite)
                                                 │                    PI SDK worker (legacy sessions)
cli/  starts, stops and updates the gateway ─────┘                    remote workers (server/worker/)
desktop/  wraps the same UI in Electron
shared/   types and pure helpers both sides import
```

The browser never touches the filesystem or child processes; everything goes
through typed `/__hui/` routes. The gateway owns HUI's state under
`~/.config/hui`, PI owns its configuration and credentials under `~/.pi`, and
Pi Durable owns conversations, runs, queues and crash recovery.

## Dependency rules

`scripts/boundaries.test.mjs` checks these in `npm test`. Its allowlist holds
the exceptions that exist today: delete an entry when you fix it. A move may
rename an entry; a commit never adds a new kind of violation.

- R1. `src/` imports only `src/` and npm packages; production `src/` code
  imports no Node module.
- R2. `server/`, `cli/`, `desktop/` and `bin/` never import `src/`.
- R3. Nothing imports `shared/`, and the directory goes away.
- R4. `server/` and `cli/` may import each other; `desktop/` imports only
  `desktop/`; `bin/` imports `cli/`, `server/`, `desktop/` and `build/`.
- R5. Only `src/api/` calls `fetch`, `new WebSocket` or `new EventSource`.
- R6. `src/lib/` imports nothing from `src/controllers/`, `src/components/` or
  `src/views/`, and only types from `src/api/`, except `*-store.ts` modules,
  which cache what the API returns.
- R7. `src/views/` imports nothing from `src/controllers/` or `src/hui-app.ts`.
  Only `src/components/` and `src/hui-app.ts` register custom elements.
- R8. `server/runtimes/` and `server/sessions/` never import `server/bots/`.
- R9. `server/optchat/` imports only itself and npm packages.
- R10. No import cycles inside `src/`, `server/` or `cli/`, type-only imports
  included.
- R11. Product code never imports `e2e/`, `evals/` or `scripts/`. Those may
  import either side, and tests may import their fixtures.
- R12. No file imports both `src/` and `server/`.
- R14. The remote worker release ships every module that
  `server/worker/main.ts`, `server/worker/host.ts` and `server/runtimes/` load.
- R15. `server/api/` imports only `typebox` and itself.
- R17. Installed entry points keep their paths: `bin/hui.mjs`, `cli/launch.ts`,
  `cli/main.ts`, `cli/gateway-run.ts`, `server/runtimes/pi-sdk-worker.ts`,
  `server/worker/main.ts` and `index.html`. An installed CLI checks their built
  files before switching to a new release.

R13 and R16 are not checked yet.

## A message, start to finish

1. **Composer** (`src/hui-app.ts`, `src/lib/composer/state.ts`) builds the
   prompt with its attachments and draft.
2. **Client API** (`src/api/sessions.ts`) posts it to
   `/__hui/sessions/:id/prompt` (or `steer`, `follow-up`, `queue`) with a
   request id (`src/lib/composer/send-requests.ts`) that a resend after a failure reuses.
3. **Route** (`server/hui.ts`) validates the request and hands it to the live
   session; `server/recent-requests.ts` answers a resent id with the first
   send's outcome instead of sending it again.
4. **Live session** (`server/live-sessions.ts`) keeps exactly one runtime per
   session and forwards the prompt through the generic contract in
   `server/runtimes/types.ts`.
5. **Runtime adapter**: `server/runtimes/durable.ts` for Durable sessions (the
   harness itself is `durable-host.ts`), `pi.ts` / `pi-sdk-worker.ts` for
   sessions still on PI, `remote.ts` for sessions on a remote worker.
6. **Events** flow back over a WebSocket per open session view
   (`server/session-transport.ts`, opened with a single-use ticket) to the
   client store.
7. **Rendering**: `src/views/chat/projection.ts` turns transcript state into
   what the chat shows; tool cards live beside it in `src/views/chat/`.

## server/ — the gateway

| Area | Start here |
|---|---|
| HTTP entry and routing | `hui.ts` (all `/__hui/` routes), `server/routes/` (the route modules; `order.test.ts`: which handler answers each route family, in dispatch order), `server/http/` (`route.ts`: the request and result every route module speaks, and request body reading), `gateway.ts` (process start), `host.ts` (bind address), `static-files.ts`, `http-compression.ts` (Brotli/gzip for files and JSON) |
| Session registry and lifecycle | `sessions.ts` (HUI registry), `server/sessions/` (`session-tree.ts`: a session's tree root; `lifecycle.ts`: create, fork, worktree launch, update and delete; `views.ts`: the `SessionView` wire shape and the session list; `stages.ts`: an agent's `set_stage`), `live-sessions.ts` (running sessions), `session-list.ts`, `session-transport.ts` |
| Runtimes | `runtimes/types.ts` (contract), `runtimes/durable*.ts` (Pi Durable: host, adapter, prompt, tools, PI extensions, questions), `runtimes/pi*.ts` (PI SDK worker and CLI fallback), `runtimes/pi-import.ts` (moves PI sessions to Durable for `hui doctor --fix`), `runtimes/model-controls.ts` (a model's reasoning levels, fast mode and the level HUI's Ultra is sent) |
| HUI agent tools | `runtimes/hui-tools.ts` (definitions), `agent-tools-bridge.ts` (loopback bridge for PI workers), `subagents.ts`, `watchers.ts`, `task-suggestions.ts`, `secret-requests.ts` |
| PI configuration | `pi-config.ts` (read-only view), `pi-mutations.ts`, `pi-paths.ts`, `providers.ts`, `provider-accounts.ts`, `model-routing.ts` |
| Git and GitHub | `worktrees.ts`, `worktree-inventory.ts`, `github*.ts`, `pull-requests.ts` |
| Diff view | `git-diff.ts` (read-only Git comparisons: previous and default branch detection, patches with caps, untracked files through a temporary index), `routes/diff.ts` (`/__hui/sessions/:id/diff…`); contract in `shared/diff.ts` |
| Integrations | `jira*.ts`, `backlog.ts` (Kanban), `automation.ts`, `datadog.ts` (Datadog orgs through `pup`) and `datadog-previews.ts` (chat cards for Datadog links); contract in `shared/datadog.ts` |
| Terminals and browser | `terminals.ts`, `terminal-replay.ts` (bounded replay bytes), `terminal-transport.ts` (wire format in `shared/terminal-stream.ts`), `server/browser/` (managed Chromium over a CDP pipe), `browser-transport.ts` |
| Files view | `files.ts` (list, search, read, save, upload, delete inside a working directory; which chat paths exist there), `routes/files.ts` (`/__hui/sessions/:id/files…`) |
| VS Code view | `vscode.ts` (running the shared VS Code server, license consent, tickets and cookie secrets), `vscode-providers.ts` (finding VS Code desktop's `code serve-web`, servers on PATH or a configured path; launch flags), `vscode-install.ts` (the pinned, checksum-verified openvscode-server install on Linux), `vscode-proxy.ts` (the cookie-guarded HTTP and WebSocket proxy under `/__hui/vscode/`); contract in `shared/vscode.ts` |
| Bots and calls (Labs) | `bots.ts`, `bot-*.ts` (`bot-facts.ts`: explicit operator knowledge on the bot's host; `bot-export.ts`: a bot as a template, reviewed for personal information), `server/bot-templates/` (other platforms' bot templates, read for import, and the export's cleanup and reviewer), `calls.ts`, `call-*.ts`, `runtimes/durable-bots.ts` |
| OptChat memory | `optchat/` (engine, no HUI imports), `runtimes/durable-optchat.ts` (Durable glue); see `docs/optchat.md` |
| Remote workers | `workers.ts`, `routes/workers.ts` (gateway side), `worker/` (host daemon, protocol, bootstrap, config sync) |
| Settings, paths, updates | `hui-settings.ts`, `paths.ts`, `updates.ts`, `power.ts` |

## src/ — the browser app

| Area | Start here |
|---|---|
| App shell | `main.ts` (styles, boot, mount), `lib/boot-screen.ts` (index.html's boot screen), `lib/view-assets.ts` (view stylesheets loaded together before the first paint), `hui-app.ts` (navigation and cross-view state), `src/lit/hui-element.ts` |
| Client stores and API | `src/api/` (requests to `/__hui/`: `request.ts` (fetch boundary, `x-hui` header, response deadline), `settings.ts`, `ui-errors.ts` (browser errors batched to the gateway), `sessions.ts` (session API), `terminals.ts`, `browser.ts`, `files.ts`, `diff.ts`, and one client per area: `automation.ts`, `backlog.ts`, `bots.ts`, `bot-facts.ts`, `bot-templates.ts`, `bot-tools.ts`, `bot-triggers.ts`, `calls.ts`, `datadog.ts`, `jira.ts`, `github.ts`, `github-previews.ts`, `pi.ts`, `providers.ts`, `themes.ts`, `vscode.ts`, `workers.ts`, …), `src/lib/settings/settings-store.ts` (settings cache and write queue), other `lib/*-store.ts` |
| Controllers | `src/controllers/` (Lit controllers holding a page's state and calling `src/api/`: automation (snapshot, polling, task actions), bot import and export, a bot's tools, triggers and memories, calls, the browser live view) |
| Pure logic | `lib/` (normalizers, parsers, layout and menu rules; tested beside each file) |
| Chat | `views/chat/` (projection, tool cards, position rail), `src/lib/markdown/`, `src/lib/composer/` (drafts, state, textarea, send requests); file references that open in the Files view: `lib/files/references.ts` (which text is a path), `lib/files/file-link-store.ts` (batched, cached existence checks), `components/file-link.ts` (`<hui-file-ref>`) |
| Sidebar and sessions | `src/lib/session/sidebar-sessions.ts`, `lib/session/sessions.ts` (group labels, transcript Markdown, unreachable hosts), `lib/session-tree.ts`, `views/sessions.ts`, `views/sidebar-session-options.ts` |
| Pages | `views/*.ts` (settings, automation, kanban, bots, worktrees); self-loading settings sections in `src/components/settings/`, `components/contributions.ts`, `components/session-calendar.ts`; the bots pages' parsers and state in `src/lib/bots/`, voice and live calls in `src/lib/voice/` |
| Reusable components | `components/` (panes, hovercards, dialogs); `components/openclaw/` is a hash-pinned OpenClaw port, do not edit it by hand |
| Split chats and the Work pane | `lib/session/multiplexer.ts` + `components/session-multiplexer.ts` (chat columns, stacks, tabs); `lib/work-pane.ts` (Work view registry and contract, browser-local per-conversation state, migration of old terminal/browser panes), `components/work-pane.ts` (tab strip, launchers, collapsed rail, maximized presentation, narrow destination), `lib/work-shortcuts.ts` (the Work pane's shortcut table and the chords it avoids), `views/panel-selector.ts` (narrow destination chooser, also above a maximized Work pane) |
| Shared terminal | `components/terminal-pane.ts` (Gespenst view: socket, replay, input, links, clipboard, touch, key bar); `src/lib/terminal/` (`stream.ts`: wire reader; `fit.ts`: hidden-pane fits, PTY resize, prompt reflow; `theme.ts`, `links.ts`, `keys.ts`: key bar, clipboard keys; `touch.ts`), `lib/terminal-font.ts` (faces for the worker); Vite settings for Gespenst in `server/hui.ts` (`huiConfig`) |
| Work views | `src/views/work/` (one kind per Work pane view: launch, title, render — terminal, browser, files, vscode, diff), `components/files-view.ts` with `api/files.ts` and `src/lib/files/` (`draft.ts`, `editor.ts`: CodeMirror, loaded on demand; `view-state.ts`); `components/vscode-view.ts` through `lib/vscode-store.ts`, with HUI's colors for it read by `lib/theme/vscode-theme.ts`; `components/diff-view.ts` with `api/diff.ts` and `src/lib/diff/` (`view-state.ts`, `hunks.ts`: patch parsing, side-by-side rows; `highlight.ts`: syntax colours through `lib/code-languages.ts`, shared with the Files editor) |
| Visual tokens | `styles/tokens.css` first, then the per-surface stylesheets; themes through `src/lib/theme/theme-store.ts` (loading through `api/themes.ts`, user accent) and `lib/shadcn-theme.ts` (token mapping, contrast rules), with color math in `lib/color-contrast.ts` |

## Elsewhere

| Path | Owns |
|---|---|
| `cli/` | The `hui` command: gateway lifecycle (`gateway*.ts`, `state.ts`), installed releases and updates (`releases.ts`, `update*.ts`, `installation.ts`), `hui doctor` (`doctor*.ts`), the `/__hui/` client of `hui bot` and `hui schedule` (`gateway-client.ts`) |
| `shared/` | Types and pure helpers imported by both browser and gateway; no Node or DOM APIs |
| `desktop/` | Electron wrapper (`main.cjs`, `policy.cjs`) and macOS app registration (`install.mjs`) |
| `bin/` | Entry points: `hui.mjs` (installed CLI), `hui-dev.mjs` (`npm run dev`) |
| `scripts/` | Build, release and nightly versioning |
| `e2e/` | Browser-tool E2E procedures (`*.browser.md`), fixtures and the package test |
| `nix/` | Flake package, NixOS module and smoke checks |
| `skills/` | Skills shipped with HUI |
| `themes/`, `public/` | Theme palettes and static assets |

## Conventions that keep this map short

- Every source module begins with a header comment: what it owns and, when it
  helps, what it deliberately leaves to someone else. A test enforces that the
  header exists (`scripts/module-headers.test.mjs`); keeping it true is the
  editor's job.
- Tests sit beside their owner as `*.test.ts`; helpers that several server tests share
  (bounded waits, log readers) live in `server/test-support/`, which the build leaves out.
- When you add a source directory, name it here; the same test checks that
  every directory holding source modules appears in this file by its full
  path (`server/browser/`, not `browser/`).
