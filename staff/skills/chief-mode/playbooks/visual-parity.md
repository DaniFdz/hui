# Visual parity

The baseline is the spec. Equivalence is proven by an image diff, not by eye.

1. Capture the baseline before the change: the component across its states (rest, hover,
   focus, open, disabled, error) at 1440×900, 390×844 and 844×390, plus the target
   implementation when matching two.
   Evidence: the capture directory outside the repository and the list of states.
2. State and hold the anti-shortcut clauses: no harness edits, no baseline tampering, no
   restructuring to make a diff pass. A baseline that looks wrong stops the run and goes to
   the operator.
   Evidence: the clauses in the task page, and any exception with its reason.
3. Migrate one component at a time, shared primitives first as a blocking step. One `worker`
   per component and one branch per component; two components never write the same stylesheet
   at once.
   Evidence: one ledger row per component with its branch.
4. Diff each migration against its baseline at the same viewport, data and theme. A nonzero
   diff is a fail. Investigate the delta (spacing, token, font, border, radius) instead of
   widening the tolerance.
   Evidence: the diff image and the pixel count per state.
5. Check the tokens and contrast rules the component uses: `src/styles/tokens.css`,
   `src/lib/theme/color-contrast.ts`, and the appearance contract in `SPEC.md`. A color that
   fails contrast is a fail even at zero pixel diff.
   Evidence: the token and the computed ratio.
6. Drive the interaction states in the browser tool, then resize back and forth to catch
   layout that only breaks at one width. Resize is not touch proof; record device emulation
   separately.
   Evidence: captures per state, and any console error left unexplained.
7. Follow `e2e/visual-parity-2026-09-24.browser.md` when the work is the OpenClaw port, since
   it owns the reference servers, probes and comparison methods.
   Evidence: the procedure step reused and its output.
8. Run `opening-a-pr.md` per component or per safe batch, with the baseline, the diff and the
   result in the description.
   Evidence: the pull request URL and `gh pr checks <number>`.

## Reply

The components migrated, the diff result for each, where the baseline lives, what remains, and
any state that could not be matched.
