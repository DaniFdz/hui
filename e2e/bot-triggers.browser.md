# Bot triggers browser verification

Journey for triggers (HUI-18 item 13; SPEC.md, "Listeners are the only
triggers"): the Triggers section of a bot's Routines tab, with a listener played
by `curl` reporting to a trigger's URL, at 1440×900 and 390×844, and
`hui doctor` on the state older versions' trigger kinds leave.

Run on 2026-10-13 against `dani.fernandez/listener-triggers` through
[hui-visual-verification](../.agents/skills/hui-visual-verification/SKILL.md):
an isolated instance of the committed checkout, its fixture provider, and its
fake `gh` (`--github-fixture`), which answers for synthetic accounts but can't
read a pull request, so a linked one shows as *gh could not read it*. Reading
linked pull requests into a delivery is proved by
`server/bot-trigger-routes.test.ts` against `e2e/github-triggers-fixture.mjs`.
No operator configuration, transcript, credential or account is involved.

## Reproduce

1. `node e2e/visual-verification.mjs launch --branch <branch> --github-fixture`,
   then `doctor` with its receipt. The Browser tool opens the instance at
   1440×900.
2. Settings → Labs: turn **Bots** on. **New bot** makes one with the fixture
   model.
3. The bot's panel → **Routines**: the Triggers section and its add form.
4. A shell plays the listener: `curl -sS -X POST "$URL" -H 'content-type:
   application/json' -d '<report>'` with the URL the form showed.
5. `hui doctor` runs against a temporary `HOME` and `XDG_CONFIG_HOME` holding a
   `bot-triggers.json` with a GitHub and a Slack trigger beside a listener's,
   and the `bot-trigger-cursors.json`, `bot-trigger-slack.json` and `slack.json`
   older versions wrote (`npm run build` first; `node bin/hui.mjs doctor`, then
   `doctor --fix`; no gateway runs on that state).

## Observed

1. **No triggers yet**: the section says a trigger wakes the bot when a listener
   you run reports something, and the add form is open. It has no choice of
   source: Name, what a listener does, *Only events where (optional)* (field,
   equals or contains, value), *Only events that link a GitHub pull request*,
   *Also events it marks as from outside your organization*, *Also events it
   marks as from bots and apps*, Prompt and Cooldown.
2. **Add trigger** *Reviews* (`fields.channel` equals `G01M4T1JFLK`, PR links
   only, cooldown None, a prompt): its URL shows once, *Reviews: its URL*, with
   what to send it, Copy and Done. Its card: the filter (`fields.channel equals
   "G01M4T1JFLK" · PR links only`), *Never fired · cooldown none*, *No report
   from the listener since the gateway started.* as a problem, the URL's first
   characters, Test, New URL and Delete.
3. **A check-in** (`{"events":[]}`) answers 202 `ignored`; the card says
   *Listener reported just now* and the problem is gone. Nothing reaches the
   bot.
4. **A report** with a matching review ping linking a pull request, the same
   ping from another channel and one marked `"bot": true` answers 202 `fired`.
   The bot's chat shows one `[trigger: Reviews · …] <prompt>` message with the
   ping's details and a line for the linked pull request (*gh could not read
   it*, from this fake), then the fixture's reply. The card says *Last fired just now*; the run is *Fired*.
5. **The same report again** answers 202 `ignored`; the chat still has one
   delivery. A report without an `id` answers 400 with what to fix. A report
   with `"error"` shows that problem on the card.
6. **Test** delivers *[trigger: Reviews · test: a sample event]* and says *Sent
   a test event to <bot>'s chat.*
7. **New URL** shows a new URL once; the old one answers 404.
8. **Settings → Integrations** lists Jira and GitHub; Slack is gone.
9. **390×844**: the panel sheet shows the card, the URL box and the form
   without horizontal overflow.
10. **`hui doctor`** reports the GitHub and Slack triggers and the three files
    as left by the kinds HUI no longer has, with what `--fix` does and that
    deleting `slack.json` doesn't revoke its token, and exits 1. **`--fix`**
    deletes them and their runs; the listener trigger stays, and `hui doctor`
    then reports nothing left and exits 0.
11. Page errors: none.

## A listener that goes quiet (2026-10-19)

Run against `dani.fernandez/listener-silence-alert` the same way, with bots
turned on through `PUT /__hui/settings` as setup and the bot and its trigger
made through the panel.

1. **The form and the URL box** say a listener reports at least every five
   minutes and that, after five quiet minutes, HUI tells the bot its listener
   went quiet.
2. **One check-in** (`{"events":[]}`) answers 202 `ignored`; the card says
   *Listener reported just now*.
3. **Five minutes later**, with no other report, the bot's chat shows one
   message from *PR changes · its listener went quiet*: "From HUI, not the
   listener: nothing has reported to this trigger for 5 min (the last report
   came at …)", then the fixture's reply. The card says *No report from the
   listener for 6 min.*; Activity shows *Fired · its listener went quiet*.
   The trigger's routes report that run, `lastFiredAt` unset and no delivery
   counted against the hour's cap.
4. **Ten minutes after the check-in** the chat still holds one notice.
5. **390×844**: the notice wraps inside the chat without overflow. Page errors:
   none (Lit's development-mode warnings only).

Waking only once per silence, the next silence, sleep, refused reports and
failed checks are proved by `server/bot-triggers.test.ts`.
