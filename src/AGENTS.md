# Browser UI Guide

This directory owns the Lit application, browser-side stores, views, and visual
tokens. It consumes typed HUI APIs; it does not own PI or filesystem behavior.

## Boundaries

- `hui-app.ts` coordinates navigation and cross-view state. Keep reusable protocol,
  normalization, and store logic in `lib/`; keep `views/` focused on rendering and
  emitting explicit callbacks.
- Keep session and runtime types aligned with `server/runtimes/types.ts` and the
  documented API. Handle loading, empty, error, streaming, and reconnect states
  explicitly; never present an optimistic success as confirmed backend state.
- Reuse tokens from `styles/tokens.css` and established components/classes before
  adding one-off styling. Preserve keyboard operation, visible focus, labels, and
  responsive behavior while matching the OpenClaw reference UI.
- Do not use Node APIs or read PI files from browser code. Requests go through the
  shared fetch/store boundary and retain the local-client header.

## Tests and visual proof

- Unit-test deterministic stores, normalizers, parsers, and catalog rules beside
  their owners with `node:test`. Test behavior rather than Lit implementation details.
- Every user-visible change requires Browser-tool E2E proof in the real app: navigate
  from a user-reachable entry, exercise the changed interaction, inspect the final
  rendered state, and check relevant responsive/keyboard states.
- Run focused tests, `npm test`, `npm run typecheck`, and `npm run build` before
  handoff. Capture and report browser console/runtime errors rather than ignoring them.
