# Bug fix

You own the diagnosis and the proof. A worker owns the diff. Every shipped line traces to
runtime evidence; a change that might help is a hypothesis and does not ship.

1. Reproduce on the surface the operator sees, not a proxy. A UI defect runs against a
   launched instance and is driven with the browser tool, a gateway defect runs with
   `npm run dev` through the real route, and a unit-level defect starts as a failing
   `npm test -- <file>`. Ask the operator to reproduce only with a stated reason the surface
   cannot be reached, and only after driving it as far as it goes.
   Evidence: the failing command output or a screenshot saved outside the repository.
2. Form the candidate hypotheses, then eliminate by binary search. Take the split that cuts
   the remaining space most, get runtime evidence for it, and drop the branch it rules out.
   Seed the hypotheses with an `explorer` walkthrough of the subsystem and `git log` over the
   lines that changed.
   Evidence: each hypothesis with the run that killed it or the run that kept it.
3. Confirm the mechanism, not the symptom, before planning anything.
   Evidence: one sentence naming the first place the system went wrong, with `file:line` and
   the run that shows it.
4. Plan the fix, and send it to `planner` when it crosses a function boundary. Delegate the
   diff to a `worker` with the brief from `delegate`, carrying the mechanism, the file paths
   and the behavior to keep.
   Evidence: the returned diff and the commands the worker ran.
5. Land the failing test before the fix. `npm test -- <file>` fails on the new case at the
   parent commit and passes at the fix, with the failing case one commit earlier. Skip with a
   reason only when the cheapest path is integration-heavy or the surface cannot be driven
   from a test.
   Evidence: two runs of `npm test -- <file>`, one failing then one passing, at named commits.
6. Verify on the original surface. The original reproduction now passes; inconclusive or a
   different surface is not a pass.
   Evidence: the step 1 command or journey, run after the fix.
7. Broaden for a user-visible defect. Add or update the entry in `e2e/catalogue/<area>.ts` and
   a shared test in `e2e/tests/`, then run `npm run e2e`. Capture the fixed state with the
   browser tool at 1440×900 and 390×844 and inspect both.
   Evidence: the use case ID, the e2e result, and the capture paths.
8. Run the checks the change needs: `npm run typecheck`, `npm run build`, and `npm test` for
   the suite. Name each with its result.
   Evidence: one line per command.
9. Send the diff to `reviewer` against the intent. Keep a finding only when its command proves
   a failure; drop style notes and risks that need a future change. Fix a kept finding with a
   fresh `worker`.
   Evidence: the findings and the disposition of each.
10. Run `opening-a-pr.md` for the branch, the checks and the description, pasting the failing
    then passing output under `## Verification`.
    Evidence: the pull request URL and `gh pr checks <number>`.

## Reply

What the operator saw break, the root cause with `file:line`, the fix in one sentence, and the
failing then passing output pasted verbatim. Then the checks that ran with their results, the
reviewer findings that changed the diff, and every proof gap.
