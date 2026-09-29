# Collapsible sidebar subagent trees

Verified 2026-09-25 against the real Vite application on localhost:5197.

## Isolated setup

Seed a disposable version-2 HUI registry with one group and five sessions:
parent, child (parentId=parent), grandchild (parentId=child), sibling
(parentId=parent), and an unrelated root. Use valid timestamps and a disposable
workspace directory. No PI transcript or model request is needed for this
presentation-only journey.

Run Vite with isolated XDG_CONFIG_HOME, PI_AGENT_DIR,
PI_CODING_AGENT_DIR and PI_CODING_AGENT_SESSION_DIR, and PI_OFFLINE=1.
The test used a temporary worktree based on main and the checked-in dependencies.

## Browser-tool journey

- At 1440x900, open Home and inspect the two disclosure buttons.
- Collapse the child, then the parent. Only the unrelated root and parent remain.
- Press Enter on the parent disclosure. Its children reappear, while the nested
  child's own fold choice stays collapsed.
- Expand the child and open the grandchild through its sidebar link.
- Collapse the parent: the grandchild chat and URL remain selected.
- Press Space on the focused disclosure: all five rows return.
- Collapse the parent and search for the grandchild. The matching row is visible.
  Clear the search: the parent is still collapsed.
- Emulate iPhone 13 (390 CSS pixels wide), open navigation, collapse and expand
  the parent. The drawer stays open, the selected chat does not change, the
  control is 44 CSS pixels high, and document width equals viewport width.
- Page errors and error-level browser console entries: zero.

Initial actions used Browser snapshot refs. After navigation, ref actions returned
unknown-ref errors despite fresh snapshots, so remaining clicks targeted the
observed labelled DOM buttons via Browser evaluate. Search was exercised through
the input's normal input event. No application state or API responses were mocked.
Screenshots were inspected and delivered in chat, never stored in the repository.

## Automated checks

- Full npm test: 587 passed, including nested folding, missing parents, cycles,
  self-links, and filtered descendants.
- npm run typecheck and npm run build passed.
- Build retains its existing large-chunk advisory.
- State is page-local, not persisted; no registry/API format change.

## 2026-09-29: trees follow the selection

Verified against the real Vite application from the visual-verification
launcher (clean committed checkout, doctor passed) with a seeded registry:
Alpha parent (two subagents), Beta parent (one subagent) and Gamma plain.

- 1440x900, nothing selected: both parents show an Expand disclosure and no
  subagent rows.
- Open Alpha parent: its two subagents appear; Beta stays folded.
- Open Alpha subagent B: Alpha's tree stays open.
- Open Gamma plain: Alpha folds again.
- Expand Beta with its disclosure while Gamma stays selected: Beta's subagent
  appears and the open chat is unchanged.
- Search "subagent A": matches under folded parents are shown.
- 390x844, load /sessions/beta-a directly and open navigation: Beta is expanded,
  Alpha folded, the subagent row is highlighted.
- Browser console: no errors (Lit dev-mode warnings only).
