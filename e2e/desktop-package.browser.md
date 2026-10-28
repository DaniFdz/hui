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

## Native notification proof

Verified 2026-10-22 on macOS 26.7 (arm64) with Electron 44.4.5, against an
isolated managed gateway started from the checkout. The operator's own HUI app,
gateway and notification settings were not touched.

### Setup

1. `npm run build`, then start the fixture provider
   (`e2e/fixtures/pi-provider-fixture.mjs`) and `hui gateway start --port <free>`
   with `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `PI_CODING_AGENT_DIR` set
   to a scratch directory under the home folder. `notify_user` looks for
   `$HOME/Applications/HUI.app`, so the scratch `HOME` holds the proof bundle.
2. Build that bundle with `installMacApp({ applications: '<scratch>/home/Applications', … })`
   and a `finalize` step that gives it its own `CFBundleIdentifier` and the name
   "HUI Proof", then signs it ad hoc. Its `LSEnvironment` sets `CFFIXED_USER_HOME`
   to the scratch home, which gives Electron its own user data and
   single-instance lock, and the same XDG and PI variables, so its
   `gateway start --json` reuses the scratch gateway. Register it with
   `lsregister -f`.
3. Keep the scratch directory out of `/tmp`. A bundle there that macOS has never
   allowed fails every notification with "Notifications are not allowed for
   this application" and no prompt.
4. Trigger the tool with `E2E_CALL:` prompts, from regular sessions over
   `POST /__hui/sessions/:id/prompt` and from a bot over
   `POST /__hui/bots/:id/messages`. Follow the front app and the proof window's
   title, which names the open chat, with `NSWorkspace` and `CGWindowList`, and
   Electron's notification log with `ELECTRON_DEBUG_NOTIFICATIONS=1`. Make that
   log file append-only with `chflags uappnd`, because every Electron launch
   deletes the file `ELECTRON_LOG_FILE` names.

### Results

The operator clicked most banners and Notification Center entries by hand. Two
clicks used the banner's own accessibility press action instead.

| Case | Observed |
| --- | --- |
| First launch | Opening HUI asked for notification permission before any alert was sent. |
| HUI not running | `open -g -a` started HUI in the background with no window and the front app unchanged; the banner appeared 1.5 to 7 s after the call, slowest on the first launch after an install, and the tool returned `queued`. Clicking it opened a window on that chat. |
| HUI running | The banner appeared within 1 s. HUI kept a single process, and the Dock showed no second HUI icon. |
| Another chat open | The window stayed on its chat and in the background while the alert arrived. Clicking opened the alert's chat and brought HUI to the front within 2 s. |
| Bot chat | Clicking opened `/bots/<id>`, the bot's stable address. |
| Three alerts at once | All three returned `queued` while the window stayed on another chat. Clicked in Notification Center in a different order, each opened its own chat. |
| Window closed | HUI kept running without a window; clicking created a window on the alert's chat. |
| Quit with an unread alert | Quitting HUI removed the alert from Notification Center. |
| Force Quit, then a click starts HUI | The alert stayed in Notification Center. Clicking it started HUI on the alert's chat. |
| Force Quit, then a click after HUI restarted | The restarted HUI took over the alert, and clicking it opened the alert's chat. |
| macOS refuses | The tool failed within the launch time with "Allow notifications for HUI in System Settings"; HUI showed no dialog and did not come to the front. |

Known limits:

- The first alert that launches a never-opened HUI is lost behind the
  permission prompt, although the tool reports it queued. Opening HUI once
  shows the prompt instead.
