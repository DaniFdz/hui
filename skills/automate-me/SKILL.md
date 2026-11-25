---
name: automate-me
description: "Use when the operator says automate me, set up or refresh a bot for how I work, or capture my working style: read their recent sessions and bot transcripts, then propose a SOUL.md, optional skills and a first conversation plan as text in the chat."
---

# Automate me

Turn how the operator works into a HUI bot they will keep: one drafted SOUL.md,
the skills it should carry, and a first conversation that starts it.

Propose text, never write it. `write_soul`, `update_user`, `update_memory` and
every other write tool stay untouched here, even when the operator says "just do
it": those run inside a bot's own chat, from the operator's own message. The bot
writes itself there, or the operator pastes the draft in. Say this once at the top
of your reply.

## 1. Gather evidence

- `sessions_list`, then `sessions_history` on the sessions where the operator
  directed work: corrections, rework, the checks they demanded before believing a
  result.
- For an existing bot, `hui bot history <bot>` reads its transcript; `hui bot soul`
  and `hui bot user` read what it already is. Read zoomed ranges, not whole ones.
- Stay inside the sessions you were given and the bots the operator named. Do not
  read unrelated projects, other people's chats, or credential stores.
- With almost no history, say so and work from this conversation instead of
  inventing a work style.

## 2. Infer the patterns

- Delegation: what they hand off, what they keep, how much parallel work they want.
- Verification posture: what "done" means to them, and the evidence they ask for.
- Corrections they repeat: tone, length, format, "stop explaining", "show me".
- Sequencing: worktrees, commits, one change per PR, phases.
- Tools and skills they reach for by default.
- Open questions: do they want options, or a decision and a reason.

Codify a pattern seen twice or more. Drop lone signals and anything the operator
contradicted elsewhere.

## 3. Ask what history cannot show

Two or three questions with options rather than blank text: what the bot owns,
when it may reach out unasked, what it must never touch. Then one free question.

## 4. Draft SOUL.md

Use the sections a HUI bot is prompted with, so the file reads the way the runtime
expects: "Who I am", "What I look after", "How I work", "When I reach out",
"Boundaries". Write in the bot's voice, timeless, with no dates and no "they told
me on Tuesday". It is read on every request, so every line costs every turn: one
screen at most. Keep it about the bot, since what the operator prefers belongs in
USER.md, durable knowledge in MEMORY.md, and events in the chat.

## 5. Name the skills it needs

List project skills by name and where they live, or say that none are needed.
Never paste their bodies.

## 6. Plan the first conversation

Three to five lines: what it opens with, the questions it asks, when it saves
SOUL.md and USER.md, and the real work it starts on. Real work first, not an interview.

## 7. Files and privacy

Name the four bot home files and their owners: SOUL.md is the persona, written
with `write_soul`; USER.md is what it knows about the operator, `update_user`;
MEMORY.md is what it keeps, `update_memory`; BOOTSTRAP.md is the operator's
onboarding body, read while SOUL.md does not exist. SOUL.md and BOOTSTRAP.md
travel in an export. USER.md and MEMORY.md never do.

Exclude credentials, tokens, hostnames, internal URLs, customer or colleague
data, and any personal fact the bot's work does not need. Say in your reply that
the draft holds none of it.

## 8. Deliver and iterate

Present the SOUL.md in one fenced block, the skill list and the first conversation
plan. Take feedback and cut ruthlessly. Then say how it lands: create the bot and
let it open, paste this soul in, or tell the bot to write it verbatim.

## Guardrails

- One bot, one job. A persona that does everything does nothing well.
- Reference other skills instead of restating them.
- Write about "the operator", not their first name.
- Invent no tool, command or path: only what this HUI and this project have.

When the request is a task skill rather than a working style, skip the mining.
