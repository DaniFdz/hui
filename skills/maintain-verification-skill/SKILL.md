---
name: maintain-verification-skill
description: "Use when a project's verification skill or feature map may have drifted from the app: parallel source readers per feature, one live pass that drives every feature, and at most one PR of proven corrections."
---

# Maintain a verification skill

A feature map rots the moment the app changes. This is the upkeep loop for a
skill that create-verification-skill generated, or any project-local verifier with
launch and drive instructions plus a feature map. The unit of rigor is the
feature, not every sentence: cover every feature from source, exercise every
feature live, and ship corrections you can prove.

## Outcomes

Pick one and say which:

- **clean**: every feature got source and live coverage and nothing is worth
  shipping. No branch, no PR.
- **changed**: one PR ships proven corrections to the map, the harness or the
  instructions.
- **blocked**: coverage could not finish, or a proven correction could not ship
  safely. Say exactly what blocked it.

## Edit scope

Edit only the verification skill's own directory: its SKILL.md, its feature map
and the harness scripts it owns. Never edit product code during a run. A behavior
the map describes that the app no longer does is either doc drift (fix the map) or
a product regression (report it, do not paper over it in docs).

## Pass

0. **Locate the target.** The project skill whose body has launch and drive
   sections and a feature map, for example under `.agents/skills/` in HUI. Several
   candidates means ask which one; none means stop and point at
   create-verification-skill rather than inventing a target.

1. **Index hygiene.** Read the map's index and list its sibling files. Fix
   missing, extra, duplicate or dead entries. Keep this light.

2. **Source wave.** One read-only subagent per feature file, launched together
   (`sessions_spawn` in HUI). Each answers "how does this user-facing feature
   work?" from source, flags likely drift with citations, and returns one concise
   live recipe. Children never drive the app and never edit files. Return shape:
   summary, source entry points, likely drift or none, one recipe.

3. **Reconcile.** Every feature file has a summary. Merge overlapping recipes into
   as few app states as practical. Spot-check each cited drift; do not re-prove
   clean claims. Sweep recent changes for user-facing surfaces missing from the
   map, and require a concrete source path before calling one missing.

4. **Live pass.** Required even when source looks clean, and the coordinator owns
   all driving. Follow the verifier's own launch model: one long-lived instance
   driven serially for servers and UIs, or a fresh isolated session per drive for
   short-lived CLIs. Hold three invariants whatever fails:
   - Health-check before driving, again after anything surprising, and again
     after a failed drive. Where the check cannot see the failure, reset to a
     known state or relaunch instead of hoping.
   - Evidence captured so far survives every cleanup, confirmed at its named
     location rather than assumed.
   - Nothing a drive started outlives that drive's usefulness. Clean failed
     residue whether the session is stuck, exited or shared; for a shared
     instance clean the residue, not the instance.

   Exercise every feature at least once. A health-check failure caused by drift in
   the skill is drift: fix it under edit scope, retry once, restart only what the
   fix invalidated. Call a feature `verified-unreachable` only with the concrete
   prerequisite and the route attempted; a prerequisite the map omits is drift.
   Re-drive every harness fix live before it ships, and tear down after the last
   drive of the run.

5. **Triage.** Wrong or missing user point of view: doc drift, fix it. Working
   behavior the harness cannot reach: harness gap, fix it, keep the helper
   executable and its invocation documented in the skill body. Broken app
   behavior: product gap, record it for the operator and keep it out of this PR.

6. **Ship or stop.** For changed: one PR of proven corrections, every changed file
   reread first, and the verifier's own proof standard met for each correction.
   For clean or blocked: no PR, and a report that does not overstate coverage.

Keep short run notes in a scratch location (features covered, unreachable
prerequisites, confirmed drift, outcome). Do not commit them.
