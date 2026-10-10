# Bots behind Labs browser verification

Journey for bots as a preview behind one opt-in switch (HUI-18 item 9; SPEC.md,
"Bots stay behind an opt-in Labs setting while they are a preview"): Settings →
Labs → **Bots**, off by default. Off, bots are dormant everywhere and nothing
is deleted; on, everything is back as it was, without a restart.

Run on 2026-10-07 against a gateway built from `feat/bots-opt-in` at
`bcd1384` (`npm run build`, then `node bin/hui.mjs gateway run --host
127.0.0.1 --port <free port>`, so pages come from the built bundle as in
production) and driven with the Browser tool on an owned headless Brave
(disposable profile, CDP 18800). HUI, the gateway's routes and streams, Pi
Durable, OptChat, Automation and the CLI are real; only the model provider is a
fake (`e2e/pi-provider-fixture.mjs`). No operator configuration, transcript,
credential or account is involved.

## Reproduce

1. A temporary root with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, `PI_CODING_AGENT_DIR` and
   `PI_CODING_AGENT_SESSION_DIR` inside it, `PI_OFFLINE=1`; every process is
   started with `env -i` and only those variables (no proxy).
2. Start `e2e/pi-provider-fixture.mjs` (`HUI_E2E_PROVIDER_PORT=0`) and point
   `<agent>/models.json` at it (provider `hui-e2e`, model `fixture`).
3. Start the built gateway and set it up through the guarded API (not the
   journey under test): `PUT /__hui/settings` with `{"labs":{"bots":true},
   "themeMode":"dark"}`; `POST /__hui/bots` for Juno (heart, lilac, a soul) and
   Pixel (cookie, coral, a soul), a waited message to each, an hourly routine
   *Morning digest* on Juno's chat, and an ordinary session *Release notes*
   with a first prompt. Then `labs.bots: false`: a gateway with existing bots
   and the setting off. Its `POST /__hui/automation/tasks/:id/run` for the
   routine ends *Skipped*.
4. The browser opens `http://localhost:<port>/` (the Browser tool refuses
   `127.0.0.1` by policy) at 1440×900, then 390×844 by resizing the viewport
   (responsive, not touch emulation). The remembered sidebar tab
   (`hui.sidebar-tab`) is *bots* from an earlier visit.
5. For the migration, the gateway stopped, `settings.json` rewritten as a
   build from before Labs → Bots left it (`labs` without `bots`,
   `"bots":{"showTab":true}`), the gateway started again.

## Observed

1. **Migration.** With only `bots.showTab: true`, `GET /__hui/settings`
   answered `labs.bots: true` and no `bots` key, `GET /__hui/bots` 200; after
   the next `PUT` the file held only `labs.bots`.
2. **Off, desktop.** The sidebar is the one from before bots: no Agents | Bots
   switch although the remembered tab is *bots*, the session list and Recent
   chats show only *Release notes*. `/bots/<id>`, `/bots` and
   `/sessions/<Juno's chat>` all land on `/`. Settings → Sessions has
   Registry, Runtimes and Retention, no Bots section; Settings → Models has no
   Calls section and its intro names two roles. Automations lists no task and
   no run, and its next wake is *—*.
3. **Off, gateway and CLI.** `GET /__hui/bots`, `GET /__hui/bots/<id>`,
   `GET /__hui/calls`, `GET /__hui/bots/events`, and `POST` `open` and
   `prompt` on Juno's chat answered 409 *Bots are off on this gateway: they are
   a preview. Turn them on in Settings → Labs → Bots.* `hui bot list`, `show`,
   `send --wait`, `routine run` and `chat` printed `hui: ` and that message
   and exited 1. `hui --help` starts its bots paragraph with *Bots are a
   preview: off until Settings → Labs → Bots turns them on…*.
4. **Labs.** The subtitle reads *Experimental and opt-in features.*; the Bots
   switch, first, is off with its hint. Clicking it turned it on, saved
   `labs.bots: true` and, at once, put the Agents | Bots switch back with the
   remembered Bots tab selected and the roster loaded (Pixel with its unread
   dot, Juno).
5. **On, nothing lost.** Juno opened at `/bots/<id>` with its message and
   reply, its routine still enabled with its next time, and Latest runs
   showing the skipped run: *Skipped because bots are off: turn them on in
   Settings → Labs → Bots. The routine is kept and runs at its next time once
   they are on.* Automations lists *Morning digest · Bot · Juno*, last run
   *Skipped*, with the same reason in the run history. Settings → Sessions has
   its Bots section again, with the command line and no switch.
6. **390×844.** In Labs, turning Bots off removed the switch at once; the
   drawer showed the sidebar from before bots; `/bots/<id>` landed on `/`.
   Turning it on again: the drawer opened on the Agents | Bots switch with the
   Bots tab and the roster, and Juno's chat opened from it. The document never
   got wider than the viewport.
7. Page errors: none. The gateway's UI diagnostics recorded the session stream
   failing while the gateway was stopped for the migration, and `GET
   /__hui/themes` timing out a few times right after full-page navigations in
   headless Brave (the route answers in about 1 ms from `curl`); neither
   involves bots.
