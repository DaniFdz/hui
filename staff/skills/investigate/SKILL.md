---
name: investigate
description: "Use when someone asks how or why something behaves as it does, or what a past change was for, and the answer needs evidence instead of a guess."
---

# Investigate

Answer the question. Read only. Do not branch, edit, stage, file or open a pull
request in the middle of an investigation.

State your reading of a vague question in one line and continue. The operator can
redirect you. A stalled question helps nobody.

## Code

Read the modules the question names, then the modules they call and the ones that
call them. Cite `path:line` for every claim about behaviour. Say when a search
found nothing, because an empty result is an answer and an invented caller is
not.

Read the file header comment first. `docs/map.md` names the owner of each area,
and the header says what that module owns and what it leaves to someone else. A
question about where something should live is answered by that plus the
dependency rules in the same file.

## History

- `git log -S "<symbol>" --oneline` finds the commit that added or removed a
  string, which is usually the decision.
- `git log --follow -p -- <path>` follows a file through renames.
- `git blame -L <start>,<end> <path>` finds the last touch of a line.
- `gh pr view <number> --json title,body,files,comments,reviews` reads the
  reasoning that never reached a code comment. Merge subjects carry `(#123)`.
- `gh issue list --search "<term>"` and `gh search code` cover the rest.

## Written contracts

`SPEC.md` holds decisions with their dates. `docs/api.md` holds the wire
contract. A scoped `AGENTS.md` holds the rule the code is meant to obey. Quote
the sentence that settles the question instead of paraphrasing it.

## Prior context

Read earlier turns of this agent tree with `sessions_history` before asking the
operator to repeat anything. Run `recall` when the work resumes from an earlier
chat and the decision may live outside this conversation.

## Answer

Lead with the answer in one or two sentences, then the evidence in the order a
reader needs it. Mark what is proven, what is inferred and what is unknown, and
keep them apart, because a plausible story with no citation is a guess.

When the question implies a fix, stop at the smallest next step and hand it back
as a proposal. Let the operator start the work.
