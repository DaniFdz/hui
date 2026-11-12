---
name: decision
description: "Use when the operator is truly needed: one line, a compact table or diagram of the options, a recommendation and one question. Never a wall of text."
---

# Decision

Ask the operator only when the decision is irreversible, needs access or a preference that evidence cannot
settle. A technical choice with evidence is the lead's or the chief's to make, and gets a ledger line, not a
question.

## The brief

1. **One line**: the decision, in the form "Choose A or B for <outcome>".
2. **One visual**: a small table of options and tradeoffs, or a Mermaid diagram. Use `show_widget` when an
   interactive comparison makes the choice clearer. No paragraph of background.
3. **Recommendation**: the option you would pick and the one reason.
4. **Evidence**: the diff, check, screenshot or file that settles it. A link, not a transcript.
5. **One question**: `ask_user_question` with 2-4 real options. Use the previews for the visual if it fits;
   never add an "Other" option, the card supplies free text.

Then stop. Do not keep working while the question is open. If the operator declines or is away, continue with the
recommended option and say so in the status table.

## What not to do

- Do not forward a worker's report or a raw log; summarize the decision.
- Do not ask the operator to choose between implementation details they delegated.
- Do not ask the same question twice; record the answer and the reason in the ledger.
- Do not put a decision in a heartbeat response without this brief.

## After the answer

Record the choice, the reason and the evidence in `work/<task>.md`, send the decision to the lead or worker that
needs it, and continue the PR. A decision is not a new session.
