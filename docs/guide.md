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

Settings → Models names three roles. The **primary model** does the real work:
choose the smartest model you have, speed doesn't matter. The **utility model**
does the quick work (session and branch names, Jira drafts, `/btw`, and for bots
their memory summaries, quick answers on calls and call summaries): choose the
fastest you have, ideally a cheap one. **GPT-Live** (Settings → Models → Calls)
talks on calls with bots: it is made for phone calls and quick to respond.

## Bots

A **bot** is a named, persistent agent: a role and standing instructions (its
persona), its own model, a working directory, and **one chat that never ends**.
Sessions stay what they were (coding work with worktrees, rewind and
`/compact`); a bot is for the assistant you come back to every day. Its chat is
an ordinary Pi Durable session on this gateway, so the chat view, streaming,
steering, follow-ups, questions and model switching work as in any session.

**Models.** A bot's **Model** does its real work: the smartest model you have.
Its **Utility model** does its quick work (the memory's summaries, quick answers
on calls, each call's summary): the fastest you have, ideally a cheap one. Without
one of its own it uses Settings' utility model, then its own model. From a
terminal: `hui bot edit ada --model openai-codex/gpt-6.1-sol --utility-model anthropic/claude-haiku-4-5`
(`--memory-model` is the same flag; `""` goes back to the default).

**Memory.** A bot's chat carries [OptChat](optchat.md) memory: every message is
kept word for word and a cheap model condenses the chat into a tree of one-line
summaries, so each turn starts fresh from a fixed-size view of the whole history
and the bot opens a line (`zoom`) when it needs the detail. The chat is never
compacted or cleared; when a turn has to wait for the newest messages to be
summarized, `hui bot chat` says "Summarizing memory…".

### The Bots tab

Settings → Sessions → **Show the Bots tab** adds an **Agents | Bots** switch to
the very top of the sidebar (it is off by default, and hiding it never stops a
bot or its routines). **Agents** is the usual sidebar; **Bots** shows only your bots,
most recently active first, with their latest message, and **+** creates one.
A bot's chat opens beside its **Routines |
Memory** panel: Routines adds schedules (every few minutes, hours or days,
daily, weekly or once, in your browser's time zone), runs one now and shows how
the last runs went; Memory shows how much the bot remembers and what writing
its summaries has cost, lets you open any summary line down to the original
message, and **Open memory page** opens the whole memory in a new tab. A row's
**⋯** menu edits, hides or archives the bot; **Show archived** lists archived
bots so you can restore them, or delete one for good with its trash icon after
a confirmation. Bot chats never appear among your sessions.

**Faces.** Every bot has an animated face, after OpenAI's Dots: a plush shape
(Blob, Pebble, Triangle, Heart or Cookie) in one of six colors, with two dot
eyes. It shows what the bot is doing: it breathes while idle, squints and
ponders while it thinks, bobs while a tool runs, tilts and hops while it waits
for your answer, gets sleepy while it summarizes its memory, droops after a
failure and does a little hop when a turn ends. On a call it fills the screen
in the bot's color, puffs up as it listens to your voice and stretches with its
own. The large faces (an empty chat, a call) look at your pointer. With
*reduce motion* on in your system settings the faces keep still and change only
their expression. The bot dialog's **Look** chooses **Face** (shape and color,
with a live preview) or **Emoji**; a bot that already had an emoji keeps it
until you choose Face. Bots you never styled get a face picked by their id, the
same on every screen.

### Creating and editing

```sh
hui bot add --name Ada --title Researcher --instructions-file ada.md --model openai/gpt-5.6
hui bot edit ada --thinking high --shape heart --color mint
hui bot edit ada --emoji 🦊      # an emoji instead of the face; --emoji "" goes back to the face
hui bot show ada
```

The handle (`@ada`) comes from the name: lowercase letters, digits and dashes,
with `-2`, `-3`… when another bot has it. Renaming keeps the handle. Without
`--cwd` a bot gets a private directory of its own in HUI's configuration
directory. The persona becomes the chat's standing instructions before its first
message can arrive; editing it applies from the bot's next request. A model
change goes through the chat like the model picker, and a new working directory
is accepted only while the bot is idle (its chat starts again there; should a
routine start a turn meanwhile, the edit is refused halfway: repeat it once the
bot is idle).
`--shape` (blob, round or pebble, triangle, heart, cookie) and `--color` (blue,
yellow, magenta, mint, coral, lilac or any `#rrggbb`) style the face; `""` goes
back to the one the bot's id picks. `hui bot show` prints the look.
`--memory-model` picks the model that writes the memory's summaries. An empty
value clears a choice: `hui bot edit ada --model "" --thinking ""` puts the chat
back on the model and thinking level a new chat gets (*Gateway default* in the
Bots tab's dialog), and `--memory-model ""` hands the summaries back to the
chat's own model.

A bot's chat refuses what would end or fork it: `/clear`, `/compact`, rewind
and deleting the session all answer with an explanation instead.

### Talking to a bot

`hui bot chat ada` streams the bot's replies as plain text, so it works over
SSH. Typed lines are prompts while the bot is idle and steer the turn while it
works; questions the bot asks are answered inline (a number, `y`/`n`, text or
`/cancel`). What the bot gets from elsewhere appears as a `> ` line before its
reply: a routine (`> [routine: Standup] …`), another bot (`> [from @bob] …`), a
message typed in the Bots tab or sent with `hui bot send`, so the terminal
shows the same conversation as the Bots tab. The first Ctrl+C stops a running
turn, the next one leaves.

`hui bot send ada "summarize today's PRs"` delivers one message: a prompt when
the bot is idle, a follow-up after its current turn when it is busy. `-` reads
the message from stdin. With `--wait` it prints the reply of the turn that
answers it and exits 0, 1 if that turn fails or `--timeout` (default 300
seconds) passes first (the bot keeps working), and 2 when the bot asks a
question, which you then answer in `hui bot chat`.

### Routines

Routines are Automation tasks aimed at a bot's chat; they appear in Automations
too.

```sh
hui bot routine add ada --name Standup --prompt "Summarize yesterday's work" --cron "0 9 * * 1-5"
hui bot routine add ada --name Inbox --prompt "Triage new issues" --every 2h
hui bot routine run ada Standup
hui bot routine list ada
```

A routine's message reaches the bot as `[routine: <name>] <prompt>`. A busy bot
takes it as a follow-up instead of skipping it, and the run completes when the
turn answering it ends. If that turn asks you something, the run waits for
your answer in the chat until the routine's timeout (15 minutes unless the task
says otherwise) stops the turn. `--every` takes `30s`, `5m`, `2h` or `1d`; Automation
refuses intervals under a minute. `--cron` uses this machine's time zone unless
`--timezone` names another.

### Bots talking to bots

Every bot's chat has a `message_bot` tool and a short list of the other bots.
A message arrives in the other bot's chat as `[from @ada] …`, and that bot
answers in its own chat; nothing comes back to the sender by itself. To stop
loops, an answer to a bot message is marked `[from @bob · hop 2]` and HUI
refuses to go beyond three hops; a bot can also send at most 30 bot messages an
hour. Archived bots can neither send nor receive them.

### Memory

```sh
hui bot memory ada                 # status, then the view the next turn starts from
hui bot memory ada --zoom 0+8      # open a view line into the two lines under it
hui bot memory ada --zoom 3+1      # n = 1: message 3, word for word
hui bot memory ada --html ada.html # the whole memory as one page
```

The status line counts the messages, the summaries built and still pending, the
view's size and lines, and what the compactor spent since the gateway opened the
memory (calls, tokens, cost). Every view line is `id+n|text`: `n` messages
from `id`, in one summary; `--zoom id+n` opens it, down to a single message
with `n` = 1. The page lists the view, every message and each level of the
tree; a browser opens it from a link on HUI's own pages, such as the Bots tab
(another site cannot load or frame it).

### Calls with GPT-Live

The phone button in a bot's header calls the bot. Calls talk to GPT-Live in
real time through the ChatGPT login you added in Settings → Models, so the
button shows once there is one. The call opens over the chat with the bot's
face in its color, a timer, captions of what you said and of the bot's answer,
and **Mute**, **Speaker** and **Hang up**. **Minimize** leaves a bar above the
chat, or at the top of any other page, with Mute and Hang up; it brings the call
back. One call runs at a time.

Settings → Models → **Calls** shows the account calls use (the first one not
waiting for its quota, as model turns choose) and the **default voice**. Each bot
can have its own **Call voice**, one of GPT-Live's voices, and a **Language**,
in its dialog or from a terminal:

```sh
hui bot edit ada --call-voice ember --language es
hui bot edit ada --call-voice "" --language ""   # back to Settings' voice and Auto
```

**Language.** *Auto (detect)* lets GPT-Live answer in the language you speak. A
bot's language (one of Whisper's, found by its name or code: `es`, `de`, `yue`…)
is the one it speaks on calls; its helper and the call's summary use it too.
Nothing is translated.

The call works like [OpenDots](https://github.com/CopilotKit/OpenDots):

- **GPT-Live talks.** It answers greetings, small talk and what the bot's
  instructions and recent memory already say, about a second after you stop.
- **Quick questions go to the bot's helper.** When GPT-Live needs to know
  something, it asks the bot: a helper on the bot's utility model answers from
  the bot's instructions, the newest part of its memory and the call so far, in
  a few seconds. What it cannot see there (older memory, files) it hands to the
  bot's chat instead of saying it does not know. It never waits for the bot's
  own turn. It has 25 seconds per question; past
  them GPT-Live says it is taking long and offers to hand it off.
- **Real work goes to the bot's chat.** What needs tools, files or current
  information arrives in the chat as a message starting with `[call task]`,
  done by the bot's own model and tools. GPT-Live tells you it is on it, and
  reads you the result if it comes while the call is still up. Otherwise it
  stays in the chat.
- **One card per call.** Nothing lands in the chat line by line. When you hang
  up, the utility model writes a summary in the bot's language: what was
  discussed, what was decided, facts to remember and tasks handed off. The chat
  gets one card with the call's duration, that summary and the whole
  transcript (both sides and the helper's answers), expandable. The bot's
  memory keeps both, so later turns and calls recall the call. A call whose
  page vanishes is summarized after 90 seconds without news from it; if the
  summary fails, the card keeps the transcript and says so.

A call ends after 15 minutes. The helper answers six questions per call (then
everything goes to the chat), a call hands off at most four tasks, and two calls
can run at once on the gateway. The route is the one ChatGPT's own voice mode
uses, not a public API: it may change, and calls count against your ChatGPT
plan's voice usage.

**Microphone.** Browsers give the microphone only to secure pages: open HUI on
`https://` (Tailscale Serve) or on this machine's `localhost`. HUI's desktop
app does not allow the microphone yet. The microphone opens only when you press
Call, and closes when the call ends.

### Archiving and deleting

`hui bot remove ada` archives the bot: its chat transcript and memory are kept,
a running turn stops, messages still queued for it are withdrawn and its
routines are disabled. `hui bot list --archived` (or **Show archived** in the
Bots tab) shows archived bots and `hui bot restore ada` (or their **Restore**)
brings one back; its routines stay disabled until you turn them on again in
Automations or its Routines panel.

`hui bot delete ada` (or an archived bot's trash icon in the Bots tab) then
deletes an archived bot for good: its routines and its
chat's session record go, and HUI no longer lists or opens its conversation,
which stays in the Pi Durable store like a deleted session's transcript. The
files in its folder stay; a folder HUI made for it goes only when empty. An
active bot is refused, so archiving always comes first.

### Privacy

Bots live in HUI's own files on this machine: `bots.json` (owner-only) in HUI's
configuration directory, their chats in the Pi Durable store and their memory
beside it. Nothing about a bot leaves the machine except the model requests its
chat and its memory's compactor make to the providers you configured. A
GPT-Live call sends your voice from the browser straight to OpenAI under your
ChatGPT account, and the gateway sends the call's instructions (the bot's
instructions and the newest part of its memory) when it starts the call; the
helper and the summary use the bot's utility model like any other request. The
ChatGPT credential stays in the gateway. HUI stores no audio: what stays is each
call's card (its summary and transcript) in the bot's chat.

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
