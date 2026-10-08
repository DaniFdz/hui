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
talks on calls with bots: it is made for phone calls and quick to respond. Calls
are with bots only, so that section shows while [bots](#bots) are on.

## Bots

> **Bots are a preview.** They are still being built, so they are off until you
> turn them on: Settings → Labs → **Bots**, their one switch. The sidebar then
> gets its **Agents | Bots** switch ([below](#the-bots-tab)). If you had
> Settings → Sessions → *Show the Bots tab* on before it existed, bots stay on.

While bots are off they are dormant everywhere, and nothing is deleted:

- The sidebar has no Agents | Bots switch, a bot's address (`/bots/…`) opens
  the home page, and Settings hides Sessions → Bots and Models → Calls.
  Automations leaves the bots' routines out, and the Contributions calendar
  their chats. Bot chats never show among your sessions, on or off.
- The gateway refuses every bot route and call, and the session routes of a
  bot's chat, with `Bots are off on this gateway: they are a preview. Turn them
  on in Settings → Labs → Bots.` That is also what every `hui bot` command
  prints.
- Routines are kept but skipped: Automations records each time that comes due
  as *Skipped* with that reason, and a skipped time isn't run later.
- Nothing starts a bot's turn. Turning bots off stops what they were doing, as
  archiving does: a running turn stops, messages still queued for a bot are
  withdrawn, and a call ends.

Turn them on again and everything is back as it was (their chats, memory,
SOUL.md, routines and settings), at once and without a restart; each routine
runs at its next time.

A **bot** is a named, persistent agent: a role, a persona it writes with you
(its SOUL.md), its own model, a working directory, and **one chat that never
ends**.
Sessions stay what they were (coding work with worktrees, rewind and
`/compact`); a bot is for the assistant you come back to every day. Its chat is
an ordinary Pi Durable session on this gateway, or on a remote worker if you
[create it there](#bots-on-a-worker), so the chat view, streaming, steering,
follow-ups, questions and model switching work as in any session.

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

While bots are on (Settings → Labs → **Bots**), an **Agents | Bots** switch tops
the sidebar. **Agents** is the usual sidebar; **Bots** shows only your bots,
most recently active first, with their latest message, and **+** creates one at
once: a bot called *New Bot* whose chat opens on its greeting, asking what to call
it and what you expect from it (the chat opens on a small note, "New Bot was
created", where that first turn began).
A bot's chat opens beside its **Routines | Memory | Soul | Tools | Settings** panel:
Routines adds schedules (every few minutes, hours or days, daily, weekly or
once, in your browser's time zone), runs one now and shows how the last runs
went; Memory shows how much the bot remembers and what writing its summaries
has cost, lets you open any summary line down to the original message, and
**Open memory page** opens the whole memory in a new tab; Soul shows the bot's
SOUL.md, with **Edit** to change it yourself (or, before the bot has written
one, **Write it yourself**), and follows it when the bot rewrites it; Tools
turns the bot's tools and skills on and off ([Tools and skills](#tools-and-skills));
Settings is everything else you can change about the bot ([below](#creating-and-editing)).
A row's **⋯** menu (also in the bot's chat header) opens its Settings (**Edit
bot…**), hides, archives or deletes the bot; **Show archived** lists archived
bots so you can restore them, or delete one with its trash icon. Deleting asks
first, and takes the bot's chat, routines, memory and folder. Bot chats never
appear among your sessions.

**Faces.** Every bot has an animated face, after OpenAI's Dots: a plush shape
(Blob, Pebble, Triangle, Heart, Cookie, Star, Flower, Cloud, Drop, Ghost, Pill,
Block or Hexagon) in one of six colors, with two dot eyes, and if you like cat,
bear or bunny ears, an antenna, a sprout or horns on top. It shows what the bot is doing: it breathes while idle, squints and
ponders while it thinks, bobs while a tool runs, tilts and hops while it waits
for your answer, gets sleepy while it summarizes its memory, droops after a
failure and does a little hop when a turn ends. On a call it fills the screen
in the bot's color, puffs up as it listens to your voice and stretches with its
own. The large faces (an empty chat, a call) look at your pointer. With
*reduce motion* on in your system settings the faces keep still and change only
their expression. The **Look** in a bot's Settings tab chooses **Face** (shape, ears
and color) or **Emoji**; a bot that already had an emoji keeps it until you choose
Face. You can also just tell the bot ("be a ghost with horns"): it changes its own
look, but only when you ask in your own message. Bots you never styled, new ones
included, get a face picked by their id (one of the first five shapes, no ears),
the same on every screen.

### Creating and editing

Setting a bot up works like [Grok Bot](https://docs.x.ai/grok-bot/bots): there
is no form. The **+** above the roster (or **New bot** in an empty roster)
creates a bot at once and opens its chat (with a remote worker, + asks where:
[Bots on a worker](#bots-on-a-worker)). It is called *New Bot* until you tell
it its name: its first message greets you and asks what to call it, and it
renames itself when you answer ([below](#soul-and-the-first-conversation)).
Everything else starts on the defaults: the model and thinking level a new
session gets, Settings' utility model, Settings' call voice, *Auto* for
the language, a private folder of its own and the face its id picks.

**Settings** is the panel's last tab. **Edit bot…** in a bot's **⋯** menu (its
roster row's or its chat header's) opens the bot's chat on it (the docked panel,
or the sheet on a phone), and **Ctrl+Shift+,** (**⇧⌘,** on a Mac) shows or hides
it on a bot's chat. It has:

- **Profile**: the **Name** (its handle under it), the **Title** and the
  **Look**, whose **Change** opens Face (shape, ears and color) or Emoji.
- **Model**: the **Model**, **Thinking** and **Utility model** (below).
  *Gateway default* (and *Default* for the utility model) clears the bot's own
  choice. A change applies from the bot's next turn.
- **Calls**: the bot's **Call voice** (*Default* follows Settings → Models →
  Calls) and the **Language** it speaks on calls
  ([Calls with GPT-Live](#calls-with-gpt-live)). Until HUI has a ChatGPT login,
  the section says *Needs a ChatGPT login*; both still save.
- **Workspace**: the bot's **Directory**, which can change only while the bot
  is idle (the field is locked while it works). While you have a remote worker,
  **Runs on** shows the machine the bot stays on: *Local*, or its worker
  ([below](#bots-on-a-worker)).

Every change saves on its own as you make it; there is no Save button. A row
says *Saving…* while the gateway takes the change and shows the reason if it
refuses one. Typed text (the name, title, emoji or directory) saves on Enter or
when you leave the field, and Escape takes it back.

```sh
hui bot add                      # "New Bot", which asks what to call it
hui bot add --name Ada --title Researcher --model openai/gpt-5.6
hui bot edit ada --thinking high --shape heart --color mint
hui bot edit ada --emoji 🦊      # an emoji instead of the face; --emoji "" goes back to the face
hui bot show ada
```

The handle (`@ada`) comes from the name: lowercase letters, digits and dashes,
with `-2`, `-3`… when another bot has it. Renaming moves a handle that came from
the old name to the new one (`new-bot` becomes `scout`); a handle you chose
stays. A bot added without a name is "New Bot" until it asks you what to call
it. Every bot
gets a private home folder in HUI's configuration directory, where its SOUL.md
lives; without `--cwd` that folder is also its working directory. Without
`--model` a bot runs on Settings' primary model, as a new session does (PI's
default only while none is set). A model change goes through the chat like the
model picker, and a new working directory
is accepted only while the bot is idle (its chat starts again there; should a
routine start a turn meanwhile, the edit is refused halfway: repeat it once the
bot is idle).
`--shape` (blob, round or pebble, triangle, heart, cookie, star, flower, cloud,
drop, ghost, pill, block, hexagon), `--ears` (cat, bear, bunny, antenna, sprout,
horns) and `--color` (blue, yellow, magenta, mint, coral, lilac or any `#rrggbb`)
style the face; `""` goes back to the shape or color the bot's id picks, and
takes the ears off. `hui bot show` prints the look.
`--memory-model` picks the model that writes the memory's summaries. An empty
value clears a choice: `hui bot edit ada --model "" --thinking ""` puts the chat
back on the model and thinking level a new chat gets (*Gateway default* in the
bot's Settings tab), and `--memory-model ""` puts the utility model back on its
default (Settings' utility model, then the chat's own model).

A bot's chat refuses what would end or fork it: `/clear`, `/compact`, rewind
and deleting the session all answer with an explanation instead.

### Soul and the first conversation

A bot's persona is its **SOUL.md**: who it is, what it looks after, how it works
and sounds, when it reaches out to you and its boundaries. You don't fill in a
form for it. A new bot speaks first: as soon as it is created, HUI starts its
first turn, and its opening message is waiting when you open its chat (the chat
shows a small note, "Ada was created", where that turn began). It asks what you
expect from it, one or two questions at a time (a bot still called "New Bot"
first asks what to call it, and renames itself). Once it knows enough, usually
after a few answers, it writes SOUL.md itself (with a tool of its own, so it
needs no file access): only what you told it or agreed to, since it asks rather
than guesses. Then it says so, sums it up and tells you how to change it. If
your first message asks for real work, it does the work first. A bot created
with a name (`hui bot add --name Ada`) never asks about its name. Messages from
routines, triggers and other bots don't count as you.

From then on every turn reads SOUL.md, so a change applies from the next
request. To change it, tell the bot ("be more formal", "don't message me before
nine"): it edits SOUL.md and says so. Only your own messages can make it do
that, as with its name: in a turn that a routine, a trigger or another bot
started, or that took a message from one while it ran, it can't rewrite
SOUL.md, so text from elsewhere never becomes what steers it from then on. Or
edit it yourself in the bot's **Soul** tab, or from a terminal:

```sh
hui bot soul ada                    # print SOUL.md
hui bot soul ada --file soul.md     # replace it (- reads stdin)
hui bot add --name Ada --soul-file soul.md   # start with one: no first conversation
```

An empty file removes SOUL.md, and the bot asks what you expect again at its
next turn. SOUL.md holds up to 20,000 characters; the chat reads only that
much of a longer file and the bot is told to shorten it. Bots created before
SOUL.md had their instructions turned into it once, the first time the gateway
started with this version; a bot that had none starts its first conversation
at its next turn.

### Tools and skills

A bot has every tool and skill a session in its directory has: reading,
writing and editing files, the shell, HUI's tools (the shared terminal,
subagents, the browser, presenting media…), its PI extensions' tools,
messaging other bots, managing its own routines, and the skills PI finds there.
Everything is on until you
turn something off, and whatever appears later (a new extension, a HUI update, a
new skill) is on too. That is the trade-off of everything on by default: a bot
you restricted by hand gains newly installed tools, so look at its Tools tab
after installing one.

The bot panel's **Tools** tab shows **Available tools**, grouped as Files,
Shell, HUI, each extension by its source, and Bots, each with a switch and what
it does, then its **Skills** (with a search once there are many). A change
applies from the bot's next request. Some tools are labelled **Powerful**: they
reach past whatever else is off. The shell, the shared terminal and watchers run
commands; writing and editing files can change what other programs load; the
browser opens HUI's own page and local files; spawning, messaging and steering
sessions acts through a session that has every tool. They are on by default
like the rest. Asking you for a secret (**Request secret**, under HUI) is not
powerful: it only shows you a Secret card in the bot's chat, and you decide
whether to answer. Its own tools are always on and listed at the bottom: writing its
SOUL.md, changing its name or title, asking for access, loading its skills, and
its memory.

```sh
hui bot tools ada                      # what it has, grouped, on or off
hui bot tools ada --deny bash,terminal # turn tools off
hui bot tools ada --allow bash         # and back on
hui bot skills ada --deny release-notes
hui bot add --name Scout --deny-tools bash,write,edit --deny-skills release-notes
```

`--deny-tools` at creation knows the tools every chat has; an extension's tools
can be turned off once the bot exists.

When the bot needs something you turned off, it asks: a question appears in its
chat (and at the top of its Tools tab, and in `hui bot chat`) naming what it
wants, marked when it's powerful, and why, with **Allow** and **Deny**. Only you
answer it: a request raised in a turn a routine or another bot started says so,
and still waits for you. Allow turns the items back on from the bot's next step;
Deny leaves them off and the bot carries on without them. It asks for one thing
at a time and can't ask for tools it already has.

A bot without the read tool and the shell still uses its skills, through a tool
of its own that loads them. Turning off a skill removes it from what the bot is
told and from its `/skill:` commands.

**Tools are the boundary, not a sandbox.** With the shell or the read tool a bot
can reach whatever your account can, the files of skills you turned off and
HUI's own API included. Messaging other bots lets it ask a better-equipped bot
to do something for it; turn **Message bots** off to prevent that. To really
isolate a bot, run it on a worker in a container. **Manage its own routines**
is not powerful: it only schedules prompts to the bot's own chat
([Routines](#routines)); turn it off and the bot keeps only the routines you
give it.

### Bots on a worker

A bot can live on a remote worker (Settings → Workers) instead of this
machine: its chat runs there, and its conversation, memory, folder and SOUL.md
are kept there, so it works next to that machine's files, and a turn it started
keeps going while HUI is away from it. Once you have a worker, the roster's
**+** is a small menu, **New bot on Local** or **New bot on devbox**: a choice
creates *New Bot* there at once and opens its chat, where it greets you, asks
what to call it and what you expect, and writes its SOUL.md on the worker, as
above. From a terminal:

```sh
hui bot add --worker devbox                               # New Bot, in its home folder on devbox
hui bot add --name Rover --worker devbox --cwd ~/src/app  # a folder there: absolute or ~/
```

HUI must be connected to the worker when you create the bot. Where a bot runs
is chosen once: it never moves, and its Settings tab shows the machine
(**Workspace → Runs on**) without offering to change it. Its home folder, HUI's
private folder for it under the worker's HUI data directory
(`~/.local/share/hui-worker/bots/<id>`), holds its SOUL.md and is its working
directory unless you choose a folder on the worker (its Settings tab suggests
that worker's folders, never this machine's), shown as `devbox:/path`; SOUL.md
never goes in a folder you chose. The roster and the bot's chat show the worker beside its name,
`hui bot list` marks it `on devbox` and `hui bot show` names it.

Everything else works as for a bot here: messages, routines, Stop, its Memory
panel and Soul tab, calls, archiving and deleting, and messages between bots in
both directions (a bot on a worker sees every bot in its list). Its memory's
summaries are written on the worker with its utility model. A secret it asks for
is given in its chat's **Secret** card here, as for any session on a worker, and
the worker writes the file, where its commands run.

**When the worker is offline**, the bot shows it (reconnecting, or
disconnected), its row keeps its latest message, its Memory panel and Soul tab
say the worker is offline, and messages to it fail with that reason until HUI is
connected again. Deleting it still takes it off the roster at once: HUI notes
what is left on the worker (its memory and home folder) on this machine and
removes them the next time it connects to the worker; removing the worker first
drops the note.

Its **Tools** tab shows what a bot there can have: the tools of a session on that
worker, its extensions' included, and its skills where the worker keeps them, your
skills by their mirrored copies there (`~/.local/share/hui-worker/mirror/agent/skills`).
It doesn't list the terminal, the browser or watchers: they stay on this machine,
so the bot isn't offered them and there is nothing to turn off. What you turn off is
kept and enforced on the worker; when the bot asks for something back, you
answer here, and its Tools tab and roster row follow. While the worker is offline
its Tools tab says so, like its Memory and Soul.

**Limits.** A bot on a worker has the limits of any session on a worker: the
terminal, the managed browser and watchers act on this machine, so it can't use
them, and it can't use worktrees. A worker can't be removed while bots run on
it; delete them first.

### Talking to a bot

`hui bot chat ada` streams the bot's replies as plain text, so it works over
SSH. Typed lines are prompts while the bot is idle and steer the turn while it
works; questions the bot asks are answered inline (a number, `y`/`n`, text or
`/cancel`). A secret it asks for is the exception: `hui bot chat` names it, but
you give it in the **Secret** card of the bot's chat in HUI, so it never shows in
the terminal (`/cancel` still refuses it). What the bot gets from elsewhere
appears as a `> ` line before its
reply: a routine (`> [routine: Standup] …`), another bot (`> [from @bob] …`), a
message typed in the Bots tab or sent with `hui bot send`, so the terminal
shows the same conversation as the Bots tab. The first Ctrl+C stops a running
turn, the next one leaves.

`hui bot send ada "summarize today's PRs"` delivers one message: a prompt when
the bot is idle, a follow-up after its current turn when it is busy. `-` reads
the message from stdin. With `--wait` it prints the reply of the turn that
answers it and exits 0, 1 if that turn fails or `--timeout` (default 300
seconds) passes first (the bot keeps working), and 2 when the bot asks a
question, which you then answer in `hui bot chat` (a secret in its Secret card).

### Routines

Routines are Automation tasks aimed at a bot's chat; they appear in Automations
too. You add them in the bot's Routines tab, in Automations, or from a terminal,
where `hui schedule` manages every scheduled task and `hui bot routine` a bot's:

```sh
hui bot routine add ada --name Standup --prompt "Summarize yesterday's work" --cron "0 9 * * 1-5"
hui bot routine add ada --name Inbox --prompt "Triage new issues" --every 2h
hui bot routine run ada Standup
hui bot routine list ada
hui schedule add --bot ada --name "Watch #82" --prompt "Is PR #82 green yet?" --every 5m --until 2026-10-07T18:00 --runs 12
hui schedule list --bot ada
```

A bot can also schedule its own routines, with a tool of its own: ask it to
"check every 5 minutes until #82 is green" and it adds a **temporary** routine
that ends by itself, at a time (*until 18:00*) and/or after a number of runs
(*3 runs left*), and removes it as soon as it's done, even from that routine's
own turn. The Routines tab and Automations show who made each one (*made by
@ada*) and its limits. A bot only ever sees and changes the routines of its own
chat, can have at most 20 active ones, never more often than once a minute, and
a message from another bot or a trigger can't make it add or change one (yours
and its routines' can). Turn **Manage its own routines** off in its Tools tab
to stop it.

A routine's message reaches the bot as `[routine: <name>] <prompt>`. A busy bot
takes it as a follow-up instead of skipping it, and the run completes when the
turn answering it ends. If that turn asks you something, the run waits for
your answer in the chat until the routine's timeout (15 minutes unless the task
says otherwise) stops the turn. `--every` takes `30s`, `5m`, `2h` or `1d`; Automation
refuses intervals under a minute. `--cron` uses this machine's time zone unless
`--timezone` names another.

While bots are off ([above](#bots)) a routine whose time comes is skipped, not
failed: Automations records the run as *Skipped* with the reason, the routine
stays on, and that time isn't run later. Once bots are on again it runs at its
next time. (A once routine whose time passes while they are off is used up, as
the scheduler turns any one-off task off once its time comes.) Times missed
while the gateway itself was down are different: each overdue routine runs once
when it starts again. A skipped run doesn't count against a temporary routine's
runs, but its end time still comes.

### Schedules from a terminal

`hui schedule` (or `hui schedules`) manages every scheduled task, a session's
or a bot's, through the running gateway, as the Automations page does.
`<schedule>` is a task's id or exact name; `--session` takes a session's id or
exact title, `--bot` a bot's handle, id or name:

```sh
hui schedule list                                  # every schedule: target, next run, maker and limits
hui schedule list --session "Docs cleanup" --json
hui schedule show "Watch #82"
hui schedule add --name "Nightly review" --prompt "Review open work" --cron "0 2 * * *" --session "Docs cleanup"
hui schedule add --name "Release" --prompt "Is v0.2 out?" --every 1h --bot ada --until 2026-10-10T18:00 --runs 24 --timeout 300
hui schedule edit "Nightly review" --cron "30 2 * * *" --timezone Europe/Madrid
hui schedule edit "Watch #82" --session "Docs cleanup"  # moves it
hui schedule edit "Watch #82" --until "" --runs ""       # no longer temporary
hui schedule pause "Nightly review"
hui schedule resume "Nightly review"
hui schedule run "Nightly review"
hui schedule remove "Nightly review"
```

Edit changes only the flags you give. `--every` takes `30s`, `5m`, `2h` or
`1d` (a minute at least), `--cron` five fields in this machine's time zone
unless `--timezone` names another, `--at` one ISO date and time, and
`--timeout` how long one run may take (10–86400 seconds, 15 minutes by
default); `--disabled` creates a schedule paused (or pauses it on edit). While
bots are off, `hui schedule` refuses anything that names a bot or one of its
routines with the gateway's message, and `list` leaves bots' routines out;
sessions' schedules work as always.

### Triggers

Triggers wake a bot when something happens, the way routines wake it on a
schedule: a pull request changes on GitHub, a session the bot started finishes,
fails or asks something, another program calls the trigger's webhook URL, or
someone pings you in Slack ([Slack](#slack), below).
They sit in the bot's **Routines** tab, under its routines: each shows what it
watches, when it last fired, its cooldown and an on/off switch, with **Test**
(a sample event, now) and **Delete**; **Add trigger** below them. From a
terminal:

```sh
hui bot trigger add ada --name CI --github DaniFdz/hui --on checks_failed,review_changes_requested --prompt "Find out what broke"
hui bot trigger add ada --name Deps --github DaniFdz/hui --on pr_opened --author "dependabot[bot]" --label dependencies
hui bot trigger add ada --name Helpers --session --on finished,failed,waiting
hui bot trigger add ada --name Deploys --webhook --match status=failed --prompt "Tell me why the deploy failed"
hui bot trigger add ada --name Reviews --slack --on mention,dm --pr-links --prompt "Review the pull request"
hui bot trigger list ada
hui bot trigger test ada CI
hui bot trigger remove ada Deploys
```

An event reaches the bot as `[trigger: <name> · <summary>] <prompt>` with the
event's details, as a routine's message does (a follow-up while it works). Events
within a trigger's cooldown (5 minutes unless you choose another, `--cooldown`)
arrive together, as one message listing them, and a bot takes at most 12
trigger messages an hour; more wait for the next free slot rather than being
dropped. Each delivery shows under **Latest trigger runs**.

- **GitHub** reads the repos through the gateway's GitHub CLI login (Settings →
  Integrations → GitHub), every minute, with conditional requests, so a repo
  where nothing happens costs nothing of your rate limit. It wakes on pull
  requests opened, pushed to, merged or closed, checks that failed or passed,
  reviews (approved, changes requested, commented), comments, and comments that
  mention you; narrow them by author, label, base branch, pull request number or
  drafts. Your own comments and reviews never wake a bot: a bot that comments
  through `gh` posts as you. A new trigger starts from what the repo looks like
  then; it doesn't replay the past.
- **Sessions** wake a bot when a session it started itself (with
  `sessions_spawn`) finishes, fails or waits for an answer.
- **Webhook** makes a URL with a secret token, shown once (copy it then; **New
  URL** replaces it). Programs on this machine or your tailnet POST JSON or text
  to it, up to 64 KiB; `--match field=value` (or `field~value` for contains)
  keeps only matching calls. The gateway stays on your tailnet: exposing the URL
  to the internet with Tailscale Funnel is up to you, and then the token is all
  that guards it.

A bot can manage its own triggers with its `triggers` tool (Tools tab, under
Bots): ask it to watch a repo and it adds one. It can't add or change triggers
in a turn another bot or a trigger started, or that took a message from one
while it ran, and it can't create webhook triggers, whose token would pass
through the model.

While bots are off nothing fires: GitHub and Slack aren't read, webhook URLs
answer 409, and a session event is recorded as skipped. When you turn them on
again, what happened on GitHub, or who pinged you in Slack, meanwhile arrives as
one summary per trigger, not one message per event.

#### Slack

A Slack trigger wakes a bot when someone pings you in Slack: a message in a
channel or group DM that @-mentions you, or a direct message to you, usually
"could you review this?" with a pull request link. Your teammates change
nothing: HUI reads, as you, the messages that ping you, about once a minute,
through a Slack app you create in your own workspace. It is read-only: HUI never
posts, reacts or edits in Slack.

**Create the app** (once):

1. Open [Slack apps](https://api.slack.com/apps), choose **Create New App →
   From a manifest**, pick your workspace and paste this manifest (Settings →
   Integrations → Slack has a **Copy manifest** button):

   ```json
   {
     "_metadata": {
       "major_version": 2,
       "minor_version": 1
     },
     "display_information": {
       "name": "HUI pings",
       "description": "Lets your own HUI gateway read the Slack messages that mention you or are sent to you. Read-only.",
       "background_color": "#1f2328"
     },
     "settings": {
       "org_deploy_enabled": false,
       "socket_mode_enabled": false,
       "token_rotation_enabled": false
     },
     "oauth_config": {
       "scopes": {
         "user": [
           "search:read",
           "users:read",
           "channels:history",
           "groups:history",
           "im:history",
           "mpim:history"
         ]
       }
     }
   }
   ```

   It asks only for user token scopes, all read-only, and has no bot user:

   - `search:read`: find the messages that mention you and the direct messages
     sent to you (`search.messages`);
   - `users:read`: name who asked, and tell bots, apps and people outside your
     workspace apart (`users.info`);
   - `channels:history`, `groups:history`, `im:history`, `mpim:history`: read the
     message a thread reply answers, in public channels, private channels, DMs
     and group DMs (`conversations.replies`).

   Keep token rotation off: a rotating token expires within a day, HUI doesn't
   refresh it, and Slack can't turn rotation off again once it is on.
2. **Install to Workspace** (on the app's Basic Information or OAuth & Permissions
   page) and allow it. Many company workspaces need a workspace admin to approve
   apps first; Slack then offers to send them a request
   ([Slack's guide](https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace)).
3. Copy the **User OAuth Token** (`xoxp-…`) from **OAuth & Permissions** and
   connect it: Settings → Integrations → Slack, paste it and **Connect**, or

   ```sh
   hui slack connect      # asks for the token without echoing it; or: pbpaste | hui slack connect
   hui slack status       # who, which workspace, whether Slack still accepts the token
   hui slack disconnect   # removes it from this machine
   ```

HUI checks the token with Slack (`auth.test`), shows who it is and which
workspace, and keeps it in `~/.config/hui/slack.json`, readable by you only; it
never reaches the browser, a log or a diagnostic, and goes nowhere but Slack. If
the token is revoked or expires, or the app is removed, the status says **Token
revoked or expired: connect again**.

**Review requests, by a bot without a shell.** Give the review to a bot that can't
run commands, so a Slack message can't make it act on your machine or on GitHub
as you:

```sh
hui bot add --name Reviewer --deny-tools bash,terminal,watcher,write,edit,browser,sessions_spawn,sessions_send,subagents
hui bot trigger add reviewer --name Reviews --slack --on mention,dm --pr-links \
  --prompt "Someone asked me to review this pull request. Review it from the details below: what it changes, what could break, and the comments you'd leave. Don't run commands or change anything; tell me here."
```

or, in the bot's Routines tab: **Add trigger → Slack → Review requests**, which
fills in mentions and DMs, PR links only, a name and that prompt. Each delivery
says who asked (their display name) and where, quotes the message (and, for a
thread reply, the message it answers), links to it, and carries every linked pull
request as the gateway's `gh` reads it: title, author, state, base and head, the
description, the changed files with their additions and deletions, and the diff,
each cut at a bound that says so (or what `gh` couldn't read). The bot reviews
from that alone and answers in its chat; nothing is posted to Slack or GitHub.

- **Filters.** `--on mention,dm`; `--pr-links` keeps only messages linking a
  GitHub pull request (a thread reply without one counts its thread's);
  `--from maria,bob` (a handle, display name or member id) and `--in
  team-reviews` (a channel name or id; DMs aren't channels) narrow it. Bots and
  apps, and people outside your workspace (Slack Connect), wake it only with
  `--allow-bots` and `--allow-external`; your own messages never do.
- **Once each, from now.** A new trigger starts from the moment you add it; an
  edit or a deletion never fires; each message fires at most once.
- **Bots off, or the laptop asleep.** While bots are off, nothing is read. When
  they come back on, or the gateway's machine wakes up, what came meanwhile (the
  last 24 hours at most) arrives as one catch-up per trigger.
- **Only you add or change Slack triggers**: they read your messages, so a bot's
  `triggers` tool can list and remove them but not add or change one.
- **Not yet**: a mention of a user group (`@team`) doesn't count. Slack's search
  honours your search preferences, so a channel you left out of search isn't read.

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
in its Settings tab or from a terminal:

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
  soul and recent memory already say, about a second after you stop.
- **Quick questions go to the bot's helper.** When GPT-Live needs to know
  something, it asks the bot: a helper on the bot's utility model answers from
  the bot's soul (its SOUL.md), the newest part of its memory and the call so far, in
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

### Importing and exporting

**+ → Import bot…** makes a bot from another platform's template (also from the
empty roster). Pick a file or a folder, paste a Grok Bot marketplace link, or
paste text. HUI reads:

- **Grok Bot** marketplace links (`https://x.ai/bot/marketplace/bots/…`): its name,
  instructions, memories, skills, routines and integrations. HUI fetches the page
  once, when you ask; x.ai can change that page, and if HUI can't read it, copy the
  bot's instructions from it and paste them instead.
- **OpenClaw** workspaces, a folder or a zip: SOUL.md, IDENTITY.md's name, emoji
  and vibe, MEMORY.md and USER.md, HEARTBEAT.md (as a routine) and its skills.
  AGENTS.md is left out: it is OpenClaw's operating manual (memory files,
  heartbeats, group chats), not the bot; copy any rule you want into its soul.
- **Claude Code** subagents (`.claude/agents/<name>.md`): its prompt, description,
  model, color, and its tools list, which keeps only those tools on.
- **Letta** agent files (`.af`): its persona and memory blocks and its tools; the
  message history is skipped.
- **Character cards** (V2 or V3, JSON or the PNG): description, personality,
  scenario and system prompt, its first message, and its lorebook.
- **CrewAI** `agents.yaml`: each agent's role (its title), goal and backstory.
- **HUI** exports (below). Any other text becomes the bot's persona.

Before anything exists you see what the bot will get: its name and handle, its
whole SOUL.md, its first message, its skills, its routines and their schedules,
how each integration maps to a HUI tool (or that HUI has none), the tools it
turns off, its model, and a list of what was left out and why. **Imported text
is untrusted**: read it, then **Create bot**. A file with several agents lets
you pick one. An import never turns on more than a new bot has: its routines
start **disabled** (check them in its Routines tab, then turn them on), a tools
list can only turn tools off, and a model it names is kept only when this
gateway has it. What it already knew goes into its SOUL.md, under *What you
already know*, where you can edit it in its Soul tab. Its skills are its own: they
live in its folder, only it loads them, and they are on like every skill (turn
any off in its Tools tab). With a first message, the bot's chat opens with it.

A bot's **⋯ → Export…** downloads it as `<handle>.hui-bot.zip`: `bot.json` (its
profile, routines and what you turned off), `SOUL.md` and its own skills, plus its
memory if you include it (that can be private). Importing the file gives the bot
back, on this HUI or another; its chat stays where it was.

```sh
hui bot import code-reviewer.md                  # prints everything, then asks
hui bot import https://x.ai/bot/marketplace/bots/<slug> --yes
hui bot import ./my-openclaw-workspace --worker devbox
hui bot import agents.yaml --agent researcher
pbpaste | hui bot import -
hui bot export ada --out ada.zip --memory
```

### Archiving and deleting

`hui bot remove ada` archives the bot: its chat transcript and memory are kept,
a running turn stops, messages still queued for it are withdrawn and its
routines are disabled. `hui bot list --archived` (or **Show archived** in the
Bots tab) shows archived bots and `hui bot restore ada` (or their **Restore**)
brings one back; its routines stay disabled until you turn them on again in
Automations or its Routines panel.

`hui bot delete ada` (or **Delete…** in a bot's ⋯ menu in the Bots tab, or an
archived bot's trash icon) deletes a bot for good, active or archived, after
asking (`--yes` skips the question, and is needed where it cannot ask): its turn
stops, its chat leaves HUI, and its routines, its memory and its folder go,
SOUL.md and every file in it included. A folder you chose as its workspace is
never touched. Pi Durable cannot delete a conversation yet, so the chat's raw
log stays in its store, where nothing reads it back. Archiving and restoring
keep everything, SOUL.md included.

### Privacy

Bots live in HUI's own files on this machine: `bots.json` (owner-only) in HUI's
configuration directory, each bot's SOUL.md in its home folder beside it
(owner-only), their chats in the Pi Durable store and their memory beside it.
Nothing about a bot leaves the machine except the model requests its chat and
its memory's compactor make to the providers you configured. A
GPT-Live call sends your voice from the browser straight to OpenAI under your
ChatGPT account, and the gateway sends the call's instructions (the bot's
SOUL.md and the newest part of its memory) when it starts the call; the
helper and the summary use the bot's utility model like any other request. The
ChatGPT credential stays in the gateway. HUI stores no audio: what stays is each
call's card (its summary and transcript) in the bot's chat.

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

A widget is code the agent wrote, so HUI runs it in a sandbox: it cannot reach
HUI or its API, read the conversation, your cookies or storage, change or
navigate the HUI page, open pop-ups or fetch anything from the network. It may
load scripts, styles and fonts from a few public CDNs (cdnjs, jsDelivr, esm.sh,
unpkg, Google and Bunny fonts), which then see your IP address.
[docs/api.md](api.md#agent-widgets) has the full contract.

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
- For a session on a remote worker you answer in the same card; the file is
  written on the worker, where the agent's commands run.

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
