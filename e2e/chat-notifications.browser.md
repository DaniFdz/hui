# Chat notification toasts

Verified 2026-10-04 through the Browser tool against the
`node e2e/visual-verification.mjs launch` instance for the PR HEAD, with its
deterministic SDK fixture provider. No operator sessions or credentials were used.

Every chat note (`note`/`noteLevel` in `hui-app`) renders as the shell toast
`.chat-operation-toast`, never as an inline paragraph in the transcript column.
Info toasts carry no icon; warnings and errors show the triangle in `--warn` or
`--danger`. Only errors use `role="alert"`.

## Regression journey

1. At 1440×900, create a session in the receipt workspace with
   `E2E_RICH check the workspace` and wait for `Tool complete`.
2. Send `/clear`. Assert `.chat-operation-toast` reads `Session context
   cleared.`, has `data-level="info"`, `role="status"`, no `.app-toast__icon`,
   computed `position: fixed` and a 16×16 dismiss glyph. No `.launch__note`
   exists. Observed bounds: x=1198, y=64.
3. Click **Dismiss notification** and assert the toast is gone.
4. Send `E2E_ERROR please`. While the run retries, assert the toast reads
   `Retrying after a provider error (attempt 1): …` with `data-level="warning"`.
   Observed bounds: x=900, y=64, width=520.
5. Wait for the run error card (`.chat-run-error-notice`). Assert the retry
   toast has closed: the settled outcome supersedes the recovery warning.
6. At 390×844, repeat step 4. Observed bounds: x=12, y=72, width=366; zero
   horizontal document overflow. Step 5 holds as well.
7. Read Browser errors on the owned tab: none.

The model-fallback warning (`Primary model failed before producing output.
Retrying with …`) uses the same notice path and level as step 4. The fixture has
a single model, so the fallback itself is covered by the `LiveSessions` unit test
rather than this journey.
