# GOAL — Full harness extendability, verified

Program ledger for [PLAN-EXTENDABILITY.md](PLAN-EXTENDABILITY.md). One long-running
goal implements every phase; the phases are checkpoints of **one branch and one
pull request** (see PLAN §7). There is no per-phase PR, no second program PR and no
follow-up PR. Set the goal to:

> Implement all phases of PLAN-EXTENDABILITY.md; verify through GOAL-EXTENDABILITY.md.

Rules for the program session:

1. Read this file first. After an interruption or context loss, resume from
   **§2 Resume point**: never redo a phase marked DONE.
2. Start from `main` when PR #408 is merged, or carry its commits by branching from
   `danifdz/gateway-extensions` when it is not, then cherry-pick the plan commits
   from `danifdz/extendability-plan`; branch `danifdz/hui-extendability`, open **the
   one program PR** as a draft, and keep it draft until P6. Once it is open, close
   #408 and #412 as superseded (their commits are in it), and rebase the draft onto
   `main` when they merge (E23). No second program PR is ever opened.
3. Before each phase: check the PR for unresolved review comments and address them
   first; then record the phase's baseline in its `Runs` block.
4. After each phase: re-run its runs, paste the real output, update this file and
   commit code + ledger together. Push and wait for the required CI jobs on that
   HEAD. Only then mark the phase DONE (with its commit and CI run) in the next
   commit — a ledger-only commit, or the next phase's first commit — and start the
   next phase. A red required check stops the program until it is fixed.
5. A criterion is checked **only** when a run shows it. Anything that could not run
   goes under Proof gaps with the exact command and error. Never weaken, skip or
   delete an assertion to get green.
6. Keep `PLAN-EXTENDABILITY.md` unchanged; only this file tracks state. Never merge
   the PR, never rewrite a DONE phase's history, never start a dependent phase on a
   red HEAD.
7. If a phase cannot pass the same failing check after two focused attempts, mark it
   BLOCKED here with the exact error and stop. P4 does not depend on P2/P3; no other
   phase may skip its predecessors.
8. If the PR is merged before P6, the program ends early: mark the remaining phases
   NOT DONE here, stop, and open **no** follow-up PR. Only the owner merges.

## 1. Program status

| Phase | Scope | Status | Commit | CI |
|---|---|---|---|---|
| P0 | Gateway routes, store, status/toggle | carried in the program PR (PR #408 closes as superseded) | — | — |
| P1 | Settings page + `hui extension list/enable/disable` | NOT STARTED | — | — |
| P2 | Sandboxed panels and the bridge | NOT STARTED | — | — |
| P3 | Prompt sections and agent tools | NOT STARTED | — | — |
| P4 | Server-sent events | NOT STARTED | — | — |
| P5 | Reload, engines, doctor, install/remove | NOT STARTED | — | — |
| P6 | Out-of-process mode | NOT STARTED | — | — |

Statuses: NOT STARTED · IN PROGRESS · BLOCKED · DONE (CI green) · MERGED (owner).

## 2. Resume point

| Field | Value |
|---|---|
| Current phase | — |
| Next action | Create the program branch (from `main` if #408 merged, else stacked on `danifdz/gateway-extensions`) and open the draft PR |
| Branch | — (expected `danifdz/hui-extendability`) |
| Program PR (the only one) | — |
| Last green CI | — |
| Last DONE phase | — (P0 pends #408; stacked start allowed by E23) |
| Baseline | see §3 |

Update this table with every checkpoint, in the same commit as the phase. A fresh
session reads it before touching code.

## 3. Baseline

Recorded once at the program branch point (current `main` after #408):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | — |
| Tests | `npm test` | — (this checkout has a known set of environment-only failures; diff the failure set before and after each phase) |
| Working tree | `git status --short` | — |

```
Baseline result:
Exit:
```

---

## 3. P0 — Gateway routes (PR #408)

Already verified in that PR's own `GOAL.md` (15/15 criteria, manual gateway proof
13/13, CI green). This program consumes it as written; no rework is planned.

---

## 4. P1 — Operator surface

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria** (evidence from the runs below):

- [ ] **P1-A1** Settings → Extensions lists every installed extension sorted by
  id with name, id, description, state chip, route count/methods, and its error.
  With none installed it shows *No gateway extensions installed* and a guide link;
  a store error shows as a banner.
- [ ] **P1-A2** The enable switch calls `PUT /__hui/ext/:id`, is disabled while
  pending, reflects the returned state, and shows a failure without losing the
  previous state.
- [ ] **P1-A3** A fixed trust note states that extensions run with the gateway's
  access.
- [ ] **P1-A4** `hui extension list [--json]`, `hui extension enable <id>` and
  `hui extension disable <id>` work against a running gateway and fail with the
  usual message when none runs.
- [ ] **P1-A5** One new use case `SET-NNN` (web required, iOS excluded with the
  E17 reason and `SPEC.md#extendability`) has a shared e2e test that toggles the
  fixture extension through the page; screenshots at 1440×900 and 390×844 are in
  the PR and the chat, not the tree.
- [ ] **P1-A6** `npm run api:schema` leaves no diff (no API change in this phase).
- [ ] **P1-A7** Focused tests, typecheck, full suite (failure set unchanged) and
  build pass; CI is green.

**Runs**

```
P1-V1  npm run api:schema && git status --short
Result:
Exit:

P1-V2  focused: controller, view/CLI tests, e2e catalogue tests
Command:
Result:
Exit:

P1-V3  npm run typecheck
Result:
Exit:

P1-V4  npm test
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:

P1-V5  npm run build
Result:
Exit:

P1-V6  npm run e2e -- --tag SET-NNN
Result:
Exit:
```

**Manual proof** (Browser tool, isolated launcher): open Settings → Extensions in
the real app, toggle the fixture on, then open it again after reload, toggle it
off; record the observed state changes and the screenshots (desktop and mobile).

```
Result:
```

**Proof gaps:** —

**Deviations:** —

---

## 5. P2 — Sandboxed panels

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria:**

- [ ] **P2-A1** The manifest `ui` entry is validated (`title`, optional
  `entry`, `.html`, relative to and contained in the extension's `ui/` directory)
  and `ExtensionStatus` carries `panel` (`title`, `entry`); a bad manifest fails
  the extension without touching the gateway.
- [ ] **P2-A2** `/__hui/ext-ui/<id>/…` serves only files inside that extension's
  `ui/` directory, before the `x-hui` gate, with the MIME allowlist, 10 MiB cap,
  `nosniff`, `no-store`, same-origin CORP, and a CSP whose `sandbox` makes the
  frame opaque, whose sources are limited to the extension's asset prefix, and
  whose `connect-src 'none'` blocks network access. Traversal, symlink escape, a
  directly opened HTML/SVG staying opaque, and a disallowed method are refused.
- [ ] **P2-A3** Settings → Extensions shows **Open panel** for an enabled
  extension with a `ui`; it opens the Work view on the last shown conversation
  (disabled with *Open a conversation first* when there is none), which renders
  the sandboxed iframe, and the view restores from saved state after a reload.
- [ ] **P2-A4** The bridge delivers `init`, lets the panel call only its own
  declared routes and returns the result, answers `error` for a foreign
  extension's route, an oversized message and a timeout, and enforces the E5
  limits.
- [ ] **P2-A5** `height`, `theme` and `open` work; closing the Work view tears the
  frame and listeners down.
- [ ] **P2-A6** One new use case `WORK-NNN` (web required, iOS excluded per E17)
  has a shared e2e test with a real panel that calls its own route and resizes;
  screenshots at 1440×900 and 390×844 are in the PR and the chat.
- [ ] **P2-A7** Focused tests, typecheck, full suite (failure set unchanged),
  build and CI are green; the runtime bridge refusals are exercised by tests, not
  only by the e2e happy path.

**Runs**

```
P2-V1  assets: containment, MIME, size, CSP, pre-gate
Command:
Result:
Exit:

P2-V2  bridge: init, allowed call, foreign call, oversize, timeout, teardown
Command:
Result:
Exit:

P2-V3  npm run api:schema && git status --short
Result:            (expected: docs/api.schema.json and src/api/schema/extensions.ts
                    gain the panel field; nothing else)
Exit:

P2-V4  npm run typecheck / npm test / npm run build
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:

P2-V5  npm run e2e -- --tag WORK-NNN
Result:
Exit:
```

**Manual proof:** Browser tool opens the fixture panel from Settings → Extensions,
which shows it in the Work pane; the panel calls its route (greeting with a name),
resizes, switches theme and closes; screenshots as above.

```
Result:
```

**Proof gaps:** —
**Deviations:** —

---

## 6. P3 — Prompt sections and agent tools

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria:**

- [ ] **P3-A1** The manifest `prompt` and `tools` entries validate; a bad tool
  schema, a name outside `ext_<id>_<name>` or an oversized section fails the
  extension with a named reason.
- [ ] **P3-A2** The `extensions` prompt section renders between `hui_goal` and
  `hui_ultra` for a Durable session of an enabled extension, honors the E8 caps,
  and a throwing contribution is omitted once with a diagnostic while the turn
  proceeds.
- [ ] **P3-A3** An enabled extension's tools are offered to a new Durable session,
  carry their prompt snippet/guidelines, are namespaced, and a collision with a HUI
  tool refuses only that extension's tool. A session that already started keeps its
  offer.
- [ ] **P3-A4** An end-to-end Durable run with the deterministic provider calls an
  extension tool and receives its result; a throwing tool becomes `isError` text
  and one diagnostic, and the turn completes.
- [ ] **P3-A5** Settings → Extensions shows prompt sections (title + count, text
  behind a disclosure) and tools (name + description) for enabled extensions.
- [ ] **P3-A6** A PI worker session gets none of these contributions (E7), proven
  by a test or a documented, measured inspection.
- [ ] **P3-A7** API schema regenerated and documented; focused tests, typecheck,
  full suite (failure set unchanged), build and CI green; the Settings page change
  has a Browser-tool check and screenshots.

**Runs**

```
P3-V1  prompt assembly (enabled/disabled/order/caps/throwing)
Command:
Result:
Exit:

P3-V2  tool offer + end-to-end Durable tool call
Command:
Result:
Exit:

P3-V3  npm run api:schema && git status --short
Result:
Exit:

P3-V4  npm run typecheck / npm test / npm run build
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:
```

**Manual proof:** isolated gateway + enabled fixture: a Durable session's first
request shows the section and the tool; ask the model to call it and record the
transcript. Settings screenshots.

```
Result:
```

**Proof gaps:** —
**Deviations:** —

---

## 7. P4 — Server-sent events

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria:**

- [ ] **P4-A1** A route declared `stream: true` answers `text/event-stream`; each
  yielded object becomes one `data:` event in order, with a 15 s heartbeat comment,
  and the response closes when the iterable ends. `ExtensionRouteInfo` marks the
  stream and the schema is regenerated.
- [ ] **P4-A2** A client disconnect aborts the iterable's `signal`; a throw ends the
  stream with one `error` event and one diagnostic; the E10 caps end it with a
  named error event.
- [ ] **P4-A3** A streaming handler on a non-streaming route, a non-iterable result
  on a streaming route, and a wrong method are refused (500/405), never a hung
  response.
- [ ] **P4-A4** `docs/api.md` and `SPEC.md` describe the SSE contract and caps.
- [ ] **P4-A5** Focused tests (real HTTP client), order test, typecheck, full
  suite (failure set unchanged), build and CI green.

**Runs**

```
P4-V1  SSE ordering, heartbeat, abort, throw, caps
Command:
Result:
Exit:

P4-V2  wrong handler/result/method
Command:
Result:
Exit:

P4-V3  npm run typecheck / npm test / npm run build
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:
```

**Manual proof:** a real gateway call to the fixture stream, with the event
transcript and the abort behaviour recorded.

```
Result:
```

**Proof gaps:** —
**Deviations:** —

---

## 8. P5 — Lifecycle, compatibility and installation

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria:**

- [ ] **P5-A1** `POST /__hui/ext/:id/reload` re-imports a changed module; a
  successful reload serves the new routes immediately (panels via the new table),
  prompt text on the next assembly and tools on the next new session; a failed
  reload answers 200 with `state: "failed"`, the error, and no routes from the
  broken module.
- [ ] **P5-A2** `engines.hui` min/max are enforced by a tested comparator; an
  unsupported range refuses to load with a named reason; extensions without
  `engines` still load.
- [ ] **P5-A3** `ExtensionStatus` gains `version?`, `engines?`, `reloadedAt?`,
  `mode`, `restarts`; the API schema and generated browser types are regenerated
  and documented; the Settings page has a Reload action.
- [ ] **P5-A4** `hui extension add <path> [--link]`, `remove <id> [--delete]` and
  `list` behave as specified, including refusing an existing id, requiring a
  disabled extension to remove, and the no-gateway message; `hui extension`
  commands appear in HELP and completion.
- [ ] **P5-A5** `hui doctor` reports missing, failed and incompatible enabled
  extensions, has no `--fix`, and its tests cover each issue.
- [ ] **P5-A6** Focused tests, typecheck, full suite (failure set unchanged),
  build, CLI tests and CI green; the Reload button has a Browser-tool check and a
  screenshot if the page changed.

**Runs**

```
P5-V1  reload success/failure, engines, comparator
Command:
Result:
Exit:

P5-V2  CLI add/remove/list, doctor check
Command:
Result:
Exit:

P5-V3  npm run api:schema && git status --short
Result:
Exit:

P5-V4  npm run typecheck / npm test / npm run build
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:
```

**Manual proof:** install a copy of the fixture with `hui extension add`, reload
after editing its module, then remove it; record the CLI transcript and the
status/doctor output.

```
Result:
```

**Proof gaps:** —
**Deviations:** —

---

## 9. P6 — Out-of-process mode

**Status:** NOT STARTED · **Commit:** — · **CI:** —

**Baseline:** typecheck — · tests — · tree —

**Acceptance criteria:**

- [ ] **P6-A1** `mode: "process"` starts one supervised host for that extension
  only; in-process extensions are untouched; enabling a ninth process-mode
  extension fails with a named reason.
- [ ] **P6-A2** Routes, SSE and prompt text behave as in-process (same status,
  bodies, caps and errors), with the host as the only code location.
- [ ] **P6-A3** A crash answers 503 `{ "error": "extension process is restarting" }`
  during backoff, restarts with 1 s/2 s/4 s, records a diagnostic per crash, and
  three crashes in five minutes mark it `failed` until a reload.
- [ ] **P6-A4** A crashing or hanging extension cannot affect another extension or
  HUI's own routes; timeouts and abort frames are honored.
- [ ] **P6-A5** `stopBackend`/gateway shutdown kills every host and waits for exit;
  no orphan process survives.
- [ ] **P6-A6** Tools are refused in process mode with a named reason (E14).
- [ ] **P6-A7** `ExtensionStatus.mode`/`restarts` show in the Settings page; each
  host start records one bounded stderr diagnostic; the docs and SPEC state that
  this is crash isolation, not a security sandbox.
- [ ] **P6-A8** Focused tests, typecheck, full suite (failure set unchanged),
  build and CI green.

**Runs**

```
P6-V1  host routes/SSE/prompt, protocol frames, timeouts
Command:
Result:
Exit:

P6-V2  crash/backoff/three-crash limit, isolation, shutdown
Command:
Result:
Exit:

P6-V3  npm run typecheck / npm test / npm run build
Result:            (failure set vs baseline: added ___ / removed ___)
Exit:
```

**Manual proof:** run the fixture in process mode, kill its host, observe 503 →
recovery, and verify another extension keeps answering; record the transcript.

```
Result:
```

**Proof gaps:** —
**Deviations:** —

---

## 10. Program completion and owner sign-off

After P6, before handoff:

- [ ] Every phase is DONE with its commit and green CI recorded in §1.
- [ ] The program checks ran at the final HEAD: `npm run typecheck`, `npm test`,
      `npm run build`, `npm run e2e` (web) and the manual proofs; results pasted.
- [ ] The PR body lists the phases, the exact checks and the proof, and the
      screenshots for the UI phases are attached (not committed).
- [ ] §2 Resume point says "complete"; §7/§8 hold only documented gaps.
- [ ] The PR is ready for review (not draft) and not merged.

Owner:

- [ ] Reviewed the branch commit by commit
- [ ] Approved the PR
- [ ] Merged
