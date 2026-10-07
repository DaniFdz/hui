# Bot templates browser verification

Journey for importing bots from other platforms' templates and exporting them
(HUI-18; SPEC.md, "Bots import other platforms' templates and export their
own"): + → **Import bot…** → preview → **Create bot**, a bot's ⋯ → **Export…**,
and `hui bot import`/`export` against the same gateway.

Run on 2026-10-07 against a gateway built from `feat/bot-templates` at `3bf4612`
(`npm run build`, then `node bin/hui.mjs gateway run --host 127.0.0.1 --port
<free port>`, so pages come from the built bundle) and driven with the Browser
tool on its managed headless profile. HUI, the gateway's routes, Pi Durable,
OptChat, Automation and the CLI are real; the model provider is the fixture
(`e2e/pi-provider-fixture.mjs`, which answers an imported bot's kickoff with its
opener). Every template is a synthetic sample written for this run, except one
live Grok Bot marketplace link fetched by the gateway to prove the best-effort
reader against x.ai's current page (nothing of it is kept).

## Reproduce

1. A temporary root with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, `PI_CODING_AGENT_DIR` and
   `PI_CODING_AGENT_SESSION_DIR` inside it, `PI_OFFLINE=1`; the provider and the
   gateway are started with `env -i` and only those variables (no proxy).
2. `<agent>/models.json` points provider `hui-e2e` (models `fixture` and
   `claude-sonnet-4-5`) at the fixture; `PUT /__hui/settings` with
   `{"labs":{"bots":true},"themeMode":"dark"}`.
3. Samples: a Next.js page carrying a Grok Bot payload (pasted and as a file), an
   OpenClaw workspace folder and the same folder zipped by Python's `zipfile`, a
   Claude Code subagent, a Letta agent file, a V2 character card (JSON) and a V3
   card inside a PNG's `ccv3` chunk, a CrewAI `agents.yaml` with two agents, and
   plain text.
4. `hui bot import <sample> --yes` for each (stdin for the pasted page), then
   `hui bot export nova --memory` and `hui bot import nova.hui-bot.zip --yes`.
5. The browser opens `http://localhost:<port>/` at 1440×900, then 390×844 by
   resizing the viewport (responsive, not touch emulation), dark theme.

## Observed

1. **CLI, every format.** Each import printed the whole preview (SOUL.md, first
   message, skills with their instructions, routines with the schedule HUI read,
   integrations mapped or missing, tools turned off, what was left out and
   notes), then *Imported @handle…*. The live link
   `https://x.ai/bot/marketplace/bots/account-research` became a bot with 4 own
   skills and a disabled routine: its instructions are empty and its job is in six
   memories, so its description stands in as the persona and SOUL.md holds them
   (8,466 characters). The OpenClaw zip from Python unpacked like the folder
   (@nova-2). The CrewAI file without `--agent` exited 1 listing both agents;
   `--agent researcher` imported one. The card PNG's bot (@bolt) sent its first
   message.
2. **What was created.** Through the API: Code Reviewer kept only `read` on (19
   tools off) and its `sonnet` hint resolved to `hui-e2e/claude-sonnet-4-5`;
   Companion's Letta model hint resolved to `hui-e2e/fixture`; Nova's
   `weather` skill is its own (*Its own skills*, on) and its heartbeat routine is
   off, every 30 minutes; Trip Planner's routine is off, Mondays at 09:00.
3. **Export and back.** The zip held `bot.json`, `SOUL.md`, `skills/weather/SKILL.md`
   and `memory.md` (Python's `testzip` clean); importing it made @nova-3 with the
   same soul (one *What you already know* section), skill and disabled routine,
   and noted that @nova was taken.
4. **Labs off.** With `labs.bots: false`, `hui bot import` and `hui bot export`
   printed *Bots are off on this gateway…* and exited 1; `POST
   /__hui/bots/import/preview` answered 409.
5. **Browser, desktop.** + opens *New bot* and *Import bot…*. The dialog's File
   or folder | Link | Paste tabs, a file chosen (the Weekend Chef page), Preview:
   the heart face in its yellow, @weekend-chef, *From Grok Bot by Sample Author*,
   the untrusted note, the facts row, SOUL.md with *What you already know*, the
   first message, the `shopping-list` skill, *Friday menu · Fridays at 18:00 ·
   "every friday at 6pm"*, *Web search → Browser* and *Google Keep · missing*,
   and the note that the routine starts disabled. Create bot opened its chat: the
   *Weekend Chef was created* note, then the opener as its first message; its
   Routines tab shows *Friday menu* paused and its Tools tab lists
   `shopping-list` under Skills as *Its own skills*, on. Its ⋯ has *Export…*; the
   dialog with *Include its memory* downloaded `weekend-chef.hui-bot.zip`.
6. **Browser, mobile.** The same + menu from the drawer, the dialog at the
   screen's width, the downloaded export imported back (@weekend-chef-2, one
   memory) and the first bot's chat with its opener. No page errors.

## Limits

- Folder picking (`webkitdirectory`) was exercised through the CLI and the route
  tests, not the browser: the Browser tool sets one file on an input.
- Bots on a worker: their own skills go through the worker host's
  `bot.skills.*` requests, proved by `server/worker/host.test.ts` and
  `server/bot-remote.test.ts`; no worker was connected in this run.
- The Grok Bot reader depends on x.ai's page; the live link proves it on
  2026-10-07 only.
