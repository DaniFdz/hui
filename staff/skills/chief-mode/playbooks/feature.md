# Feature

You own the design and the proof. Workers own the diff.

1. Walk the subsystem before designing: one `explorer` per area, returning `file:line` for the
   entry points, state, transport and rendering the change touches.
   Evidence: the walkthrough, and the files the change will not touch.
2. Name the data shape before any logic. Send the problem to `planner` for two structurally
   distinct designs, then pick the one that hides more behind a smaller surface. Encode the
   domain in a structure (typed model, state machine, table or registry) rather than scattered
   conditionals.
   Evidence: both designs, the pick, and the sentence naming the shape.
3. Write the throughput checkpoint as four lines in the task page: blocking first steps,
   independent workstreams, shared mutable state, smallest safe decomposition. A line that
   does not apply keeps its place with `n/a: <reason>`.
   Evidence: the four lines in `work/<task>.md`.
4. Split into units that each end in a check. One fresh `worker` per unit with the brief from
   `delegate`; units that write the same file run in sequence.
   Evidence: a ledger row per unit with its child and the diff it returned.
5. Verify each unit before the next: `npm test -- <file>`, `npm run typecheck`, and
   `npm run build`. A unit that skips its check blocks the next one.
   Evidence: the commands and their results per unit.
6. Verify on the real surface. Launch the exact checkout with
   `node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"`, drive the
   journey with the browser tool at 1440×900 and 390×844, and inspect both captures, stored
   outside the repository.
   Evidence: the journey, the capture paths, and any console error left unexplained.
7. Prove the user outcome in the shared suite: add or update `e2e/catalogue/<area>.ts` and a
   test in `e2e/tests/` in the same change, then run `npm run e2e`. A use case required on both
   platforms also runs `npm run e2e:ios` after `npm run ios:build`.
   Evidence: the use case ID, the test file, and the run result.
8. Check the rules the touched code owns: module headers and the directory map
   (`scripts/module-headers.test.mjs`), the dependency rules in `docs/map.md`
   (`scripts/boundaries.test.mjs`), and the performance rules in `AGENTS.md`.
   Evidence: each check with its result.
9. Run `reviewer` on the whole diff against the intent, then re-run the checks a finding
   touches.
   Evidence: the findings and their dispositions.
10. Run `opening-a-pr.md` for the branch, the checks and the description, with desktop and
    mobile screenshots attached and presented to the operator.
    Evidence: the pull request URL and `gh pr checks <number>`.

## Reply

What the operator gets that did not exist before, the design chosen and the alternative it
beat, the throughput checkpoint, what proved it (commands, capture paths, use case IDs), what
remains open, and any proof gap.
