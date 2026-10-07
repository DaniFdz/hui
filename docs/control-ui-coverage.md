# Coverage against OpenClaw's Control UI

## Pinned reference and accepted product scope

Visual reference: **OpenClaw 2026.9.5**, source commit
`ec9c1a13db8938e5a3eaa51fca2e981cde2395a9`. Re-measured from the installed
bundle on 2026-09-24:

| Measure | Value |
|---|---:|
| Distinct chunk families (compression and content hashes removed) | 361 |
| Page-bearing families | 40 |
| Distinct declared CSS custom properties, across all shipped CSS | 1,043 |
| Standalone theme CSS files | 10 |
| Font-family CSS files | 9 |
| Searchable Settings targets | 27 |

The 40 page-bearing families are 37 literal `*-page` families plus
`approval-page-registration`, `new-session-page-entry` and
`question-page-registration`. The older core-sheet-only custom-property
count is not comparable to the all-sheets count above.

The **accepted product catalogue remains 38 entries from 2026.9.4**:
25 retained, 13 dropped. Updating the visual reference does not silently expand
HUI's product scope. Eleven Settings pages are retained from the older
13-area grouping; that grouping is not the newer 27-target inventory.

Do not report “38/38 functional” or “all OpenClaw Settings implemented”.
Dropped routes normalize to Home. Four retained catalogue routes are explicitly
informational placeholders: Chat, Question, Permissions and Secrets.
Chat and questions actually work within a real session; permissions and secrets
are bounded by the read-only Full Access/security projection.

## Implemented surface and live proof

The final route matrix visits **25 retained catalogue routes + 11 Settings
pages at three sizes = 108 visits**. Of these, 96 visit non-placeholder pages.
Actual session routes and their questions are exercised separately.

| Capability group | Implemented contract exercised in Browser |
|---|---|
| Chat / New Session | Real PI RPC, create/open/resume, streaming/stop/reconnect, model/effort, tools, supported Markdown/copy, uploads, queue/steer, context, progress, session-born subagents and shared PTY panels/tool |
| Question (inside sessions) | Select/custom answer, confirm, text input, editor with prefill, submit and skip |
| Sessions / sidebar | Search, groups/defaults, rename, pin, automatic interrupted-run recovery, accent unread state, archive/restore, icon, move, copy/open actions, nested child sessions, remove HUI entry without deleting PI transcript, keyboard menus, drawers and history. Owner assignment remains an explicit PI protocol gap; transcript fork exists for Pi Durable sessions as a reply action, not a row-menu item. |
| Appearance | Themes/import validation, mode/system resolution, accent/reset, independent interface/chat fonts (ten choices), text scale, message width, collapsed progress, send shortcut and follow-up preference |
| Skills / Plugins / Plugin | Discovery, bounded read-only skill/package/extension viewer, HUI-only enable/disable before SDK resource loading, low-cost agent-assisted skill install, PI package install and confirmed removal, inventory/details |
| Skill Workshop | Discovery/ownership projection only; publication is not implemented |
| Models / Model Providers / Model Setup | PI defaults and redacted provider/model catalogue; runtime model selection in chat |
| Config / Connection / Tools / Security | Explicit HUI/PI ownership, process health, available tools and fixed Full Access |
| Memory / Memory Import / Worktrees | Read-only inventory, branch-prefix preference and OpenClaw-style checkout/worktree creation from New Session |
| Automation / Cron / Tasks | All three schedule forms, create/edit/pause, run, cancel, delete fixture task and retained run history |
| Activity / Logs / Debug / Usage / Diagnostics | Refresh/filter/detail, runtime evidence, numeric usage and redacted diagnostic export |
| About / Labs / Profile | Runtime metadata, reversible persisted flags and presentation profile |

“Implemented” includes intentionally read-only projections, not OpenClaw's entire
backend. No fake Fast mode, microphone, approvals, package update, skill removal,
Workshop publication or destructive worktree cleanup is counted as functionality.

## Visual implementation and evidence

- **32 verbatim source sheets and five excerpts**, with provenance/hashes in
  [the stylesheet manifest](../src/styles/openclaw-reference/README.md).
- Original semantic tokens, fonts, component geometry and state selectors;
  competing legacy rules removed. Claw uses its original palette instead of
  reconstructing it from preview swatches.
- Original composer, model/effort picker, transcript/tool/question/progress,
  navigation/menu and Settings row/control anatomy where PI supplies the contract.
- Composer popover/details/dialog transports remain HUI-owned. Settings pickers,
  switches, selects, hub tabs and sidebar/task menus use Web Awesome 3.12.0.
  The full-width
  Settings footer is an explicit user-requested adaptation.
- Browser drawer layout follows upstream's 900 px plus short-landscape query;
  the separate compact-content query remains 768 px plus short landscape.

The pre-Web-Awesome checkpoint contains **177 same-DOM cascade comparisons** across 20
capability pages and eleven Settings pages, **180 independent original-renderer
composer comparisons** (five states at three sizes), and **eight switch-part
comparisons** against the actual shipped Web Awesome component. No unexpected
measured differences remain. The original Effort renderer always includes Fast
mode; its unsupported 55.59375 px row is recorded explicitly, not removed from
the oracle. The HUI-native switch host has no original DOM equivalent; only its
visible control/thumb are compared against the original runtime.

An earlier 260-record cascade/state checkpoint is retained as historical
interaction evidence, not falsely labelled a fresh final screenshot certificate.
The final pass also pins 48 shared icon geometries, copies 64 original file SVGs,
and ports the original textarea resizing/overflow controller with lifecycle cleanup.

The subsequent independent pass adds **4,240 palette/color/shadow comparisons**
(four themes × two modes × ten accents), **1,506 Settings-region records** plus
**570 schedule-form records**, **66 original session-row records**, and **69
plain-message/context-menu records** (including nine expected-absence checks).
All have zero unexpected measured differences at the recorded states. In that
checkpoint, Settings controls were opaque slots except switches. Plain-message
metadata omits only a measured timestamp region: HUI's current normalized
transcript has no timestamp field. These are explicit limits, not full-page
claims. The 108-route sweep was repeated after these changes.

With explicit dependency approval, the subsequent Web Awesome migration adds
**544 independent control-part/style records across 19 captures**, plus another
**108 route visits** at desktop/portrait/landscape. Migrated pickers, switches,
selects, tabs and action menus now use the original component runtime/version;
the native-switch measurements above are historical. Real form submission,
preference persistence, keyboard/focus behavior and task lifecycle were exercised.
See the [migration report](../e2e/webawesome-controls.browser.md) for the exact
matrix, corrected defects, screenshots and remaining downstream-patch limits.

This is strong, bounded component evidence, **not a 100% whole-application
pixel-diff claim**. The same-DOM stylesheet probe cannot prove original DOM
equivalence, and PI/HUI content and native transports are explicitly adapted.
The stricter [visual goal](visual-parity-goal.md) stays open until its independent
visual acceptance gate is met.

Full journeys, failed attempts, test environment and proof limits:
[Browser E2E report](../e2e/visual-parity-2026-09-24.browser.md).
Machine-readable final evidence:
[routes](../e2e/evidence/2026-09-24-final-routes.json),
[current verification](../e2e/evidence/2026-09-24-final-verification.json),
[independent renderers](../e2e/evidence/2026-09-24-independent-renderers.json),
[original palettes](../e2e/evidence/2026-09-24-original-palettes.json),
[earlier state checkpoint](../e2e/evidence/2026-09-24-final-styles.json).

## Why skills cannot currently be removed like plugins

Packages have a configured source and PI's `remove` operation. A discovered skill
is a directory containing `SKILL.md`; it may belong to a workspace, package,
configured root or symlink. HUI currently has no skill ownership/removal contract
or removal endpoint. A button that recursively deletes its discovered directory
would risk deleting files HUI did not install. This is a missing lifecycle feature,
not a CSS limitation. Adding it requires an explicit safe scope, confirmation,
symlink/package handling and recoverable removal; this visual task deletes no
operator skills.

## Ownership boundaries

| Data | Owner / permitted HUI behavior |
|---|---|
| PI settings | Read; no silent overwrite |
| PI authentication | Provider names only, never credential values |
| Skills | Discover; install URL through a bounded low-cost PI agent |
| Packages | Install and confirmed exact-source removal through PI CLI |
| Session JSONL | PI owns transcript; HUI opens/resumes via RPC |
| UI preferences, registry, groups, automation | HUI-owned local configuration |
| OpenClaw channels, nodes, portals, approvals | Excluded by the product decision |

## Re-measurement

Choose **one explicit installed Control UI directory**, not an unresolved
multi-version glob, and inspect its `assets/`, `themes/` and `fonts/`.
Strip `.br`/`.gz` and `-[A-Za-z0-9_-]{8}.js/.css` before deduplicating
chunk names. Count declared `--name:` tokens over every uncompressed CSS file.
Keep source-scope counts separate from current-bundle counts and functionality.

The chosen implementation route remains porting original regions onto HUI's
existing PI service, not serving the entire OpenClaw bundle behind a protocol shim.
