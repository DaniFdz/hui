---
name: figure-it-out
description: "Use when no bundled skill fits a large migration or a multi-part change: write an auditable playbook with phases, evidence, and stop conditions before acting."
---

# Figure it out

Design the playbook when none fits. The deliverable before any code is the workflow itself: phases, the evidence each phase produces, and the conditions that stop the run. Write it down, then act.

Use when the work is too large or too novel for `delegate`, `arena`, or `swarm` alone: a migration, a multi-part change, or work the operator leaves and reviews later. If an existing skill does cover it, follow that skill instead.

## Frame

State these in `work/<task>.md` before the first step.

- **Goal and done predicate.** The operator's goal in one sentence, and a check that can pass or fail on the real artifact.
- **Scope, quantified.** The units you expect (files, call sites, surfaces) and the rough effort. Name what is out of scope.
- **Risks.** The one-way doors: data migration, public API, deploy, deletion. Everything else is reversible.
- **Rigor.** Set it per risk: a gate and a written artifact for each one-way door, a lighter check for reversible steps. Rigor is evidence, not "be careful".

Checkpoint the framing with the operator only when a wrong direction would cost more than the pause. Reversible work proceeds.

## Write the playbook

List phases in order. Each phase carries these fields.

| Field | What it holds |
| --- | --- |
| Purpose | The one thing this phase decides or produces. |
| Artifact | The file, commit, measurement, or report it leaves behind. |
| Evidence | The exact command whose output proves the phase. |
| Exit criterion | The observable state that lets the next phase start. |
| Stop condition | What ends the phase early, and what you report then. |
| Owner | The route or session that does it. |

Order the riskiest unknown first. Build the harness before the feature, with the baseline captured before the change. Fan out only across seams that share no state, and give each worker its own worktree (`delegate`). Use `arena` for a design fork and `swarm` for coverage. Do not add a phase you cannot check.

## Run

Each phase is an experiment. State the hypothesis, make the smallest change, measure against the done predicate, keep it if it advanced, revert it if it did not.

- One unit at a time. Verify it before starting the next.
- A verdict is `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`. Inconclusive is not a pass.
- Two failures that share one premise mean the premise is wrong. Rewrite it instead of writing a third fix that assumes it.
- A worker's self-report is a claim. Read the diff and run the command.

## Stop

Stop and report when the predicate holds, a stop condition fires, the operator's gate is reached, or two premise failures show the plan is wrong. Say which one fired. A stop is a report with the state and the next decision, never silence.

## Hand back

Check the whole against the done predicate, not only the per-phase checks. Encode each repeated correction as a check, and update the pack when the lesson is about how the staff works (`improve`).

Log phases and decisions in `work/<task>.md`, with `decisions.tsv` rows for an unattended run, following `show-me-your-work`.

Reply with the playbook path, the rigor level and why, what is verified, what is open, and each guess.
