# Browser journey: automatic update notifications

Verified on 2026-09-24 against the installed production package, with disposable
HUI/PI state and the bundled SDK's deterministic local provider. No personal
installation, transcript or credentials were changed.

## Reproduce

```sh
npm ci --ignore-scripts
npm run build
HUI_E2E_RELEASES=1 HUI_E2E_PORT=43142 npm run e2e:package
```

Use the printed workspace and open `http://localhost:43142/` with the Browser
tool. The existing release fixture supplies a genuine packed candidate through
a fixture-only `gh` executable; update validation, staging, activation and
gateway replacement are real. There is no production endpoint override.

## Observed journey

1. Open HUI with no session and without entering `/update`. The non-modal
   **HUI 0.1.2 is available** banner appears above the app. It also remains
   reachable in Settings. Opening **Review update** shows the current 0.1.1
   version and the explicit **Update to 0.1.2** action; it does not install.
2. Type a draft, review the update, and close with Escape. The draft is unchanged
   and keyboard focus returns to **Review update**. Dismiss the banner: it
   disappears without blocking the composer. Reload: the banner returns.
   These actions produced zero model requests before starting the fixture chat.
3. Collapse/expand the desktop sidebar: its floating control sits below the
   banner, without overlap. At 390×844, open the navigation drawer: both the
   main content and notification become inert. Escape restores both and
   returns focus to the navigation control. The banner uses 44 px mobile
   button targets and does not overflow horizontally.
4. In an isolated fixture, switch release mode to `denied` and review again.
   The dialog explains the access failure, removes the install action and
   removes the stale banner; it does not claim HUI is current.
5. Against the final integrated package, start `E2E_RICH` in the printed
   disposable workspace. The SDK executes a real read tool and displays
   **Tool complete**. Capture the installed UI at 1440×1000 and 390×844.
   Keep an unsent draft in the composer.
6. On mobile, select **Review update → Update to 0.1.2**. The banner disappears
   while the detached worker updates. The dialog reconnects and displays
   **Installed version 0.1.2**, **HUI 0.1.2 is ready**, and **Reload HUI**.
7. Select **Reload HUI**. The same session route, tool result, Markdown/table
   history and unsent draft return. The now-current installation shows no
   update banner. The provider remains at exactly two requests (the original
   read-tool round trip); checking/updating/reloading adds none.

## Evidence and checks

- Focused checks: `npm test -- server/updates.test.ts src/lib/update-notice.test.ts src/views/shell.test.ts`.
- Final integrated checks: `npm test` (**470 passed**), `npm run typecheck`,
  `npm run build`, and `git diff --check` passed.
- Fake-clock tests cover hourly discovery, event deduplication, hidden/offline
  pause/resume gating, quiet errors, disposal/late responses, per-version
  dismissal and stale-offer suppression. Gateway tests cover cache expiry,
  unavailable-result caching, fresh manual checks, concurrent lookups and the
  background route's local-client guard. Both drawers' inert state is tested.
- Browser page errors: **0**. Console network errors were the expected SSE
  interruption/reconnects during gateway replacement, plus a refused request
  while replacing an earlier disposable fixture. No application exception.
- The attached browser exited during an early screenshot. A fresh isolated
  headless browser restored Browser-tool operation; the final integrated
  journey used that real rendered page.
- GitHub still has no published release. Positive install proof uses the
  synthetic release metadata and real local archive, not GitHub asset delivery.
  The hourly passage itself is fake-clock unit proof, not an hour-long browser
  soak. No tag, GitHub release or npm publication was created.

Stop the fixture runner with Ctrl+C to stop only its disposable gateway/provider.
Never stop an operator gateway or remove PI-owned data.
