# Session-tree archive, restore and deletion

Verified 2026-09-25 against the running app at `http://localhost:5199` with
isolated HUI/PI state under `/tmp/hui-tree-browser`. No operator data was changed.

## Fixture and browser journey

Seed the disposable registry with five PI sessions: `parent` (Plan website),
`child` (Review accessibility, parentId=parent), `grandchild` (Check keyboard
navigation, parentId=child), `sibling` (Review responsive layout,
parentId=parent), and unrelated `other` (Independent conversation). Use an empty
PI config and disposable workspace; no model call is needed for this journey.
Start Vite with the fixture XDG config and PI agent/session directory variables.

1. Open `/sessions/grandchild` at 1440x1000. In the sidebar open **Actions for
   Plan website**, then **Archive session**. All four related rows disappear,
   the open grandchild view returns Home, and Independent conversation remains.
   The fixture registry confirms archived=true on exactly those four rows.
2. Open `/sessions`, select **Archived**, and observe all four
   archived rows. Activate **Restore Plan website**. The archived list empties
   and all four rows return to the sidebar. Registry flags confirm restoration.
3. Open `/sessions/parent`, its action menu, then **Delete…**. Verify the dialog
   explicitly includes nested subagents and states that PI transcripts remain.
   Inspect the same dialog at 390x844; its buttons remain visible and usable.
4. Activate **Remove from HUI** on mobile. Home opens. Only Independent
   conversation remains in the registry and recent list, with no parent/child
   sidebar links. No API mutation replaced the visible archive/restore/delete
   controls; Browser evaluate clicks were used after snapshot references were
   rejected by the browser driver.

Fresh desktop/mobile dialog screenshots were shared directly in chat and kept
outside the repository. One screenshot request timed out; the retry succeeded.
Browser page errors: zero. No discretionary LLM delegation was tested here.

## Automated boundaries

Focused tests cover nested/cross-group archive and restore, subtree-only deletion,
atomic write failure rollback for every deletion token, closing descendant live
runtimes, stale-open guards, spawn-versus-delete protection, newly spawned children
inheriting archive state, task-projection cleanup, and cycle-safe traversal.
Existing transcript-preservation tests remain passing. Active runtime races and
storage failures are tested with controllable runtimes, not browser fault injection.

Validation: `npm test` (626 passed after integration onto current main), `npm run typecheck`, `npm run build`, and
`git diff --check`. Build retains its existing large-chunk advisory.
