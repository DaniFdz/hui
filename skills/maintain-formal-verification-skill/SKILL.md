---
name: maintain-formal-verification-skill
description: "Use when merges, refactors or other changes touch code that a formal check covers: find the commits that changed verified code, confirm or update the model and properties, rerun, and say per check whether it is in sync, updated, a bug or blocked."
---

# Maintain a formal verification skill

A formal check proves a property of what it describes. When the code changes and
the description does not, the check keeps passing while it describes code that no
longer exists. That pass is the dangerous case, because it looks like a proof.
This is the upkeep loop for a project-local skill that runs a model checker, a
prover or a code-level verifier against named code.

## Outcomes

Give each check exactly one, and say which:

- **in sync**: nothing since the sync commit alters what the check describes, and
  it passes.
- **updated**: the code changed, the verification now describes the new code, and
  it passes. One check can be both updated and bug: the update makes the
  description true and the property then fails on it.
- **bug**: the verification describes the current code and the code breaks the
  property. This is a finding about the code, not drift.
- **blocked**: the check could not be brought in line or could not run. Say why.

## Edit scope

Edit only the verification: models, harnesses, property files, the coverage map
and the skill itself. Never touch product code during a run unless asked. A
property that fails on the current code is reported, not weakened.

## Pass

1. **Find the checks.** Look in the project's skill directory (`.agents/skills/`
   in HUI) for a skill that runs a verifier against named code, or take the one
   the operator named. Collect per check: the property, the covered files and
   functions, the bounds and assumptions, the command, and the sync commit. No
   such skill means pointing at create-formal-verification-skill; no sync commit
   means the last commit that changed the verification files, and say so.

2. **Run it as it is.** Run each check once before changing anything, and record
   the result. A pass here says the old description still holds, not that the code
   is correct. A failure is drift or a bug, and you do not decide which yet.

3. **Read every change to covered code.** Diff the covered files from the sync
   commit to HEAD, and read the messages. Include renamed, split and moved code,
   and new code that reaches the guarded state, such as another writer of the same
   fields. Then classify each change:
   - **No effect**: formatting, comments, paths the verification does not model.
     Check it against the model, not against the commit message.
   - **The description is stale**: a step became two, a branch appeared, a check
     moved, a value took a new range. The model or harness has to change.
   - **The promise changed on purpose**: the doc comment, tests, changelog or
     commit message says so. Change the property and cite that evidence.
   - **The promise may be broken**: the code changed and nothing says the promise
     did. A failure that follows is a bug candidate.

4. **Update from the code, not from the result.** Rewrite the changed parts so
   each again points to code a reviewer can open, keeping one step in the code as
   one step in the model. Write the update before you rerun and never shape it
   around what makes the check pass. Change a property only for a promise that
   changed on purpose, and record the old wording, the new wording and the
   evidence. Keep the bounds unless the change makes them wrong.

5. **Rerun and judge.**
   - Pass: break the new code the way the property guards against and confirm the
     check catches it, then drop the break. Otherwise the pass proves nothing.
   - Fail: replay the counterexample against the real code, step by step. A step
     that cannot happen in the code is a modeling error, so fix the verification
     and say what was wrong. If every step can happen, it is a bug: name the
     commit, tell the counterexample in the code's words, and state the harm in
     one sentence. Add a cheap repro against the real code as evidence if you
     have one, without committing it to product code.

6. **Update the skill.** Move the coverage map, commands, bounds and assumptions,
   and move the sync commit unless the check is blocked. Then follow the skill once
   as the next agent would, so you know its steps still run.

## Report

Per check: the outcome and the commits you read; what changed in the verification
and why, with the evidence for each promise change; the rerun result and the break
that showed the updated check can still fail; each bug in plain words with its
counterexample, harm and introducing commit; and the code the verification still
does not cover. Say which failures were drift and which were bugs, and that a
check passing before an update and failing after it passed on a stale description.

Ship the verification update as its own change, separate from any product fix.
