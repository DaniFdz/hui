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

## A message, start to finish

1. **Composer** (`src/hui-app.ts`, `src/lib/composer-state.ts`) builds the
   prompt with its attachments and draft.
2. **Client API** (`src/lib/sessions-store.ts`) posts it to
   `/__hui/sessions/:id/prompt` (or `steer`, `follow-up`, `queue`).
3. **Route** (`server/hui.ts`) validates the request and hands it to the live
   session.
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
| HTTP entry and routing | `hui.ts` (all `/__hui/` routes), `gateway.ts` (process start), `host.ts` (bind address), `static-files.ts`, `http-compression.ts` (Brotli/gzip for files and JSON) |
| Session registry and lifecycle | `sessions.ts` (HUI registry), `live-sessions.ts` (running sessions), `session-list.ts`, `session-transport.ts` |
| Runtimes | `runtimes/types.ts` (contract), `runtimes/durable*.ts` (Pi Durable: host, adapter, prompt, tools, PI extensions, questions), `runtimes/pi*.ts` (PI SDK worker and CLI fallback), `runtimes/pi-import.ts` (moves PI sessions to Durable for `hui doctor --fix`) |
| HUI agent tools | `runtimes/hui-tools.ts` (definitions), `agent-tools-bridge.ts` (loopback bridge for PI workers), `subagents.ts`, `watchers.ts`, `task-suggestions.ts`, `secret-requests.ts` |
| PI configuration | `pi-config.ts` (read-only view), `pi-mutations.ts`, `pi-paths.ts`, `providers.ts`, `provider-accounts.ts`, `model-routing.ts` |
| Git and GitHub | `worktrees.ts`, `worktree-inventory.ts`, `github*.ts`, `pull-requests.ts` |
| Integrations | `jira*.ts`, `backlog.ts` (Kanban), `automation.ts` |
| Terminals and browser | `terminals.ts`, `terminal-transport.ts`, `browser/` (managed Chromium over a CDP pipe), `browser-transport.ts` |
| Bots and calls (Labs) | `bots.ts`, `bot-*.ts`, `bot-templates/` (other platforms' bot templates, read for import), `calls.ts`, `call-*.ts`, `runtimes/durable-bots.ts` |
| OptChat memory | `optchat/` (engine, no HUI imports), `runtimes/durable-optchat.ts` (Durable glue); see `docs/optchat.md` |
| Remote workers | `workers.ts`, `worker-routes.ts` (gateway side), `worker/` (host daemon, protocol, bootstrap, config sync) |
| Settings, paths, updates | `hui-settings.ts`, `paths.ts`, `updates.ts`, `power.ts` |

## src/ — the browser app

| Area | Start here |
|---|---|
| App shell | `main.ts` (styles, boot, mount), `lib/boot-screen.ts` (index.html's boot screen), `lib/view-assets.ts` (view stylesheets loaded together before the first paint), `hui-app.ts` (navigation and cross-view state), `lit/hui-element.ts` |
| Client stores and API | `lib/sessions-store.ts` (session API), `lib/settings-store.ts` (fetch boundary, `x-hui` header), `lib/gateway-request.ts` (response deadline), other `lib/*-store.ts` |
| Pure logic | `lib/` (normalizers, parsers, layout and menu rules; tested beside each file) |
| Chat | `views/chat/` (projection, tool cards, position rail), `lib/markdown*.ts`, `lib/composer-*.ts` |
| Sidebar and sessions | `lib/sidebar-sessions.ts`, `lib/session-tree.ts`, `views/sessions.ts`, `views/sidebar-session-options.ts` |
| Pages | `views/*.ts` (settings, automation, kanban, contributions, bots, worktrees) |
| Reusable components | `components/` (panes, hovercards, dialogs); `components/openclaw/` is a hash-pinned OpenClaw port, do not edit it by hand |
| Visual tokens | `styles/tokens.css` first, then the per-surface stylesheets |

## Elsewhere

| Path | Owns |
|---|---|
| `cli/` | The `hui` command: gateway lifecycle (`gateway*.ts`, `state.ts`), installed releases and updates (`releases.ts`, `update*.ts`, `installation.ts`), `hui doctor` (`doctor*.ts`) |
| `shared/` | Types and pure helpers imported by both browser and gateway; no Node or DOM APIs |
| `desktop/` | Electron wrapper (`main.cjs`, `policy.cjs`) and macOS app registration (`install.mjs`) |
| `bin/` | Entry points: `hui.mjs` (installed CLI), `hui-dev.mjs` (`npm run dev`) |
| `scripts/` | Build, test runner, release and nightly versioning |
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
  every directory holding source modules appears in this file.
