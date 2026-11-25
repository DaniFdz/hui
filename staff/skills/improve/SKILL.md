---
name: improve
description: "Use when the operator, a review, or a failed run corrects the same thing twice: fix it at the highest level and prove the enforcement with a run."
---

# Improve

Turn a repeated correction into a rule the work enforces. Text an agent can skip is not a fix.

Use when the same correction arrives twice: from the operator, a review thread, a revert, or a failed run. One-off feedback stays a conversation.

## Mine the classes

Read the evidence, not the complaints: recent commits and reverts, review comments, `work/decisions.tsv`, past `sessions_history`, the skill files, and the rules in `AGENTS.md`. Group the corrections into classes. A class counts once it has happened twice.

For each class, write one line: what the agent did, what it should have done, and where it happened.

## Pick the highest level

Work down this list and stop at the first level that can prevent the mistake.

1. **Architecture.** Give each piece of state one owner and each task one supported way. Delete the wrong way so that copying it fails. Subtract before adding.
2. **Types.** Make the bad state unwritable and the good path the only one that compiles.
3. **Lint or CI.** Fail the build with an error that names the replacement file, type, or function. If the pattern is already common, fail only when a change adds more.
4. **Test.** Assert the behavior, so the test fails when the behavior breaks and passes when only internals change. Delete a test that passes on broken behavior.
5. **Docs and rules.** `AGENTS.md`, a project skill, or a staff skill, only for judgment that nothing can enforce. Last resort, not first.

## Encode and prove

Write the check into the repository, not into the conversation. Prefer a script, a lint rule, a template, or a scaffold over prose an agent can skip.

Then prove it:

- Reintroduce a real past mistake in a throwaway commit or fixture. The new check must fail and name the fix.
- Run the same command on the fixed tree. It must pass.
- Run it the way CI runs it, so local and CI cannot drift.

An exception gets a reason, an expiry date, and the operator's approval on the offending line. Delete a rule once its mistake can no longer happen.

## Update the pack

When the class is about how the staff works, edit the owning skill in the staff pack: the brief in `delegate`, the rubric in `arena`, the cap or report shape in `swarm`, the row format in `show-me-your-work`. When it is about how this repository is built, edit the project skill and its enforcement in the repository. One home per rule. Point to the other skill instead of restating it.

Record the class, its evidence before and after, and the proving command in `work/<task>.md` and the ledger row (`show-me-your-work`).

Reply with each class, its evidence, the level you chose, and why the levels above it could not work.
