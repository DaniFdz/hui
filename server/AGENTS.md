# Server Guide

This directory owns HUI's local HTTP API, persisted HUI registry, PI configuration
reads, long-lived session lifecycle, and runtime adapters.

## Boundaries

- `hui.ts` owns `/__hui/` routing and transport concerns. Keep parsing, validation,
  and status mapping near the route; move lifecycle and persistence rules to their
  owning modules.
- `sessions.ts` owns HUI registry persistence. `live-sessions.ts` owns the one-live-
  runtime-per-session invariant. `runtimes/` translates a harness protocol into the
  generic types in `runtimes/types.ts`.
- PI files and transcripts are externally owned: read them through explicit adapters
  and never rename, rewrite, or delete them. HUI writes only HUI-owned state.
- Validate all browser input at the server boundary. Preserve the `x-hui` local-
  client guard, request size limits, path constraints, and bounded external fetches.
- Runtime exits and malformed protocol messages must become explicit session/error
  events; they must not crash the HUI server or invent successful state.

## Tests

- Keep `*.test.ts` beside its owner and use `node:test` plus strict assertions.
- Use temporary directories, synthetic config/transcripts, and controllable fake
  runtimes. Never mutate real `~/.pi` or `~/.config/hui` data in a test.
- Prove lifecycle edges: duplicate opens, busy prompts, abort/exit, reconnect,
  persistence failure, and cleanup. Wait for emitted state; do not use arbitrary sleeps.
- State a test cannot await is polled with `waitFor` (`test-support/wait-for.ts`):
  a wall-clock deadline, setTimeout between reads, and the awaited state in its
  failure. Never re-poll with setImmediate or an iteration count.
- Run the focused test file, then `npm test` and `npm run typecheck`. Changes to
  routes or runtime behavior also require Browser-tool E2E proof of the consuming flow.
