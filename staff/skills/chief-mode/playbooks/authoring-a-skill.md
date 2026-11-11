# Authoring a skill

You own what the skill decides. Keep only prose that changes a decision.

1. State the trigger and the decision the skill changes. A skill that restates knowledge
   already held by a type, a test or a README earns nothing; point at that structure instead.
   Evidence: one sentence naming the trigger and the decision.
2. Pick the location that owns it: a skill shipped with HUI at `skills/<name>/SKILL.md` plus an
   entry in `server/pi/bundled-skills.ts`; a repository-only skill at
   `.agents/skills/<name>/SKILL.md`; this pack under `staff/skills/`.
   Evidence: the chosen path.
3. Write the frontmatter: `name` equal to the directory in lowercase kebab case, and a
   `description` of one sentence that names the trigger. No other key is required.
   Evidence: the first six lines of the file.
4. Write the body as steps with observable endings, commands that exist in the repository, and
   paths that resolve from the skill's own directory. Point at the owning skill, playbook or
   test instead of restating its rules.
   Evidence: each step traced to a command or path that exists.
5. Validate: every referenced path exists (`test -f <path>`), the frontmatter parses, and every
   named command exists in `package.json` scripts or in the source.
   Evidence: the checks and their output.
6. When the skill changes agent behavior rather than only wording, run it through `eval.md`
   before promoting it.
   Evidence: the eval result, or `n/a: wording only`.
7. Run `opening-a-pr.md` under a `docs:` type, naming what the skill now decides and what was
   deleted.
   Evidence: the pull request URL and `gh pr checks <number>`.

## Reply

What the skill now decides, where it lives, what was deleted, and the validation output.
