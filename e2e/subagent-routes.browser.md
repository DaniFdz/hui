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

1. Settings → Models shows **Subagent routes** with *No routes yet* and an
   **Add route** action in its heading. The action opens a modal with an empty,
   focused Name, Description, Model and Thinking. Model starts on the available
   primary model, otherwise the first available model; Thinking starts on
   **Inherit parent**. Opening the form creates no route. Cancel or Escape
   discards the draft and returns focus to the action without leaving Settings.
2. Fill the form and choose **Add route** to save it. Empty, invalid and duplicate
   names are refused. A failed save keeps the draft for retry and leaves no
   route in the list. While saving, editing and dismissal are disabled. Saved
   routes show compact summaries of their name, description, model and thinking,
   with Edit and Remove actions instead of expanded fields.
3. Edit opens the same modal with the route's saved values. Change a field and
   cancel or press Escape: the original summary stays unchanged and focus returns
   to Edit. Reopen and choose Save changes: the summary updates only after the save
   succeeds. Keeping the original name is valid; a rename replaces the same row;
   names already used by another route, blank names and names with spaces are
   refused. A failed edit retains the draft and the original saved route. With
   50 routes, Add route is disabled but Edit still works. An edit may preserve a
   stored model that is no longer available. With `fast` (HUI SDK Fixture, thinking
   low) and `deep` (HUI Route Fixture, thinking high) configured, reload shows both
   summaries and reopening Edit shows their saved values.
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
7. Check the modal at 1440×900, 390×844 and 844×390. All fields and actions
   remain reachable without horizontal overflow; short viewports scroll inside
   the dialog. Tab stays inside it. Escape closes an open picker before it
   closes the dialog. The compact list keeps each route's summary and its actions
   readable on desktop and mobile; no saved-route inputs appear until Edit opens.

## Shared web tests

`npm run e2e -- e2e/tests/set/subagent-routes.e2e.ts` covers SET-078 and SET-079:
modal creation, initial focus, Cancel/Escape without saving, invalid and
repeated names, compact summaries, prefilled edits, rename, removal, optional
thinking, reload persistence, editing at the limit and unavailable-model preservation,
the routed child's model and thinking, the unchanged parent, and unknown-route
or route-plus-model refusal before a child exists. Both cases are required on
the web; iOS remains backlog. `src/lib/settings/settings-store.test.ts` covers
failed add/edit saves and retries, a model-role change queued during a route save,
and invalid replacements refused before writing, through the real write queue
with controlled request responses.

## Limitations

Only Durable sessions and the local fixture provider were exercised. A PI SDK
worker session receives the same names through its `HUI_MODEL_ROUTES`
environment, and a remote worker reads them from its synced settings copy;
neither runtime was part of this journey. Screenshots prove the rendered state;
the resolved model, the pinned thinking level and the refused route were also
asserted from the child's record and the tool results above.
