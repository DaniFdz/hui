# HUI user guide

Reference material for installing and operating HUI beyond the
[quick start](../README.md#quick-start).

## Nix and NixOS

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

### Configure the package or NixOS service

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
skips HUI's active-work check: Pi Durable runs resume afterwards, but sessions
still on PI's SDK worker, queued follow-ups and terminals are interrupted. The
desktop app reuses the service when launched as the same user with matching
HUI/PI/XDG directories. Custom service-only environment
variables are not automatically added to a graphical login session.

Electron is supplied by the pinned nixpkgs (`electron_44` by default), not npm's
binary downloader. Its patch version can differ from the npm package; the major
version is aligned and tested. Both package variants retain the browser UI.
User configuration and PI state remain outside the Nix store. Update through
Nix, not `hui update`: update the source/flake input and rebuild, or use
`nix profile list` and `nix profile upgrade <name>` for an installed remote flake.
Restart an already-running gateway to use the new build. A profile installed
from `.` follows that local checkout, not remote `main`.

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
still need on-device verification**; see [desktop proof](../e2e/desktop-package.browser.md).

## Remote access through a reverse proxy

[Security and data](../README.md#security-and-data) covers binding the gateway
to a tailnet address. Reaching the loopback gateway through a reverse proxy instead (for example
`tailscale serve`) keeps the gateway on loopback and names the proxy's own host,
which the gateway refuses until it is listed. To keep the name across updates,
reboots and desktop launches, list it in `~/.config/hui/gateway/config.json`
(or `$XDG_CONFIG_HOME/hui/gateway/config.json`), which the gateway reads on
every start:

```json
{ "allowHosts": ["tailnet", "proxy.example.ts.net"] }
```

`"tailnet"` is this machine's Tailscale DNS name, looked up on each start and
skipped while Tailscale is down. A malformed file stops the gateway from
starting. For a one-off grant, `hui gateway restart --allow-host
laptop.example.ts.net` (repeatable) or the comma-separated
`HUI_GATEWAY_ALLOWED_HOSTS` last only until the gateway fully stops.

## Model providers

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

## Interactive widgets in the chat

Agents and bots can show a small interactive HTML or SVG widget right in the
transcript: a mockup to click through, a simulation, an explorable diagram or a
dashboard of numbers they gathered. Ask for one ("show me this as an interactive
widget") or let the agent decide; it calls the `show_widget` tool and the
bundled `visualize` skill tells it when a widget beats plain text.

- The widget appears as a card with its title. It follows HUI's theme, light or
  dark, as you switch, and the card grows to fit it.
- **Open full screen** (the arrow in the card's corner) gives it the whole
  window without restarting it; Escape or the same control brings it back.
- Links inside a widget open in a new tab when you click them.
- If the widget hits an error, or tries to load something it may not, the card
  shows a notice under it. The agent does not see your clicks or those notices;
  tell it what went wrong.
- Widgets are part of the conversation: they are back after a reload or a
  gateway restart, and go away when you delete the session.

## Giving an agent a secret

When an agent needs an API key, a token, a password or a one-time login code,
it asks for it with a **Secret** card above the composer instead of asking you
to paste it into the chat. The card names the secret and says why the agent
needs it; type or paste the value into the masked field and press **Submit**,
or **Cancel** to refuse. The session shows *Waiting* until you answer, and the
request expires after 15 minutes.

- The value never appears in the conversation, the agent's history or HUI's
  stores. The agent only receives the path of a private temporary file that
  holds it, uses it in its next command and deletes it; HUI deletes it after
  10 minutes in any case, or when it stops (after a crash, when it starts
  again).
- Stopping the agent, or restarting HUI, cancels a request you have not
  answered.
- Sessions on a remote worker cannot ask for secrets yet.

A widget is code the agent wrote, so HUI runs it in a sandbox: it cannot reach
HUI or its API, read the conversation, your cookies or storage, change or
navigate the HUI page, open pop-ups or fetch anything from the network. It may
load scripts, styles and fonts from a few public CDNs (cdnjs, jsDelivr, esm.sh,
unpkg, Google and Bunny fonts), which then see your IP address.
[docs/api.md](api.md#agent-widgets) has the full contract.

## After an upgrade: `hui doctor`

`hui doctor` reports state that an upgraded HUI needs changed, and
`hui doctor --fix` changes it. The report only reads, so it is safe while the
gateway runs. It exits 0 when nothing is left to change and 1 otherwise;
`--json` prints the same report for scripts.

```sh
hui doctor
hui gateway stop   # or stop the systemd unit, and any development gateway
hui doctor --fix
hui gateway start
```

`--fix` refuses while a gateway runs: it reads the gateway's state, and the
Durable session store stays locked by any gateway that has it open. It holds the
lifecycle lock, so no gateway starts meanwhile. Run it with the gateway's
environment (`XDG_CONFIG_HOME`, `HUI_DURABLE_DIR`, `PI_CODING_AGENT_DIR`) so it
finds the same state.

### PI sessions

New sessions run on Pi Durable. `hui doctor` lists the sessions still on PI's
SDK worker, and `--fix` moves each one into a new Durable conversation:

- The active branch moves in order: its messages, tool calls and results, each
  compaction summary in place, and the context PI would send next. The session
  continues on its model and thinking level, and its spend moves with it, so
  usage totals do not change.
- PI's transcript is only read, and stays where it was, unchanged. Entries on
  abandoned branches, left by a rewind, remain only there.
- The session registry is copied to `$XDG_CONFIG_HOME/hui/backups/` before its
  first change. Restoring that copy, with the gateway stopped, puts the sessions
  back on PI without anything said on Durable since.
- A session with an interrupted run stays on PI: start the gateway so the run
  finishes, or stop it, then run `--fix` again. A session whose PI file is
  missing stays as it is.
- Running `--fix` again is safe: a session copied before from an unchanged file
  reuses that copy.
