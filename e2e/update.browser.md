# Browser journey: HUI chat and GitHub release updates

Verified on 2026-09-24 against an installed production package, not Vite.
PI used the real bundled SDK with the deterministic local provider. HUI/PI state,
workspaces, npm prefixes and GitHub CLI fixtures were all disposable.

## Reproduce

```sh
npm ci --ignore-scripts
npm run build
HUI_E2E_RELEASES=1 HUI_E2E_PORT=43140 npm run e2e:package
```

The runner prints the disposable CLI, workspace, release fixture and gateway.
Open `http://localhost:43140/` through the Browser tool. Only the fixture gateway
inherits a synthetic `gh` executable. It serves real npm archives produced from
the current build, through the same fixed GitHub API arguments as production;
there is no production URL override or mocked update/install/gateway backend.
The fixture JSON can set `mode` to `unpublished`, `denied` or `corrupt` to exercise
release access and integrity failures. Remove `mode` to restore a valid release.

## Observed Browser-tool journey

1. From an empty registry, enter `/upd` on New Session. The HUI `/update` option
   appears without runtime discovery. Tab completes `/update ` while retaining
   editor focus; it does not open the dialog or submit anything. Submitting the
   new session creates **HUI update** in **OTHER**, keeps `/update` in that
   session's composer, and opens the dialog showing installed 0.1.1 and
   synthetic stable 0.1.2. The provider has received **zero** model-turn
   requests; the session exists only so the operation can be retried and
   inspected after a failure.
2. Close the dialog, select the disposable workspace, and launch `E2E_RICH`.
   The real SDK reads the fixture file and renders its durable Markdown response.
   Submit `E2E_REPLAY` to hold an active turn, then submit `/update `.
   Activating **Update to 0.1.2** displays **Finish active sessions before updating
   HUI.** The gateway and original turn remain running. The provider stays at
   three requests: two for the read-tool journey and one for the held turn.
3. Close the dialog and use the real Stop control. Reopen `/update`; the menu and
   dialog are usable after the turn settles. At 1440×1000 and 390×844, inspect
   the rendered dialog and capture fresh PR evidence. The mobile dialog is
   366 px wide with 12 px gutters and no horizontal document overflow.
4. Set the isolated release fixture to `unpublished`, then use **Check again**.
   The dialog reports that no stable release is published and removes the
   install action; it does not claim the installation is current. Restore the
   fixture and check again to recover the install action.
5. Activate **Update to 0.1.2** in the mobile-width UI. The actual detached worker
   downloads/verifies/stages/probes/activates the archive and restarts the gateway
   on the same address. The dialog reconnects, reports **Installed version 0.1.2**
   and **HUI 0.1.2 is ready**, and exposes **Reload HUI** only after success.
6. Use **Reload HUI**. The same session route and durable transcript return.
   `/update --check` reports the current version with no install action. The
   dedicated session still retains `/update` in its composer for another retry;
   no `/update` command enters the PI transcript and the provider remains at
   three requests throughout checks, installation and reload.

## Automated checks and limits

- `npm test`: **471 passed**; includes version/asset/checksum bounds, command
  ownership and collisions, operational receipt recovery and guarded HTTP input.
- `npm run typecheck` and `npm run build`: passed.
- `npm run test:package`: passed. Covers isolated install, SDK history, busy
  work, local/remote updates, malformed/stale requests, credential-error
  redaction, corruption, activation failure, original-launcher rollback,
  stopped-gateway preservation, detached browser-worker replacement and recovery.
- Browser page errors: **0**. Console errors are the deliberately tested 409,
  the interrupted SSE connection, and two connection-refused requests during
  gateway replacement. No unexpected application exception was observed.
- The Browser tool initially rejected `127.0.0.1`, which is not in the configured
  hostname allowlist. The journey uses the explicitly allowed `localhost`.
  Transient CDP connection and screenshot timeouts also occurred. Browser-tool
  navigation, snapshots, typing, keyboard completion, buttons, resize and the
  full update/reload journey subsequently worked. Screenshots were captured via
  Playwright/CDP against that same live page, then visually inspected.
- Live GitHub read verified repository access and its private visibility, but
  no published stable release exists yet. Positive download/install proof uses
  the isolated GitHub fixture; real GitHub asset delivery and the tag-triggered
  Actions workflow remain unrun until the first release is published. No tag,
  GitHub release, npm publication or personal installation was created here.

Stop the fixture runner with Ctrl+C (or use its printed CLI and matching
disposable XDG/PI environment). Do not stop an operator gateway or delete PI data.
