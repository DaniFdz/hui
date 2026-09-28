# `/clear` browser verification

Verified on 2026-09-24 against the real HUI app at `http://localhost:5174/`,
using isolated HUI and PI directories under `/tmp/hui-clear-e2e` and a disposable
workspace. The configured browser tool timed out while opening a tab and again
after its documented restart retry, so the journey used the host Brave binary
through CDP as the repository-approved fallback.

## Journey

1. Opened New Session, entered the disposable workspace and submitted a seed
   message. The intentionally credential-free PI fixture settled with its real
   missing-provider error, leaving a visible transcript to clear.
2. Typed `/` in the real composer and confirmed the HUI command menu exposed
   `/clear` with **Clear this session's context and start a fresh PI transcript**.
3. Selected `/clear` from that menu and pressed the visible Send control.
4. Confirmed the same sidebar row and title remained, the transcript changed to
   **Start a conversation**, and the inline status read **Session context
   cleared.**
5. Reopened the session through its authenticated API and observed an empty
   transcript with `idle` status. The same clear route without `x-hui: 1`
   returned `403`, proving the local-client guard was retained.

The browser process emitted no additional console/runtime errors during the
journey. PI did not materialize a JSONL file because the credential-free seed
turn failed before persistence; automated runtime/manager tests cover replacement
of the stored PI identity while preserving the HUI row.
