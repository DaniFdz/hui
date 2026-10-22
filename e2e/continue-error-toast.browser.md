# Continue rejection toast

Verified 2026-09-25 through the Browser tool at `http://localhost:5424`.
Start Vite from this checkout with `XDG_CONFIG_HOME`, `PI_AGENT_DIR`, and
`PI_CODING_AGENT_DIR` pointing into a fresh temporary directory; no operator
sessions or credentials are needed.

## Deterministic setup

In the browser, seed `hui-app` with an idle fixture session,
`connection = "live"`, `opening = false`, and a short user/assistant transcript.
Intercept only the fixture session's `/__hui/sessions/:id/resume` fetch and
return HTTP 409 with JSON:

```json
{"error":"Rewind to a user message or completed tool result before continuing."}
```

This verifies the real UI handler and response parsing with a simulated backend
rejection. It does not prove a live PI rejection or successful continuation.

## Regression journey

1. At 1440×1000, click the visible header **Continue** button.
2. Assert `.chat-operation-toast` has `role="alert"`, contains the server error,
   and has computed `position: fixed`. No `.launch__note.is-error` is present.
3. Check the toast fits the viewport. Observed bounds: x=900, y=64, width=520.
4. At 390×844, click **Dismiss notification** and assert the toast disappears.
5. Click header **Continue** again and assert the toast reappears. Its bounds are
   x=12, y=72, width=366, below the header's bottom edge at y=52. The document
   has no horizontal overflow.
6. Inspect both rendered screenshots and Browser errors: no page errors.

Screenshots were delivered directly in chat and are not repository artifacts.
Validation: focused `src/lib/run-error.test.ts` (3 tests), `npm test` (657 tests),
`npm run typecheck`, and `npm run build` all passed.
