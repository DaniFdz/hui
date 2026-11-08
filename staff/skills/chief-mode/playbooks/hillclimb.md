# Hillclimb

**You own the metric and the experiment's integrity. Supervise and review; delegate the
attempts.**

Use this for sustained improvement of one measurable thing against a target. A one-off fix
is a bug fix or a perf issue.

1. Name the metric, the direction that counts as better, and a stop predicate that pairs a
   target with a floor on attempts, so a lucky early win cannot end the run: "median startup
   under 400 ms, and at least 10 attempts". Use the operator's numbers when given.
2. Build the harness before the first change and prove it can tell cases apart. Run
   contrasting workloads and confirm the target case reproduces the symptom while the easier
   ones separate. Make it print the sample count and the work done, then freeze it: one
   command emits the metric as a median of N samples, not a single run.
3. Record the baseline and a green run of the regression gate (the tests that must keep
   passing) before any change. Without both numbers there is no experiment.
4. Open the decision log in `work/<task>.md`: id, hypothesis, change, before, after, delta,
   gate, verdict (kept or reverted), note. Read it before every attempt, and keep it out of
   the diff.
5. Ground each hypothesis in a mechanism, not a guess: name what is slow and why ("first
   paint waits on a synchronous read"). Order hypotheses by expected size.
6. Loop one hypothesis per iteration. Hand the change to a fresh worker with a tight scope
   over the paths it may write. Measure before and after with the frozen harness and run the
   gate. Keep only a move past noise with the gate green; revert anything else in full.
7. Run parallel attempts only when the hypotheses are independent, each in its own worktree.
   Merge accepted results one at a time and re-measure the combined result, because two
   individually real wins can cancel.
8. One commit per accepted fix, staging only its files (`git add <files>`, never `-A`). Log
   the row either way.
9. Push past the first plateau: several rejects in a row means change category, combine near
   misses, or reread the source before concluding the hill is climbed. Correctness and
   simplicity outrank the number, and a win that breaks behavior is reverted.
10. Stop when the predicate is met, or when the remaining ideas cost more than they return.
    Never relax the predicate to meet it.
11. Open the PR with the accepted commits in their landing order, per `opening-a-pr`.
12. Report: the metric and target, baseline to final with the delta, attempts kept and
    reverted, each accepted fix on one line, the decision log path, and the best idea left
    untried.
