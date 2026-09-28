---
name: hui-visual-verification
description: "Verify HUI UI changes and prepare PR screenshots: launch the exact checkout with isolated PI fixtures, drive the real browser, inspect desktop/mobile output, and attach fresh evidence to the PR description."
---

# HUI visual verification

## 1. Select the change and the proof

Read root `AGENTS.md` and `e2e/AGENTS.md`. Resolve all repository paths below
from the checkout containing this skill, not the agent's default working directory.
Read [the feature map](references/features.md) and select the smallest journey
that proves the requested behavior, plus the affected responsive states.
Use the existing feature-specific fixture when the default SDK fixture cannot
produce the required state. State whether the proof uses seeded presentation,
real PI with a deterministic provider, or a real external integration.

Inspect `git status --short`, fetch, and compare HEAD with `origin/main`. Keep a
shared/dirty checkout untouched; create a feature worktree from the intended base.
Run `npm ci` there. Only reuse another checkout's `node_modules` when lockfiles
are identical. Never switch another agent's branch or restart the owner's gateway.

**Done:** branch, expected behavior, fixture type and required viewports are explicit.

## 2. Launch and identify the exact instance

From the selected checkout, in a persistent terminal/exec session:

```sh
node e2e/visual-verification.mjs launch --branch "$(git branch --show-current)"
```

For an intentionally detached checkout (such as CI), use `--branch HEAD`; the
receipt still pins the exact commit. Keep the JSON ready receipt and the printed path outside Git. The launcher owns
fresh temporary HUI config, PI config/transcripts, a workspace, deterministic
provider and Vite server. Ports are allocated by the OS. It strips inherited
provider credentials/proxies from child environments and does not replace HOME.
Use the receipt's `browserUrl`, `workspace` and `receipt` values; never assume port 5173.

```sh
node e2e/visual-verification.mjs doctor --receipt /absolute/path/to/receipt.json
```

Doctor must pass before Browser work and again before final capture. It verifies
checkout provenance, instance identity and HUI's guarded API. Editing, committing
or rebasing changes provenance: stop and launch again, then repeat affected proof.
For final PR evidence, launch from the committed PR HEAD with a clean working tree.
A screenshot of an old dev server is not evidence of the current branch.

**Done:** doctor passes for the exact checkout being reviewed, not another instance.

## 3. Drive visible controls

Use [the browser procedure](references/browser.md). Check browser status/tabs,
open an owned labeled tab at the receipt URL and retain its stable target ID for
**every** snapshot, action and capture. Read a fresh accessibility snapshot;
click/type/select using roles, names and current refs. After navigation, dialogs
or stale refs, re-observe before acting. Keep another agent's tabs untouched.

For the default smoke: create a session in the printed workspace with `E2E_RICH`,
observe the SDK's real read tool and response, send a second message, then navigate
to Settings and back. Exercise the changed feature's actual controls, not just
its API. API calls and transcript seeds are setup/inspection, not UI-action proof.
Wait for visible expected content and settled state, not a fixed delay or the
first SSE frame. Do not mutate app internals/DOM to manufacture a passing screen.

**Done:** the user journey and resulting state are observed through the actual UI.

## 4. Inspect and capture

Check desktop at 1440×900 and mobile at 390×844; add 844×390 landscape for
menus/drawers or height-sensitive layouts. Resize is responsive proof, not native
touch proof: record device emulation separately when testing touch. Repeat the
relevant interaction at each size. Inspect focus, clipped controls, main/inner
scroll overflow and Browser page/console errors. Do not call an unexplained
error a pass. Separate known fixture/development warnings from new failures.

Run doctor again. Capture the real rendered affected state to the tool's media
storage or the run directory, **outside the repository**. Open and inspect each
image; reject blanks, loading gates, stale states or unrelated screens. Record
viewport, scenario, commit, fixture type and limitations alongside the images.
Screenshots prove appearance, not streaming, persistence or backend correctness;
retain the assertions that demonstrate those behaviors.

**Done:** fresh, visually inspected images and behavior assertions agree.

## 5. Deliver the PR evidence

Follow [the evidence handoff](references/pr-evidence.md). Run relevant tests and
required checks, review the diff and commit/push the feature branch. Open/update
the PR using `.github/pull_request_template.md`. Put fresh desktop/mobile images
**in the PR description**, attached through GitHub (not only in comments or chat).
Prefer `gh pr create/edit --body-file ... --attach ...` (GitHub CLI 2.99.0+)
to upload the images and preserve Markdown without a browser login.
Never put screenshots, base64 image payloads or local media paths in Git.

Share the same images directly in the conversation. If GitHub attachment upload
is unavailable, keep the PR draft, mark the missing attachment explicitly and
provide the images in chat; do not invent URLs or claim complete delivery.
Non-UI-only PRs may explain why screenshots are not applicable; changes to this
verification workflow must still run its desktop/mobile smoke as a dogfood test.

**Done:** PR body renders the captured evidence for its HEAD, or clearly identifies
an attachment blocker and remains draft. Claims match the actual proof scope.

## 6. Clean up and maintain

```sh
node e2e/visual-verification.mjs cleanup --receipt /absolute/path/to/receipt.json
```

Close only the owned tab. Stop a browser process only if this run started it.
Confirm owned provider/gateway sockets are closed; retain the temporary receipt
and images until delivery is verified. Never kill processes by broad name pattern
or delete the owner's state. Update the selected journey/map in the same PR when
its controls or fixture assumptions changed. Keep executable helpers small and
reuse the existing fixtures; do not turn this map into a second product spec.

**Done:** no owned servers remain; future agents can reproduce the proof.
