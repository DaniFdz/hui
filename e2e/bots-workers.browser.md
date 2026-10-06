# Bots on a worker browser verification

Journey for bots on remote workers (part 7 of the bots stack): the New bot
dialog's **Runs on**, a bot on a worker answering in its chat, the machine in
its header and roster row, its Memory panel read from the worker, the Edit
dialog's read-only machine, and an offline worker, in dark mode at 1440×900
(fine pointer) and 390×844 (touch), plus a light-mode close-up. Run against a
gateway built from the branch (`node bin/hui.mjs gateway run`) in a temporary
HOME and XDG directories, with a local worker: its connect command is `env
HOME=<temp>/remote SHELL=/bin/sh`, so the "remote" is a separate home on the
same machine, with the built worker release pre-installed (no network). HUI,
the worker host, Pi Durable and OptChat are real; the model provider
(`e2e/pi-provider-fixture.mjs`) is the deterministic fake. Driven through CDP in
headless Chromium. No operator transcript, credential or account is used.

## Reproduce

1. `npm run build`. In a temporary root: a PI agent directory under its
   `home/.pi/agent` (models.json with the fixture provider and two models,
   `fixture` and `utility`; an auth.json key the fixture requires), HUI settings
   `{"bots":{"showTab":true},"models":{"utility":"fx/utility"}}`, and the worker
   release written into `<root>/remote/.local/share/hui-worker/releases/<id>/`
   from `build/server/worker/release.js`'s `workerRelease()`, with `node_modules`
   linked and `.ready` written.
2. `env -i PATH=… HOME=<root>/home XDG_CONFIG_HOME=<root>/config
   XDG_STATE_HOME=<root>/state XDG_DATA_HOME=<root>/data node bin/hui.mjs gateway
   run --host 127.0.0.1 --port <port>`, with `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`
   (any case) and `NODE_USE_ENV_PROXY` unset.
3. Setup through HUI's guarded API (not the journey under test): `POST
   /__hui/workers {"name":"devbox","command":"env -u XDG_CONFIG_HOME -u
   XDG_STATE_HOME -u XDG_DATA_HOME HOME=<root>/remote SHELL=/bin/sh"}` and its
   `connect`; a local bot, Ledger, with one exchange.
4. Desktop: Chromium at 1440×900 with
   `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`;
   phone: a separate Chromium at 390×844 with touch emulation. Both with
   `Emulation.setEmulatedMedia` `prefers-color-scheme: dark` (light for the one
   close-up).

## Observed (2026-10-06, `15273b2`; no console errors)

1. Bots tab → **+**: the dialog reads Name, Look, **Runs on**, Title… Runs on
   offers *Local · This machine* and *devbox · Remote worker*, each with its
   icon (a terminal, a globe). Choosing devbox changes its hint (its chat,
   memory and folder live on that worker; terminals, the browser and watchers
   stay on this machine; it can't move later) and the workspace hint ("A folder
   on devbox: absolute or ~/…. Leave empty for a private folder HUI creates
   there.").
2. **Create bot** opens Rover's chat. A typed message gets "Fixture response."
   from the chat running on the worker. The header reads "Field explorer · 🌐
   devbox · Idle"; Rover's roster row shows a 🌐 devbox tag before its preview;
   Ledger, local, has none.
3. Memory tab: 2 messages, 2 lines, the view's lines from the worker's memory,
   and "Summarizer since HUI started on devbox".
4. Edit bot…: Runs on shows 🌐 devbox, read-only, with "A bot stays on the
   machine it was created on", right after Look; the workspace is the folder on
   devbox.
5. Phone: the drawer's roster shows the devbox tag; the dialog's Runs on, its
   options and hints fit 390 px; the chat header and the Memory sheet as on
   desktop.
6. `POST /__hui/workers/:id/disconnect`: the chat shows "Disconnected from
   devbox" (header, banner with Reconnect, composer), the face goes offline,
   and Refresh in the Memory panel says "devbox, where this bot runs, is
   offline: HUI is not connected to it. Connect it in Settings → Workers, then
   try again." Through the API: the memory route and a message answer 503 with
   those reasons, a create on devbox answers 503 ("HUI is not connected to
   devbox. …"), and `GET /__hui/bots` answers in under 2 ms with Rover
   *disconnected*, no memory and its newest message. Reconnect brings it back
   (memory 200).
7. Light mode: the header and roster close-up keep the tag and the globe
   legible on the light tokens.

## Not covered here

A GPT-Live call with a bot on a worker (the call path itself runs in the
gateway, and the helper's memory view and the call's record go through the
worker's ports, which `server/bot-workers.test.ts` exercises); a real SSH
worker on another machine (the container E2E of workers covers the real
install path).
