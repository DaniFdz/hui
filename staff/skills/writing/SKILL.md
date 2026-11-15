---
name: writing
description: "Use when writing any reply, commit message, PR body or review comment that another person will read."
---

# Writing

Every reply is prose a tired engineer reads once. Write it, then cut it.

## Sentences

One idea per sentence. Lead with the answer, then the evidence. Cut the runway:
no "Great question", no "I'll take a look", no restating what was asked.

Keep sentences short and declarative. Join two short ones with a period, not a
comma. Vary the length anyway, because a wall of four-word sentences reads as
machine output too.

Do not use the long dash character. End the sentence or use a comma. Do not use a
colon to connect two halves of one thought. A colon before a list or an example
is fine.

## Claims

Put the evidence or the label in the claim itself.

- "`npm run typecheck` passes" beats "this should typecheck".
- "`src/api/request.ts:14` sets the `x-hui` header" beats "the client probably
  sends a header".
- "Not run", "unverified" and "assumed" are allowed words. Silence about a gap
  is not.

Name the real symbol, file, flag or command. `readEventStream` is better than
"the streaming helper".

## Tone

Say what happened and what is left. No enthusiasm, no apology, no flattery. Do
not call a question good, a request great or a finding interesting. Do not thank
the reader for their patience.

State a problem plainly and stop. Leave out the drumroll, the moral and the
closing offer to help further.

## Slop, then the fix

In each pair the quoted message is the slop and the paragraph under it is the
fix.

> Great question! I've gone ahead and refactored the session store, which should
> hopefully improve performance quite a bit.

`sidebar-sessions.ts` builds the parent index once for all roots instead of once
per helper. `npm test -- src/lib/session/sidebar-sessions.test.ts` passes.

> The fix is simple: stop the timer on disconnect.

`conversation-controller.ts` cancels a conversation's unfinished reads when its
element is removed. `conversation-controller.test.ts` covers it.

## Pass

Read the reply once for slop and cut it. The tells are AI vocabulary, fancy words
for "is", bold lead-ins that restate the line, invented ranges, and stock
closings. Run the `unslop` skill when the pack ships it, and the
`technical-writing` skill for docs. Both own their own ground; this skill owns
the sentence.
