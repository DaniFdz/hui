# HUI

**HarnessUI** is a local, browser-first control surface for coding-agent
harnesses. It gives you a focused workspace for sessions, transcripts, models,
settings and gateway operations while leaving agent configuration and
conversation history with PI.

## What it includes

- Grouped, searchable sessions with persistent drafts.
- Live transcripts, streaming status, tool activity and model controls.
- A local gateway that keeps running independently of the browser window.
- Appearance, skills, tools, models and workspace settings in one UI.
- A dedicated, headless-by-default browser agents can drive without touching
  your own browser, with a live preview of its page in the chat (Settings → Tools → Browser).
- Transactional local updates with verification and rollback support.

HUI currently runs with full access. It does not add an approval layer or copy
PI transcripts into its own storage.

## Requirements

- Node.js **22.18 or newer** and npm.
- Git for source checkouts.
- Optional: Google Chrome, Brave, Microsoft Edge or Chromium for the agent
  browser tool. HUI launches it with its own profile; nothing is downloaded.

HUI is distributed as npm archives (`.tgz`), not through the public npm
registry.

## Install

### Stable release (when available)

Download the `.tgz` archive and matching `.sha256` file from the
[latest GitHub Release](https://github.com/DaniFdz/hui/releases/latest), then
verify and install it globally:

```sh
mkdir -p ~/Downloads/hui-release
cd ~/Downloads/hui-release
sha256sum --check hui-*.tgz.sha256  # macOS: shasum -a 256 --check
npm install --global --prefix ~/.local ./hui-*.tgz
```

### Current `main` build

From a checkout of this repository, when testing unreleased work:

```sh
npm ci
npm pack
npm install --global --prefix ~/.local ./hui-*.tgz
```

This installs the current source commit. It is a development build, not a
stable update channel.

### Nix (Linux, configurable gateway and desktop)

The flake provides `packages.hui` / `packages.default` (web),
`packages.hui-desktop` (web + Electron), `apps.default`, `apps.desktop`,
`devShells.default`, `nixosModules.default` and isolated checks. It targets `x86_64-linux`
and `aarch64-linux`; the automated build runs on x86-64. Nix supplies Node.js and
runtime tools, so a separate Node/npm installation is not required.

From a checkout of this repository:

```sh
nix build
nix run . -- --version
nix run . -- gateway start
nix run . -- ui --no-open
nix run .#desktop              # launch the Electron window
# Optional: install the CLI in your Nix profile.
nix profile add .#hui          # or .#hui-desktop, including its desktop entry
```

Enable the `nix-command` and `flakes` experimental features in your Nix settings,
or pass `--extra-experimental-features 'nix-command flakes'` to each command.
For a remote public checkout:

```sh
nix run 'github:DaniFdz/hui' -- --help
```

#### Configure the package or NixOS service

Package overrides work in any consuming flake:

```nix
inputs.hui.packages.${system}.hui.override {
  withDesktop = true;
  gatewayHost = "127.0.0.1";
  gatewayPort = 5180;
  # electronPackage = pkgs.electron_44; # optional runtime override
}
```

For NixOS, import the module in your configuration (with `inputs` supplied by
your flake), then choose the options you need:

```nix
imports = [ inputs.hui.nixosModules.default ];
services.hui = {
  enable = true;                 # systemd gateway service
  user = "hui";                  # must already exist in users.users
  host = "127.0.0.1";            # or a specific IP / "tailnet"
  port = 5180;
  desktop.enable = true;          # install Electron + application-menu entry
  autoStart = true;
  openFirewall = false;
  # environment.PI_CODING_AGENT_DIR = "/home/hui/.pi/agent";
  # environmentFile = "/run/secrets/hui-env";
};
```

`desktop.enable` is independent of `enable`: GUI-only installations do not need
a service account. Other service options are `package`, `group`,
`workingDirectory` (defaults to the selected account's home), `environment` and
`environmentFile`. The service uses the selected user's normal HUI/PI state;
no user or transcript directory is created or migrated by the module. Keep
secrets in a runtime environment file, never literal Nix values. A custom
`package` is used as supplied; ensure it includes Electron if desktop is enabled.

The package's host/port defaults also apply when Electron starts the gateway.
Explicit `--host` / `--port` flags take precedence over `HUI_GATEWAY_HOST` /
`HUI_GATEWAY_PORT`, which override the package defaults. `--allow-host <name>`
(repeatable, remembered with the binding) or `HUI_GATEWAY_ALLOWED_HOSTS` grants
extra `Host` names, which is what a reverse proxy in front of the loopback
gateway presents. With no configured
values, the original `127.0.0.1:4173` behavior remains. An already-running gateway
is reused; restart it to apply a new binding. NixOS service arguments are fixed
by `services.hui.host` / `port`, or `environment.HUI_GATEWAY_ALLOWED_HOSTS` for
granted proxy names. Wildcard addresses remain unsupported.

Use `systemctl start|stop|restart hui` and `journalctl -u hui` for a module-managed
gateway, rather than starting a second detached CLI gateway. Systemd stop/restart
can interrupt active work. The desktop app reuses the service when launched as
the same user with matching HUI/PI/XDG directories. Custom service-only environment
variables are not automatically added to a graphical login session.

Electron is supplied by the pinned nixpkgs (`electron_44` by default), not npm's
binary downloader. Its patch version can differ from the npm package; the major
version is aligned and tested. Both package variants retain the browser UI.
User configuration and PI state remain outside the Nix store. Update through
Nix, not `hui update`: update the source/flake input and rebuild, or use
`nix profile list` and `nix profile upgrade <name>` for an installed remote flake.
Restart an already-running gateway to use the new build. A profile installed
from `.` follows that local checkout, not remote `main`.

## Run

```sh
export PATH="$HOME/.local/bin:$PATH"
hui gateway start
hui gateway status
hui ui
```

Useful lifecycle commands:

```sh
hui gateway restart
hui gateway logs --lines 100
hui gateway stop
```

`hui gateway logs` prints the tail of the private `gateway.log`: gateway
start-up plus every warning and error with its redacted cause, including
failures the browser reported, across restarts.
Settings → Logs shows the running gateway's entries, and **Export diagnostics**
saves them as JSON.

On a headless host, use `hui ui --no-open` to print the URL without opening a
browser. `hui browser` is an alias for `hui ui`. The development launcher is
separate from an installed production gateway.

## Desktop app and Spotlight (macOS)

The Electron app renders the same production UI and uses the existing managed
gateway. A global npm install registers **`~/Applications/HUI.app`** with its
own icon for Finder, Spotlight (**⌘Space → HUI**) and the Dock. `npm pack`
builds the archive; it does not register an application itself.

If npm blocks unreviewed install scripts, authorize the **absolute tarball
path**, not the package name (verified with npm 11.19):

```sh
npm install -g --prefix ~/.local --allow-scripts="$(pwd)/hui-0.1.0.tgz" ./hui-0.1.0.tgz
```

If HUI is missing from Spotlight, npm skipped the install script. Register it
explicitly (safe to rerun; it only replaces an HUI-owned bundle):

```sh
hui install-app
hui desktop          # open the app and return the terminal
```

The app starts or reuses the identity-checked gateway through the installed CLI,
including its active release selection. Closing the window or quitting Electron
**does not stop sessions or terminals**. Reopen the app or choose **HUI → Show
HUI** to restore the window; use `hui gateway stop` for normal gateway shutdown.
`hui desktop` opens the registered `HUI.app` on macOS (otherwise Electron
directly) and exits immediately. The window follows HUI's Appearance color mode; with **System** (the default)
both the page and the native title bar track the OS live.
External web and mail links open in the default browser. The renderer is
sandboxed without Node integration. Browser-local drafts have a separate Electron
profile; HUI/PI storage remains shared through the existing gateway.

Installation is per-user, without sudo, and downloads the platform's Electron
runtime. Reinstallation replaces only an HUI-owned bundle, never an unrelated
`HUI.app`. Quit the app before updating. Set `HUI_SKIP_APP_INSTALL=1` during npm
installation to opt out. Local checkout installs do not register an application.
The bundle is locally ad-hoc signed, not Apple-notarized. It records the npm
installation path, Node executable and PATH, never shell credentials. It depends
on that installation; rerun `hui install-app` if Node moves. Custom environment
overrides must be available to the graphical app. After npm uninstall, move the
remaining launcher to Trash manually; user data is not removed.

System-app registration currently supports macOS only. CLI desktop launching is
also available on ordinary Linux and Windows, but native execution is not proved
on this NixOS host. **macOS signature, Spotlight, Dock and native-window behavior
still need on-device verification**; see [desktop proof](e2e/desktop-package.browser.md).

## Updates

```sh
hui update --check
hui update
hui update --from /path/to/hui-next.tgz --sha256 <expected-sha256>
hui update --rollback
```

From the chat, `/update` opens the update flow in a dedicated **HUI update**
session under **OTHER**. The command stays in the composer and is never sent to
the model, so a failed update can be inspected and retried. Updates are
verified before activation, only run against an idle gateway, and keep the
previous release available for rollback.

## Develop

All changes land on `main` through a reviewed pull request; never push `main`
directly. Use a feature branch and the Vite development loop:

```sh
git switch main
git pull --ff-only
git switch -c feat/my-change
npm ci                         # first setup or after dependency changes
npm run dev                    # starts the Vite server and prints its URL; opens no window
npm run desktop                # build and open the Electron app against the managed gateway
```

Before handoff:

```sh
npm test
npm run typecheck
npm run build
npm run test:package
```

Then push the branch and open a pull request with `gh pr create`. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull request rules, the release
workflow and the installed-package test loop.

## Security and data

The gateway binds to loopback by default and has no user authentication. If
you need access from another device, explicitly bind to a trusted Tailscale
address or use an SSH tunnel:

```sh
hui gateway start --host tailnet
```

Reaching the loopback gateway through a reverse proxy instead (for example
`tailscale serve`) keeps the gateway on loopback and names the proxy's own host,
which the gateway refuses until it is listed. The name is remembered with the
binding:

```sh
hui gateway restart --allow-host laptop.example.ts.net
```

Repeat `--allow-host` for more names, or set the comma-separated
`HUI_GATEWAY_ALLOWED_HOSTS` when the gateway is started by something you do not
edit.

Keep the tailnet ACL tight. The browser's `x-hui` header is anti-CSRF, not an
authentication mechanism.

HUI stores settings, its session registry and update metadata under
`$XDG_CONFIG_HOME/hui` and `$XDG_DATA_HOME/hui`. PI continues to own agent
configuration and conversation transcripts.

The agent browser keeps its cookies and logins in
`$XDG_CONFIG_HOME/hui/browser/profile`, separate from your personal browser
profile. HUI controls it over a private DevTools pipe, so no debugging port is
opened.

## Stack

- [Vite](https://vite.dev/) for development and bundling
- [Lit](https://lit.dev/) for web components
- TypeScript and plain CSS with a shared design-token layer
- [PI](https://pi.dev) as the runtime backend

The application lives in `src/`; the local API and runtime adapters live in
`server/`.

## License and security

HUI is available under the [MIT License](LICENSE). Third-party attributions are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Please report
security issues privately as described in [SECURITY.md](SECURITY.md).

### Model providers

Open **Settings → Models** to connect a built-in provider using its API key or
supported OAuth sign-in, select one or more models and save. HUI stores these
connections under `~/.config/hui/providers/` (or `$XDG_CONFIG_HOME/hui/providers/`),
separately from PI. Credentials are not returned by status/config APIs.

Use PI's `models.json` for custom endpoints/providers. HUI merges those with its
own selections; adding a built-in to HUI overrides only that provider ID. Model
rows show context and maximum output, while subscription usage reports supported
provider quota windows and reset times. Unsupported quotas are labeled explicitly.
Reopen existing sessions after changing connections; new sessions use the updated
configuration. HUI-managed connections require the default PI SDK backend.
