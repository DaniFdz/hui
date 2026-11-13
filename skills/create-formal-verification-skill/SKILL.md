---
name: create-formal-verification-skill
description: "Use when a race, protocol, state machine or unsafe block costs too much to leave to tests: verify its riskiest property with a model checker, prover or code-level verifier, generate a project-local skill with the exact commands and a feature map, and prove the check catches a broken version."
---

# Create a formal verification skill

A test covers the cases someone thought to write. A formal check covers every
case in a stated scope: every order of steps in a model, every input up to a
bound. Verify the one property where a break hurts most and tests reach least,
then leave a project-local skill that makes the check cheap to rerun. Write it
for an agent that reads it cold, mid-change.

## 1. Choose the property

Look for a promise where a break harms users and tests rarely reach the breaking
case: interleavings of two writers, a retry after a partial failure, a parser fed
hostile bytes, ownership across threads, a recovery path that runs only after a
crash. Ask the operator only what you cannot observe. Prefer it over the property
easiest to check. One property in one sentence, plus the harm, is the target.

## 2. Choose the tool by the question

Pick the cheapest tool that answers it, and say why.

- TLA+ with TLC for protocols, queues, locks and state machines: whether a bad
  interleaving or a lost update is reachable in a small model of the design. It
  is the default for ordering questions in any language.
- Lean for a property that must hold at every size, where a bound is not enough
  and the proof is the artifact.
- Kani for Rust: memory safety, overflow, panics and assertions in the real code,
  under bounded inputs.
- Any verifier the project already uses or installs with its own commands.

When no verifier runs on this language, say so and check the real code with
generated inputs. Never hand-model a function and call that a proof of the code.

## 3. Make it true to the code

- Every action in the model points to a file and function a reviewer can open.
- One indivisible step in the code is one indivisible step in the verification.
- Names come from this repo, and the model is small enough to read in one sitting.

## 4. Make it able to fail

A check you have never seen fail proves nothing. Break the code on purpose
(remove a guard, reorder a step), watch it fail, and keep the counterexample. Do
it for every property: an unrun skill is a draft.

## 5. Keep findings as findings

If the current code breaks the property, report it with the counterexample in the
code's terms. Never weaken the property or the model to reach a pass, and leave
product code alone unless the operator asks.

## 6. Generate the project skill

Write it at `.agents/skills/verify-<area>/SKILL.md` unless the repo keeps skills
elsewhere, and link it from the contributor or agent guide. Use real paths,
commands and nouns, with no placeholders:

- Frontmatter with `name: verify-<area>` and a description of when to use it.
  Without it the skill never registers.
- What is verified: the property in one plain sentence, the harm in another.
- How to run it: one command, a pinned tool version, a run short enough to rerun
  on every relevant change.
- How to read a result: a pass, an invariant violation, and the counterexample in
  the code's words.
- A coverage map: the files and functions each check describes, plus the commit
  where the verification last matched them.
- Updating it: move the sync commit only after confirming the verification still
  describes the code.

## 7. Seed the feature map

Create `features/README.md` in the skill, and one file per verified property: what
it promises, its source entry points, the check that covers it, the failure it
would catch, and the gotchas (bounds, assumptions, what it leaves out).

## 8. Prove the skill before handing it over

Follow the skill once, as the next agent would, on a scratch change that breaks
the property. It must catch the break. Then drop the change and confirm the check
is back to where it started. Fix the skill, never the change.

## 9. Hand off

State what is verified, which tool and why, the bounds, what the check found in
plain words, how to run it, and what it does not cover. Name the command to run
before touching verified code and point at maintain-formal-verification-skill.
