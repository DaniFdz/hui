# Rewind and prompt-free continuation browser verification

Reverified on 2026-09-27 using the disposable real-PI SDK fixture from
`e2e/visual-verification.mjs`.

## Journey

1. Started a PI session in the fixture workspace with `E2E_RICH`; PI emitted
   real reasoning, a `read` tool call/result and its final Markdown response.
2. Hovered the settled user message and confirmed its contextual **Rewind**
   control appeared while the session header exposed only **Continue**. The
   control's tooltip matched the reference and keyboard focus revealed the same
   action.
3. Activated **Rewind** once. No selector or confirmation dialog appeared. PI
   moved its active leaf to the point before the selected user entry, the whole
   active transcript disappeared, and the exact `E2E_RICH` text returned to the
   focused composer. The abandoned branch stayed in PI's append-only tree.
4. Sent the restored draft to rebuild the real reasoning/tool/final response,
   then repeated direct rewind at 390×844. The user-message count again became
   zero, the composer value was exact, focus remained on **Message**, and no
   rewind dialog existed in the DOM.
5. Sent `E2E_ABORT` and waited for the deterministic provider's partial response.
   While the session was visibly running, confirmed both user messages still
   exposed an enabled **Rewind** action, then activated it on `E2E_ABORT`. HUI
   stopped the run, removed that in-flight branch without showing the former
   “Wait for the current run…” error, and restored the exact text to the focused
   composer.
6. Measured document horizontal overflow as zero at 1440×900 and 390×844. Page
   errors and error-level console messages were both empty.

## Automated companion proof

- `server/runtimes/pi-sdk.test.ts` drives both ordinary tree rewind and editable
  user-message rewind through the real SDK worker and deterministic provider.
- `server/runtimes/pi.test.ts` proves the shown history follows the active
  branch only, with compactions in place (the checkpoint mapping it once proved
  was replaced by entry-id rewind; see `compaction-rewind.browser.md`).
- `server/live-sessions.test.ts` proves transcript refresh, snapshot broadcast,
  automatic abort before rewind and the session mutation guard.
