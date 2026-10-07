# Bot triggers browser verification

Journey for triggers (HUI-18 item 10; SPEC.md, "Triggers wake bots on GitHub,
session and webhook events"): the Triggers section of a bot's Routines tab, a
webhook firing into the bot, a fake GitHub's pull requests reaching it through
one conditional poller, the bot adding a trigger with its own tool, bots off and
on again, and a gateway restart, in dark mode at 1440×900 and 390×844.

Run on 2026-10-07 against a gateway built from `feat/bot-triggers` (`npm run
build`, then `node bin/hui.mjs gateway run --host 127.0.0.1 --port <free
port>`, so pages come from the built bundle) and driven with the Browser tool on
an owned headless Brave (disposable profile, CDP 18800). HUI, the gateway's
routes, Pi Durable, OptChat and the CLI are real; the model provider
(`e2e/pi-provider-fixture.mjs`) and GitHub (`e2e/github-triggers-fixture.mjs`,
a fake REST API behind a fake `gh`, with ETags and 304s) are fakes. No operator
configuration, transcript, credential or account is involved.

## Reproduce

1. A temporary root with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, `PI_CODING_AGENT_DIR` and
   `PI_CODING_AGENT_SESSION_DIR` inside it, `PI_OFFLINE=1`; every process
   started with `env -i` and only those variables (no proxy).
2. Start the provider fixture (`HUI_E2E_PROVIDER_PORT=0`) and point
   `<agent>/models.json` at it (provider `hui-e2e`, model `fixture`).
3. `<root>/gh/github.json`: login `dani-op`, repo `acme/widgets` with one open
   pull request, #41. The gateway runs with `HUI_GITHUB_CLI=e2e/github-triggers-fixture.mjs`,
   `HUI_FAKE_GH_DIR=<root>/gh` and `HUI_TRIGGER_POLL_SECONDS=2` (polls every 2
   seconds instead of 60, to keep the run short).
4. Setup through the guarded API (not the journey under test): `PUT
   /__hui/settings` with `labs.bots: true` and `themeMode: "dark"`, `POST
   /__hui/bots` for Juno (heart, lilac, a soul), and `hui bot trigger add juno
   --name Helpers --session --on finished,failed,waiting` from the CLI.
5. The browser opens `http://localhost:<port>/bots/<Juno's id>` at 1440×900, then
   390×844 by resizing the viewport (responsive, not touch emulation).

## Observed

1. **Opened straight at the bot**, the Routines tab shows Triggers under the
   routines with Helpers (Sessions it starts · Finished, Failed, Waiting for an
   answer · never fired · cooldown 5 min). (Before the follow-up fix it stayed
   on *Reading triggers…* when the page loaded at `/bots/<id>`; it now reads once
   the bots stream knows the bot.)
2. **GitHub trigger from the form**: *Add trigger*, name *PR watch*, repo
   `acme/widgets`, the default events (PR opened, Checks failed, Changes
   requested, Mentions you), a prompt. The card read *Waiting for the first read
   of GitHub*, then *GitHub read just now*; the first poll fired nothing.
3. **Webhook trigger from the form**: *Webhook*, filter `status` equals
   `failed`, cooldown None. Its URL showed once with Copy and Done (*Copy it now:
   HUI keeps only a fingerprint of it…*); Copy turned into *Copied*. From a shell,
   `curl` POSTs: `{"status":"ok"}` → 202 `ignored`; `{"title":"Deploy 1842
   failed","status":"failed",…}` → 202 `fired`, and Juno's chat showed
   `[trigger: Deploys · webhook call (title: Deploy 1842 failed)] Tell me which
   service failed…` with the body pretty-printed under the outside-content line,
   then the fixture's reply. The card: *Last fired just now*.
4. **A pull request**: #42 by bob added to the fake GitHub; within a poll Juno's
   chat showed `[trigger: PR watch · #42 opened by bob in acme/widgets: Retry
   flaky upload tests] Review it and tell me what changed.` (its body mentions
   the operator: one delivery, not two). A comment mentioning `@dani-op` and a
   review requesting changes on #42 came inside PR watch's cooldown: the card
   showed *2 events wait, sent together at 02:04 PM* (in warn colour), and at
   that time one message `[trigger: PR watch · 2 events within 5 min]` listed
   both; its run is *Coalesced · 2 events*.
5. **New URL** on Deploys (desktop and mobile) showed a new URL once; the first
   URL then answered 404 *No trigger has this URL.*, and a text body to the new
   one was `ignored` (the filter reads a JSON field). The trigger routes without
   `x-hui` answered 403.
6. **The bot's own tool**: `hui bot send juno "… E2E_CALL:<triggers add Merges>"
   --wait` printed `tool answered: Added the trigger "Merges" (acme/widgets ·
   Merged)…`; the card says *added by Juno*. Merging #41 on the fake GitHub woke
   Juno through it (*Fired*).
7. **A second repo that doesn't exist** (*Release PRs*, `acme/widgets,
   acme/gadgets`, label `release`, base `main`, added from the mobile form): its
   card shows *GitHub has no acme/gadgets, or the gh account can't see it.* in
   red.
8. **Gateway restart** (twice): runs, deliveries of the hour and the provider's
   requests unchanged afterwards: nothing fired again; the pollers resumed with
   304s.
9. **Bots off** (`labs.bots: false`): no GitHub request at all for 8 seconds
   while two pull requests (#43, #44) were opened; the webhook answered 409 *Bots
   are off…* and `GET …/triggers` 409. **On again**: the call while off is a
   *Skipped* run with the reason; the two pull requests became one catch-up held
   for PR watch's cooldown, then one message `[trigger: PR watch · 2 events since
   HUI last looked]` listing both (run *Coalesced · catch-up · 2 events*).
10. **Conditional polling**: of 2,331 requests the pollers made to `acme/widgets`
    over the run (every 2 seconds), 2,313 were answered 304; the rest carried the
    changes above.
11. **390×844**: the panel sheet shows the cards, the URL box, the add form (its
    filter fields in one column) and the runs without horizontal overflow
    (document width 390).
12. Page errors: none. The gateway's UI diagnostics recorded the streams failing
    while the gateway restarted; nothing else.
