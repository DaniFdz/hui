---
name: plan
description: "Use when a change needs its data shape, boundaries and types settled before code, or when a second attempt keeps fighting the first design."
---

# Plan

Settle the shape of a change before writing code, so the implementation decides
nothing new. Keep the plan in the conversation. Write a repo file only when the
operator asks for one.

## Read first

- `AGENTS.md`, `docs/map.md`, and the per-directory `AGENTS.md` of every subtree
  the change touches. `server/`, `src/`, `docs/` and `e2e/` each own rules.
- `SPEC.md` and `docs/api.md` when the change alters a product contract.
- The module that already owns the behaviour. Adding a second owner is a
  decision to state, not a side effect.

Run `investigate` when the current owner or the history behind it is unclear.

## Data shape before code

Write the payload, record or store the change needs, field by field, with the
module that owns it and the code that constructs it. Say what the browser holds
and what the gateway holds. The browser has no filesystem or child-process
access, so everything a screen needs crosses a typed `/__hui/` route.

A shape that crosses the seam has two sides. `server/api/` owns the TypeBox
payloads, `docs/api.schema.json` is regenerated with `npm run api:schema`, and
`src/api/schema/` holds the browser types built from it. HUI shares no code
between `src/` and `server/`, so a plan that seems to need a shared module has
the boundary wrong.

## Types and call sites

Name every type and signature that changes, and every call site that must
follow, as `path:line`. Read each caller. A signature change is not planned
until its callers are counted.

TypeScript is strict. Prefer a narrow signature over an options bag, a union the
compiler narrows over a pair of booleans, and one owner of a piece of state over
two copies kept in step. If the design needs `any`, a cast, or an optional field
that is always set, the type is wrong.

## Options when the fork is real

Write two or three whole-shape options when the choice changes ownership,
layering or a persisted format. Each option states the interface, what it hides,
and what it costs to change later. Skip the menu when one shape is clearly right.
A choice nobody needed wastes the reader's attention.

## Phase order

Split the work into phases that each end in a run, and order them so every phase
leaves the tree compiling and `npm test` green. Name the phase that deliberately
breaks, and what closes it. Move callers before deleting the old shape. The
`principles` skill calls this `Sequence into verifiable units`.

A phase is verifiable when it names its check, such as `npm test -- <file>`,
`npm run typecheck`, or a Browser-tool journey through the changed controls.

## Hand off

Give the implementer the shape, the call sites, the phase order and the checks.
When implementation keeps fighting the plan, throw the plan out and replan.
Repeated workarounds of the same shape across unrelated files are the signal.
