# Run error notice browser verification

Verified on 2026-10-26 with `node e2e/visual-verification.mjs launch`: HUI's
real Vite gateway on the Durable runtime, the deterministic
`e2e/fixtures/pi-provider-fixture.mjs`, and a disposable workspace and config.

On hosts with `HTTP(S)_PROXY` plus `NODE_USE_ENV_PROXY`, also export
`NO_PROXY=127.0.0.1,localhost` for the gateway. Otherwise PI's calls to the
loopback fixture fail with `Connection error.` instead of the fixture's answer.

## Journey

1. Started a session from **New session** with `E2E_FAIL_ONCE desktop check`.
   The fixture answered its first run with 401 `the API key expired` — an error
   PI does not retry — so the session returned to Idle. The inline error stayed
   inside the collapsed **Run details** disclosure, and a `role=alert` card
   appeared above the composer with **Copy error**, **Continue** and **Dismiss
   error**.
2. Clicked **Continue**. HUI sent one user turn that restates the request the
   failed run was handling — `The previous run was interrupted while handling
   this request: … E2E_FAIL_ONCE desktop check … Review the latest transcript
   and workspace state, finish the unfinished task, and avoid repeating work
   that is already complete.` The fixture answered `Fixture response.` and the
   card was gone.
3. The fixture's request log shows the same thing to the model: request 1 ended
   with the operator's prompt, and request 2 replaced it with that recovery
   prompt, with the failed attempt absent from the context
   (`roles: ["user", "user"]`).
4. Repeated at 390×844 in a second session
   (`E2E_FAIL_ONCE mobile check`): the error card, then the recovery turn and
   `Fixture response.` after **Continue**. Everything fit the 390 viewport with
   no horizontal overflow.
5. `doctor` passed before and after the browser work for the same HEAD, and the
   Browser tool reported only Lit's dev-mode warnings.

`E2E_ERROR` still fails every request that mentions it, which is what the
retrying journeys (`chat-composer.browser.md`, `chat-notifications.browser.md`,
`bot-faces.browser.md`) need. `E2E_FAIL_ONCE` fails only the first run of each
session, so this journey can watch the run recover instead of failing again.