---
name: principles
description: "Use when scoping, building, debugging or reviewing work: the 24 working principles of this pack, each with when it applies, and full guidance for the ten that change behavior most."
---

# Principles

How this pack works. Find the moment in front of you in the table, then read the
full guidance below if that principle has an entry. Cite a principle by name when
it decides something, and do not stack several.

| Principle | Apply when |
| --- | --- |
| Laziness protocol | Refactoring, or tempted to add a layer: the smallest change wins. |
| Foundational thinking | Choosing types, data shapes, or what to build first. |
| Redesign from first principles | A new requirement lands in an existing design. |
| Attack the premise | Two or more fixes on one premise failed the same gate. |
| Subtract before you add | Starting an addition, refactor or rewrite. |
| Minimize reader load | Code is hard to trace: too many layers, too much state. |
| Outcome-oriented execution | A planned rewrite or migration with phase boundaries. |
| Experience first | Product, UX or scope tradeoffs come up. |
| Exhaust the design space | A novel interaction or architecture with no precedent. |
| Build the lever | Work is more than a couple of obvious edits. |
| Model the domain | Stateful logic, or branches that keep growing per feature. |
| Boundary discipline | Wiring validation, error handling or framework adapters. |
| Type system discipline | Designing types or reviewing a signature. |
| Make operations idempotent | Commands, lifecycle steps or loops that meet crashes. |
| Migrate callers then delete legacy APIs | A new internal API with old callers. |
| Separate before serializing shared state | Concurrent actors may write the same state. |
| Prove it works | Before you say done. |
| Fix root causes | Debugging any symptom. |
| Sequence into verifiable units | Multi step work, commits, stacked PRs. |
| Test behavior not implementation | Writing, changing or keeping a test. |
| Explain the number | Measuring, trusting or reporting a number. |
| Guard the context window | Large outputs, long files, fan out planning. |
| Never block on the human | Tempted to ask "should I do X" on reversible work. |
| Encode lessons in structure | Writing the same instruction a second time. |

## Full guidance

### Laziness protocol

- Make the smallest diff that solves the problem. Fewer lines beat elegant boilerplate.
- One decision, one place. Do not repeat the same choice across files.
- No abstraction without a second caller, no layer without a decision to hide.
- Deleting is the preferred edit.

### Attack the premise

- Write the premise as the one sentence every failed fix assumed.
- Find an observation that differs if the premise is false, and make it.
- If the evidence contradicts it, the cause is elsewhere. Otherwise ask why again.
- Remove the condition that causes the failure instead of compensating for it.

### Subtract before you add

- Read the target and list dead code, redundant validation, stubs and stale docs.
- Delete that first, in its own diff, then build on the smaller base.
- Leave the design simpler and no less capable than you found it.

### Build the lever

- Do the first unit by hand to learn the recipe, then write the script or codemod.
- Rerun it on that unit and diff against the hand version before you trust it.
- Make it safe to rerun and keep it in the diff, so a reviewer reruns the work.
- A one off still earns a lever when the lever is what makes the result checkable.

### Prove it works

- Name the command, request or screen that would show the behavior, then run it.
- Read the real value: process state, response body, written row, file. Not a
  cached summary or a log that claims success.
- When a check fails, suspect the observation before the system.
- Script the check when it will run twice, and keep its output as the artifact.

### Fix root causes

- Reproduce, then ask why at each step until the answer is a wrong decision in code.
- A guard, retry or clamp that hides a symptom is not a fix.
- Decide whether the triggering state is legitimate, and handle it where it belongs.
- Search for the same fault elsewhere and fix every instance.

### Sequence into verifiable units

- Break work so each unit ends in a state you can check, and check it before the next.
- Commit and stack in that order, so a reviewer watches it go green unit by unit.
- A break found after a batch is buried. Localize it at the unit that caused it.
- Never build on a red unit.

### Test behavior not implementation

- Assert what a caller, a user or another service can observe.
- Two imagined edits: change the internals and the test still passes; break the
  behavior and it fails.
- Drop tests that only protect today's call order or a helper's name.
- One behavior per test, named for the promise it defends.

### Never block on the human

- Reversible work proceeds. Present the result and the reason.
- Reserve confirmation for irreversible acts: deleting data, force pushing,
  sending externally.
- State the decision where the operator will look for it.
- Ask only for facts you cannot observe and for product direction.

### Encode lessons in structure

- The second time you write the same instruction, make it a lint, type, script or test.
- Point the check at the failure mode, not the single instance that slipped.
- If the lesson needs judgment, add an example of the failure instead of more prose.
- Ship the structural fix alone; text leaves the cause in place.
