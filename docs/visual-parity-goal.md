# Goal: exact visual parity for implemented capabilities

Requested by the project owner on 2026-09-23. **Status: active; not yet accepted.**

HUI's implemented UI must match OpenClaw 2026.9.5 in the same browser,
viewport, theme source, mode, accent, font and text scale. A familiar class
name, passing unit tests, or a screenshot of HUI alone is not proof of parity.

## Scope

- Chat and New Session: transcript, tools, progress, questions, attachments,
  composer, model and effort pickers, send/stop and follow-up controls.
- Sidebar, navigation, session/group menus, dialogs and command palette.
- All currently implemented capability routes and all eleven Settings pages.
- Resting, hover, keyboard focus, active, disabled, expanded and error states
  wherever the underlying HUI capability implements them.
- Desktop (1440×900), portrait (390×844) and landscape (844×390).
- Light and dark modes, default Claw and the user's imported theme semantics.

The existing PI runtime and ownership contracts stay in place. The scope does
not add OpenClaw-only services, permissions, agents or fake interactive controls.
Brand/content differences (PI instead of OpenClaw, actual installed resources)
are recorded explicitly, not counted as accidental visual defects.

## Acceptance gate

1. Pin the upstream source and shipped assets and enumerate current routes.
2. Compare resolved colors, font metrics, dimensions, padding, gaps, borders,
   radii, corner shapes, shadows and responsive behavior against that reference.
3. Exercise each implemented capability through the Browser tool using isolated
   HUI/PI data, covering reachable menus and controls rather than only endpoints.
4. Record the exact surface/state coverage, screenshots and remaining differences
   in an E2E report. No untested item is marked passed.
5. Run required tests, typecheck, build and diff review. Resolve measured defects
   before claiming 100%; keep this goal active if any proof gap remains.

Prior documentation that calls a surface “done” describes its functional scope,
not satisfaction of this stricter visual gate.

## Checkpoint — 2026-09-24

- Implemented capability journeys exercised against isolated HUI state and real
  PI RPC; 36 routes × three viewports recorded without overflow or alerts.
- 32 verbatim upstream stylesheets plus five reviewed excerpts, hash-guarded.
- Fresh evidence: 177 same-DOM cascade comparisons across 31 pages, 180
  original-renderer composer comparisons (five states × three viewports), and
  eight original Web Awesome switch-part comparisons pass.
- The original Effort popup retains its unsupported Fast mode row in the oracle;
  its measured 55.59375 px height is an explicit PI adaptation, not a hidden diff.
- 48 shared icon geometries are hash-guarded; all 64 file SVG assets match upstream.
- Original palette evaluation: 80 theme/mode/accent combinations, 4,240 color
  and shadow comparisons. Rosé uses its original CSS, not preview JSON, and
  accent ink uses the original contrast threshold.
- Original Settings primitives: 1,506 records across eleven pages and three
  sizes, plus 570 records for the three schedule forms. Switch host spacing,
  nested automation controls and empty section descriptions corrected.
- Original session rows: 66 records; pin action, title hierarchy and original
  hover-marquee lifecycle restored. Pin/unpin persistence and title scrolling
  exercised through the actual app.
- Original plain-message groups and context menu: 69 records, including nine
  expected-absence assertions. Copying user messages follows the original
  context-menu pattern instead of an extra footer button. Success/failure/retry
  verified. The missing timestamp contract is an explicit measured adaptation.
- Markdown subset and interactive code: 180 additional records over three sizes;
  quotes and fence viewport corrected. Expand, wrap and unwrap work in the real
  transcript. Compact sent-file cards add 27 original-renderer records.
- Read-tool rows/details: 102 success-state records over three sizes, plus 38
  failure-state records on desktop. Removed the redundant input/header actions;
  retained output copying through the original context-menu position.
- Command rows/terminal details: 630 records over three sizes and real PI
  succeeded, failed and running states, each collapsed and expanded. Original
  highlighting and shell-aware preview retained; no command is executed by the
  display parser. The probe rejects content changing during measurement.
- Full tests: 349/349; typecheck, production build and diff checks pass.
- Settings footer fills its row; ESC hint and Escape exit/close correctly.
- Fresh desktop/mobile/landscape and Settings screenshots inspected and shared.

**The 100% goal remains active.** Independent original renderers now cover the
composer, palette evaluation, Settings primitives, session rows, plain message
groups, the supported Markdown subset, code states, compact file cards, read
tools, command terminals and message-copy menu. This is still not a whole-app pixel certificate:
remaining non-migrated control states, tool kinds and capability-specific
layouts do not yet have independent original-renderer proof. Arbitrary Markdown
and syntax highlighting are not implemented capabilities. Agent-presented
images, native audio/video playback and file downloads are implemented through
HUI's explicit media tool; arbitrary remote embeds are not.
Their functional E2E and source/cascade checks must not be relabelled as that
stronger proof. Native transport and PI-content adaptations stay explicit.

### Approved Web Awesome follow-up — 2026-09-24

The project owner explicitly approved the dependency. `@awesome.me/webawesome@3.12.0` is
now pinned in npm, with selected local component imports and no CDN loader.
The original select picker, anchored overlay and hub tabs are ported; switches,
Automation selects/menus and sidebar session/group menus now use WA directly.
PI callbacks, API contracts and persisted formats are unchanged.

- **544 part/style records across 19 captures** match the independently loaded
  original renderers/runtime, including open menus/selectors, disabled Language,
  checked switches, Claw light/dark and the imported Rosé theme. The capture
  matrix is bounded; it is not every combination of those states.
- **108 route visits** (36 × three viewports) have no overflow, alert or oversized
  icon. The four existing contract-only destinations are explicitly retained
  in the evidence, not counted as completed capabilities.
- Browser interactions cover keyboard selection, typeahead, tab activation and
  focus restoration, persisted preferences, task create/edit/pause/delete, Labs
  toggling and nested Escape dismissal on desktop/mobile.
- Escape propagation into Settings/drawers, group-menu separators and mobile
  action-row geometry were corrected. The isolated task was removed and
  preferences restored through the actual UI.

See the [Web Awesome Browser report](../e2e/webawesome-controls.browser.md),
[control evidence](../e2e/evidence/2026-09-24-webawesome-controls.json) and
[route evidence](../e2e/evidence/2026-09-24-webawesome-routes.json).
**The 100% goal stays open:** remaining tool kinds, capability-specific layouts
and the full hover/focus/error matrix still need independent original proof.
The npm component version is not a claim that HUI includes every downstream
OpenClaw lifecycle patch.
