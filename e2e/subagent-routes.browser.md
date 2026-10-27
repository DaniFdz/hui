# Browser journey: subagent model routes

Verified with HUI's real gateway, real Durable sessions and the deterministic
local provider from `e2e/visual-verification.mjs`. The run used a disposable HUI
config, PI agent directory, session directory and workspace; it did not read or
change operator sessions, credentials or PI configuration.

## Reproduction setup

```sh
node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"
```

Use the receipt's `browserUrl`, `workspace` and `receipt`, and run
`doctor --receipt` before and after the journey. The fixture catalog has two
models on the `hui-e2e` provider: *HUI SDK Fixture* (`hui-e2e/fixture`, the
provider's default and the parent session's model) and *HUI Route Fixture*
(`hui-e2e/fixture-deep`), so a child's model is visibly different from its
parent's.

The provider's `E2E_SUBAGENTS_ROUTE` path asks real PI to call `sessions_spawn`
twice in one turn: `route: "deep"` (accepted) and `route: "no-such-route"`
(refused).

## Visible-control journey and observed results

1. Settings → Models shows **Subagent routes** with *No routes yet* and **Add
   route**. Adding a route writes it immediately: the isolated
   `config/hui/settings.json` holds `models.routes`.
2. Editing the row's name, description, model and thinking saves each field. A
   name that repeats another route, or holds a space, is refused and the stored
   names stay as they were; picking a model from the catalog stores its
   `provider/id`; thinking stores the chosen level or no level at all.
3. With `fast` (HUI SDK Fixture, thinking low) and `deep` (HUI Route Fixture,
   thinking high) configured, a reload shows both rows and the same values.
4. Create a session with `E2E_SUBAGENTS_ROUTE spawn two workers`. The transcript
   shows two `sessions_spawn` calls: one *Completed* whose input carries
   `route: "deep"` and no model, and one *Failed* whose output reads
   `Unknown route: no-such-route. Configured routes are fast, deep.`
5. The sidebar nests **Routed worker** under its parent. The child's composer
   reads **Model: HUI Route Fixture** and **Thinking: high** while the parent
   reads **Model: HUI SDK Fixture**, so the route resolved to its model and the
   pinned level, and the spawn never named either.
6. The parent's own prompt, read through `GET /__hui/sessions/<id>/tools`,
   carries a route block that opens with *Model routes for `sessions_spawn`* and
   then lists one line per route: `- fast: Cheap and quick: lookups, summaries,
   simple edits.` and `- deep: Slow and careful: hard debugging and design
   work.`
7. 1440×900 gives each route two lines: its name and description, then its
   model, thinking and Remove. At 390×844 the name and description share the
   first line, the model and thinking controls stack below it, and Remove stays
   right-aligned. The child session's model and thinking fit beside the composer.

## Shared web tests

`npm run e2e -- e2e/tests/set/subagent-routes.e2e.ts` covers SET-078 and SET-079:
route CRUD, invalid and duplicate names, optional thinking, reload persistence,
the routed child's model and thinking, the unchanged parent, and unknown-route
or route-plus-model refusal before a child exists. Both cases are required on
the web; iOS remains backlog.

## Limitations

Only Durable sessions and the local fixture provider were exercised. A PI SDK
worker session receives the same names through its `HUI_MODEL_ROUTES`
environment, and a remote worker reads them from its synced settings copy;
neither runtime was part of this journey. Screenshots prove the rendered state;
the resolved model, the pinned thinking level and the refused route were also
asserted from the child's record and the tool results above.
