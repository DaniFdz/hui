# Eval

You own the experiment: frame it, blind it, run it, read it.

1. Frame the variant under test and the behavior that counts as success. Write a rubric of 3
   to 6 concrete criteria for the judge only, and hold it back from every candidate.
   Evidence: the rubric path, outside every candidate directory.
2. Sanitize what a candidate sees. No `eval`, `test`, `judge`, `rubric`, `score`, `candidate`,
   `benchmark` or `arena` in a directory, file or prompt it reads. Use project-shaped names.
   Never say other candidates exist.
   Evidence: a listing of each candidate's directory and prompt.
3. Write one organic prompt, what the operator would type, stating the goal and never the
   measurement. Every arm gets the same prompt, the same fixture state and its own copy of the
   tree.
   Evidence: the prompt file and the fixture setup command.
4. Run N arms from one `codemode` script with `collect: true` and `agents_wait`. Give each arm
   a different model through a route or a raw `provider/id`, spread across families where more
   than one is available, and record the route and provider id per arm.
   Evidence: the ledger rows with route, provider id and child id.
5. Spawn one judge on a different family from every arm, blind: it sees the rubric and the
   outputs by label, never a model name, a route or an arm number.
   Evidence: the judge's per-criterion scores and its recommended arm.
6. Verify the chain from transcripts, not self-report. Read each arm's own history with
   `sessions_history({ sessionKey, includeTools: true })` and list the files it actually
   opened. Grade chain-following from what it read and the shape of what it produced.
   Evidence: the file list per arm and the shape observed.
7. Read every output end to end yourself and compare with the judge. Disagreement means the
   rubric is ambiguous or one of you is biased; say which and why.
   Evidence: the outputs read and the synthesis.
8. Keep the harness under `evals/<name>/` with cases, a runner, a grader and a grade test,
   wired to an npm script like `npm run eval:jira-draft`.
   Evidence: the script name and `npm test -- evals/<name>/grade.test.ts`.

## Reply

The variant under test, the rubric, per-arm notes with route and evidence, the judge's verdict,
the synthesis, and whether to promote the variant.
