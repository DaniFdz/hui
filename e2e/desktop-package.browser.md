# Electron desktop package proof

Verified 2026-09-25 on NixOS, Node 24.20.0, npm 11.19.0, against the current
production gateway architecture (HUI 0.1.1). Native macOS execution remains
unverified; browser images are not screenshots of an Electron/macOS window.

## Installed-package and Browser journey

1. Build with `npm run build`; start `HUI_E2E_PORT=43139 npm run e2e:package`.
   The helper packs and installs a real archive into a temporary prefix with
   isolated HUI config/data, PI agent state, workspace and local provider.
2. Open `http://localhost:43139` with the Browser tool at 1440×1000.
3. Fill Project directory with the printed temporary workspace and the prompt
   with `Desktop package smoke test`; click Start session.
4. Observe the real packaged PI SDK session reach Idle with `Fixture response.`
   in the transcript, completion metadata, model selection and composer.
5. Resize to 390×844 and inspect the same transcript and usable composer without
   horizontal overflow. Inspect actual desktop/mobile rendered screenshots.
6. Both page-error and console-error inventories are empty. Include fresh
   screenshots in the PR description using the
   [visual verification skill](../.agents/skills/hui-visual-verification/SKILL.md);
   never commit the images. Close the labeled tab and stop only the fixture
   gateway/provider.

Earlier pre-integration checks also verified npm's script policy: for a local
archive, `--allow-scripts` must name its absolute tarball path, not `hui`. An
isolated foreground-script installation visibly ran HUI's postinstall hook.
Non-macOS automatic registration is intentionally a no-op.

## Automated evidence

- Full `npm test`: 667 passed, zero failures.
- Focused CLI/parser, installer and Electron shell tests: 13 passed.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Clean temporary-prefix `npm ci --ignore-scripts`: passed; the committed lock
  remains compatible with macOS optional runtime dependencies.
- `npm run test:package`: the existing installed-package lifecycle suite passes
  with desktop assets included in package and update fixtures. It exercises
  real SDK turns/resume, PTYs, busy-work refusals, update validation and rollback.
- Additional installed CLI dispatch proof uses a clearly synthetic Electron
  executable: `hui desktop` passes the installed shell path, stable CLI installation
  root and Node path. This is launch-contract
  coverage, not native-window proof.
- Installer filesystem fixtures cover new/owned replacement, refusal to
  overwrite foreign apps or symlinks, preservation on signing failure, bundled
  shell/policy code, icon/metadata and opt-out/global-install gating.
- Mocked Electron tests cover managed-gateway startup, single-instance focus,
  window-close/quit independence, visible startup failure, renderer isolation,
  external navigation and local clipboard permissions.

## Native release gate

The upstream Linux Electron binary downloads, but this NixOS host rejects its
generic Linux dynamic loader. No Mac was available. Before claiming native
macOS verification, test:

1. Global tarball installation with scripts authorized; inspect
   `~/Applications/HUI.app`, its icon and ad-hoc signature.
2. Finder launch without Terminal, Spotlight search for HUI, and Dock pinning.
3. Start/reuse the shared gateway, create a session and copy text.
4. Reopen a closed window, launch a second instance, and Quit; sessions and
   terminals must survive because only the gateway CLI owns their shutdown.
5. Reinstall/repair with `hui install-app` and confirm an unrelated HUI.app is
   preserved. Verify startup errors if the gateway cannot authenticate.

The bundle is not Apple-notarized. It keeps its signed shell locally but depends
on the recorded npm/Node installation for gateway startup and release selection.
