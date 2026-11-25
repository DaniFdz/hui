# Investigation

Read-only. The deliverable is a cited answer or a recommendation. No diff, no pull request.

1. Restate the question as a claim the repository can settle, and name what would refute it.
   Evidence: one line in the first reply and the ledger row.
2. Split it into 2 to 4 angles of the subsystem (entry point, state, transport, rendering,
   persistence). One `explorer` per angle, spawned with `collect: true` in one `codemode`
   script and awaited with `agents_wait`.
   Evidence: each walkthrough with `file:line` per claim, plus the angles that found nothing.
3. Answer a "why is it this way" question from history before opinion. Use `git log --oneline`, `git blame -L <start>,<end> <path>`, `gh pr view <number>` and `gh pr checks <number>` for each substantive commit.
   Evidence: commit SHAs, pull request numbers, and the sentence carrying the reason.
4. Read the contract: `SPEC.md`, `docs/api.md`, and the nearest `AGENTS.md`. Behavior the spec
   names is a decision, not an accident.
   Evidence: the section and line for each constraint the answer rests on.
5. Answer, then say what the evidence does not settle. A fork between options gets a table of
   option, cost, risk and what each forecloses, then one recommendation and its reason.
   Evidence: the table and, for the recommended option, the check a reader could run.
6. Record an incidental defect with `suggest_task`; do not fix it here. Route to `bug-fix.md` or
   `feature.md` only when the operator asks for the change.
   Evidence: the suggestion id, or `none`.

## Reply

Open with the restated goal. Then the answer, each claim carrying its `file:line` or command
output, under these headings where they apply: Overview, Key Concepts, How It Works, Where
Things Live, Gotchas, Recommendation, Not established. For an "are we sure" question, give the
judgment and push back when the premise is wrong. Close by saying nothing was changed.
