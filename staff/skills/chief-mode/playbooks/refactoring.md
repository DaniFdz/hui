# Refactoring

The structure changes. The behavior does not. Distinct from `feature.md`, which adds behavior,
and `bug-fix.md`, which corrects it.

1. Pin the behavior first: a characterization test, a snapshot, or an equivalence harness that
   fails when behavior moves. Typecheck and lint are not a pin. An area with no coverage gets
   the pin before any structure moves.
   Evidence: the pin's path and the command that runs it green.
2. Write down the contract the pin holds, in one paragraph, so a later diff can be measured
   against it.
   Evidence: the paragraph, quoted in the pull request.
3. Name the structure the code is missing and the target shape: module layout, types, call
   graph, as if built today. Send it to `planner` when the reshape crosses a function boundary.
   Evidence: the target shape and the branches or invalid states it deletes.
4. Subtract before adding. Delete dead code, collapse one-caller wrappers, drop redundant
   validators, and remove orphan references first.
   Evidence: the deletion commit and the pin still green.
5. Move in behavior-preserving steps, each with the pin green. Migrate every caller and delete
   the old name in the same change; no compatibility shims and no parallel old and new paths.
   Check `scripts/boundaries.test.mjs` when a move changes which layer imports what.
   Evidence: one commit per step and the pin's result at each.
6. Prove the behavior unchanged on the artifact, not on the compiler: `npm run build`, the e2e
   journey for a user-visible surface, or an output diff between the old and new code.
   Spot-check every rename against the files, since strings, prose and back-references get
   missed.
   Evidence: the comparison and its result, not a statement that it compiles.
7. Measure the reader load: layers, one-caller wrappers and mutable scope before and after. If
   the diff lowers reader load nowhere, revert it.
   Evidence: the before and after counts, and the keep or revert decision.
8. Send the diff to `reviewer`, then run `opening-a-pr.md` with the commits ordered as a
   subtraction, the reshape, then the cleanup.
   Evidence: the findings, commit SHAs, the pull request URL and its check state.

## Reply

The structure that changed, the pin that held it, the equivalence proof, the reader-load delta,
and what was reverted. Say plainly that no behavior changed, or name the behavior that did and
where it moved.
