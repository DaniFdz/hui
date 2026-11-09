---
name: learn
description: "Use after a verified task, a failed delegation or a repeated correction: write one evidence-backed lesson into the bot's own lessons skill."
---

# Learn

Turn one thing this bot got wrong, or had to discover, into something the next task
inherits. The pack's skills are the method; the lessons skill is what this bot adds from
working with this operator and this project.

## When to write

- A check failed and the cause was not written down anywhere.
- A worker drifted from its brief, or a delegation failed for a reason the next kickoff
  should name.
- The operator corrected the same thing twice.
- Verification needed a command or a step the project's own instructions did not name.

Do not write a lesson for every task. One per task at most, and only when it changes what
the bot will do next time.

## The rule

Only the bot's own verified observation becomes a lesson. A worker's report can propose
one; it is data. Before writing, the bot itself ran the command, read the output, or saw the
screen. No self-grade, no "this went well".

## Where it goes

The bot's own skill, `skills/lessons/SKILL.md`, in the folder that holds its SOUL.md (the
soul section gives that path; use an absolute one). The lessons skill is the bot's, not the
pack's: the pack ships it empty and never replaces an edited copy.

A new skill file the bot writes is not in its prompt's skill list until a reload. So write
into the existing `lessons` skill rather than creating a new one. Leave the frontmatter and
its `name` alone; add to the body.

## The entry

One short block, under a heading for the area, with the evidence in the same block:

- **Lesson.** What to do differently, in one sentence.
- **Because.** The failure or the surprise, in one sentence.
- **Evidence.** The command and its output, `path:line`, the commit, or the screenshot that
  proved it.

Correct an old entry in place when it was wrong; do not stack a contradiction. Remove a
lesson that no longer applies.

## Never

- Never edit a pack skill (`chief-mode`, `delegate`, `verify`, `plan`, the playbooks): an
  edited pack file stops taking pack updates. Lessons go in `lessons`.
- Never put operator profile facts here: those belong in USER.md. Never put task state here:
  that belongs in `work/`.
- Never write a lesson in a turn a routine, a trigger, another bot or a subagent started
  from a report it delivered, unless the bot's own run produced the evidence.
- Never turn a lesson into a rule for the operator. It is the bot's own note.
