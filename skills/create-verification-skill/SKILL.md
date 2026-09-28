---
name: create-verification-skill
description: "Create a verification skill for a project: inspect how its real UI, CLI or service runs, build a reproducible control workflow and feature map, then prove one journey end to end. Use when asked to create a verifier or when a project needs one; use an existing project verifier for routine checks."
license: MIT
metadata:
  tags: "good practices"
---

# Create a verification skill

Generate a project-local verifier for the next agent to read cold. This is the
generator, not a verifier for HUI or a dependency on any particular editor.
Upstream attribution and adaptation notes are in [UPSTREAM.md](references/UPSTREAM.md).

## 1. Interview the repository

Read its contributor/agent instructions and inspect existing verification skills,
scripts, tests and documentation before adding another harness. Answer from code:

- **Surface:** what does the user touch: web, desktop, mobile, CLI/TUI, API or
  library? Select a primary surface and identify secondary entry points.
- **Run:** exact documented build/start commands, dependencies, ports, auth,
  environment and seed data. Use project commands before generic recipes.
- **Drive:** existing browser automation, PTY/terminal helpers or HTTP clients.
  Reuse a working driver; add a small CLI/helper only for a concrete missing seam.
- **Observe:** screenshots, accessible state, transcripts, responses, logs, exit
  codes, persisted data and side effects that distinguish success from appearance.
- **Isolate:** checkout/worktree, build identity, owned processes, ports, data and
  browser profiles. Determine whether concurrent runs really can coexist.

Build/start the selected surface. Resolve in-scope startup defects or report the
exact blocker; do not teach untested commands against a broken base. Mark any
necessary disposable scaffolding as a fixture and include it in cleanup. Ask
only for facts the repository and available tools cannot establish.

**Done:** surface, real commands, observable success and isolation limits are known.

## 2. Select discovery and control adapters

Read [agent compatibility](references/agent-compatibility.md). Extend an existing
project verifier when it covers this job. Otherwise use the repository's skill
convention; if none exists, place the canonical source at
`.agents/skills/verify-<app>/SKILL.md` and link it from the relevant `AGENTS.md` or
contributor guide. Verify the current host can discover or explicitly read it;
do not assume every agent scans the same directory. Keep a single maintained
source, and use host-specific registration only where needed.

Choose available capabilities, not a vendor-specific tool name: owned browser
tabs with snapshots/input/capture for UI, isolated PTYs for interactive terminals,
HTTP for services, and consumer-facing calls for libraries. Record unavailable
capabilities as proof gaps rather than replacing real UI interactions with API
calls. Do not install an editor, plugin or cloud agent just to satisfy a recipe.

**Done:** the output path, discovery mechanism and usable driver are explicit.

## 3. Generate the project verifier

Write valid YAML frontmatter with `name: verify-<app>` and a description identifying
the application, surface and verification trigger. Resolve paths relative to the
checkout containing the verifier, not the agent's initial working directory.
Use these sections, grounded in observed commands/selectors, with no unresolved
example commands or placeholders:

- **Launch:** exact build/start/seed commands and observable readiness. Use fresh
  state, available ports and owned process handles; record checkout, branch,
  commit and dirty state. For short-lived CLI/TUI flows, build once and launch
  each drive in its own isolated terminal. Do not switch or restart a shared
  checkout/instance. State any concurrency restriction explicitly.
- **Doctor:** a read-only check for correct process, port ownership, build/commit,
  data/profile isolation, auth and backend binding. A healthy unrelated server
  is not a pass. Run before driving and final capture; relaunch/recheck after
  changes that invalidate build identity. Explain recovery for each failure.
- **Drive:** exact real user paths, stable roles/names/selectors or CLI commands,
  required state and observable completion. Refresh observations after navigation
  or stale handles. Wait on state, not elapsed time. Internal setters, DOM changes
  and test-only APIs may seed fixtures but cannot prove a user interaction.
- **Evidence:** capture actions and resulting state, then independently verify
  persistence or other side effects. Distinguish live integrations, deterministic
  providers and seeded presentation. Mock only an existing external boundary and
  say what it does not prove. Inspect what dry-run/test modes actually skip:
  they may still write files, contact services or open a browser. For UI, capture
  and inspect desktop/mobile where relevant plus errors and overflow; screenshots
  alone do not prove backend correctness. Read [evidence delivery](references/evidence-delivery.md)
  for artifact location, provenance and PR attachments.
- **Cleanup:** stop only processes/tabs/data created by this run, including after
  failures. Track handles; do not kill by broad process name. Keep proof artifacts
  outside disposable application state so they survive cleanup and delivery.
- **Helpers:** document each shipped helper's invocation and prerequisites, mark
  runnable scripts executable, and verify them. Prefer small composable commands,
  structured output and actionable errors over a new orchestration framework.

**Done:** another agent can launch, identify, drive and stop the correct instance.

## 4. Seed the feature map

Create `features/README.md` and the top three to five identifiable user features,
or fewer for a small product. Read [the feature-map example](references/feature-map-example/README.md)
for structure, not runnable commands: Notes and `control-notes` are illustrative.
Each feature names its user-visible purpose and uses these four H2 sections:

1. `Sub-features`: short behavior IDs.
2. `How to get to it (user POV)`: actual user entry points.
3. `Driving it with <actual harness>`: preconditions and action/command/result pairs.
4. `Gotchas`: traps, state constraints and explicit skipped paths.

Link the index from the generated verifier. Use actual paths/selectors and define
an observable end state; do not duplicate the full product specification. One
convenient entry point does not prove all the others listed in the map.

**Done:** the index resolves and each mapped feature has a reproducible proof recipe.

## 5. Prove the generated instructions

Follow them end to end: launch, doctor, drive one mapped feature through its real
surface, capture and inspect evidence, verify the result, then clean up. Re-run
cleanup after failed attempts too. Confirm owned resources stopped and proof
files still exist. Fix observed harness or instruction failures and repeat the
affected flow. For an existing verifier, prove the changed journey instead of
generating a competing skill.

Record the tested revision, commands/actions, assertions, fixture type, evidence
and limitations outside the skill. A never-executed verifier remains a draft;
identify its blocker and do not claim the whole feature map was exercised.

**Done:** one real journey passed, evidence survived cleanup, and claims match scope.

## 6. Hand off and maintain

Follow the project's review workflow for the verifier, map and helpers. Deliver
evidence using the selected host's attachment capability and the project's PR
rules. Explain how to invoke/discover the verifier. Keep it and the affected map
entries current in the same change that updates user paths; report product bugs
instead of changing the map to hide them. Re-run affected journeys after repairs.
Do not require another pstack skill or schedule recurring maintenance implicitly.

**Done:** the next agent can find the verifier and the reviewer can inspect its proof.
