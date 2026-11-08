---
name: arena
description: "Use when a single attempt would lock in the wrong shape: run N candidates at one task, pick a base, and graft the best parts of the rest into it."
---

# Arena

A bakeoff for a design fork. N candidates get one brief, you pick a base, and you graft the best parts of the rest into it. Use it when one attempt would lock in a shape that is expensive to change. A routine edit, a task with one right answer, and a settled spec go to `delegate` instead.

## Frame

Every candidate gets the same brief and the same named base commit. Write the brief with `delegate`, then add:

- **Artifact.** The exact thing each candidate produces: a design, a module, a patch, or a prototype.
- **Output path.** One worktree or scratch directory per candidate, such as `git worktree add /tmp/arena-<slug>/candidate-<n> -b arena/<slug>-<n> <base>`. No candidate writes the shared checkout or another candidate's directory.
- **Rationale.** Each candidate names the alternatives it considered and why it rejected them. The rationale is part of the artifact.
- **Rubric.** 3 to 6 gradeable criteria you will score against. Keep the rubric; candidates do not see it.

Pick 2 to 4 candidates for most forks, and more only when the fork has several directions. Use one route N times when the work is generation-bound, and distinct routes when judgment is the point. Each brief still stands alone.

## Fan out

Spawn every candidate from one `codemode` script with `collect: true`, then `await agents_wait({ ids })` for the whole set. Do not start a second wave before the first is in.

A candidate that produces no artifact drops out. Continue with N-1 and note the dropout in the synthesis.

## Pick a base

Read every candidate end to end before choosing. Score each against the rubric criterion by criterion, not on feel.

Prefer the base a future maintainer can extend without breaking an invariant. When two are close, prefer the smaller API and the cleaner boundary. When they tie, spawn a `reviewer` with the rubric and the candidate paths, and read its verdict as one more opinion.

A candidate's rationale is evidence of its decisions, not proof they are right.

## Graft

Walk each loser once. Take one or two things, usually a clearer state model, a smaller surface, or a test the base missed. Fold each one in by hand so the result keeps one mental model. Never paste a loser's file into the base.

- Candidates converge on one shape: ship the consensus, no graft.
- Candidates diverge wildly: the brief was underspecified. Reframe and rerun. Do not average the divergence.

## Verify and record

Run the deciding command from the brief on the synthesized result, against the baseline. Then run any check the base candidate added.

Record the arena in `work/<task>.md`: candidates, base, each graft with its source, the rejection reasons, and the verification. Add the ledger row at dispatch and at settle, following `show-me-your-work`. One session owns the resulting PR.
