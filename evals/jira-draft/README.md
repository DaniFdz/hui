# Jira draft eval

Drafts a set of synthetic sessions with a real utility model and grades each
draft deterministically: a model draft (not the local fallback), the session's
goal in the summary, no tail topic in the summary, required facts and headings in
the description, and an acceptable parent.

```sh
npm run eval:jira-draft -- --model opencode-go/gpt-5.6-luna --runs 3
npm run eval:jira-draft -- --model <model> --case webhook-retries-lint-tail
npm run eval:jira-draft -- --model <model> --context legacy   # previous tail-only context
npm run eval:jira-draft -- --model <model> --thinking auto,off # interleaved reasoning A/B
```

It calls a paid model, so it is not part of `npm test`. Drafts use production
behaviour (25 s per attempt, one retry after an empty or stalled attempt) and the
report counts retries; `--timeout <ms>` replaces the per-attempt limit to measure
raw latency. Full results are written to a JSON file in the system temporary
directory.

Cases live in `cases.ts`; each targets one way a drafter loses the goal (a long
unrelated tail, resume prompts, a scope change, pull request chatter, side
questions, a tempting parent). Keep fixtures invented: never paste real sessions,
which can contain private or employer data.
