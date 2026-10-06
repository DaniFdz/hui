# Bot setup browser verification

Journey for setting bots up like Grok Bot (HUI-18, SPEC.md "Bots are set up
like Grok Bot"): + creates a bot at once, with no form, and its first message
asks what to call it; the bot panel's Settings tab (Profile, Model, Calls,
Workspace) saves each change on its own; **Edit bot…** in either ⋯ menu opens
that tab; Ctrl+Shift+, toggles it; the panel's tab row holds Routines, Memory,
Soul and Settings (and Tools, which comes later).

Run on 2026-10-07 against a gateway built from `feat/bot-setup` at `04aecd0`
(`npm run build`, then `node bin/hui.mjs gateway run --host 127.0.0.1 --port
<port>`, so pages come from the built bundle as in production) and driven
through CDP in headless Chromium. HUI, the gateway's `/__hui/bots` routes and
stream, Pi Durable, OptChat, the soul's first conversation and `set_profile` are
real; only the model provider is a fake (`e2e/pi-provider-fixture.mjs`). No
VoiceStudio, operator transcript, credential or account is involved.

## Reproduce

1. A temporary root with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
   `XDG_DATA_HOME`, `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`
   inside it, `PI_OFFLINE=1`, and the proxy variables unset; every process is
   started with `env -i` and only those variables.
2. Start `e2e/pi-provider-fixture.mjs` (`HUI_E2E_PROVIDER_PORT=0`) and point
   `<agent>/models.json` at it: provider `hui-e2e` with the models `fixture` and
   `fixture-mini`; `<agent>/settings.json` defaults to `hui-e2e/fixture`.
3. Start the built gateway, then set it up through the guarded API (not the
   journey under test): `PUT /__hui/settings` with
   `{"bots":{"showTab":true},"calls":{"engine":"gpt-live","voice":"cove"},"models":{"primary":"","fallback":"","utility":"hui-e2e/fixture-mini"}}`,
   and `POST /__hui/bots` for Scout (blob, blue, `hui-e2e/fixture`, medium,
   language `es`, call voice `ember`), Pixel (heart, coral) and Owl (🦉).
4. Chromium `--headless=new` with a disposable profile. Desktop runs add
   `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`
   (1440×900 and 1280×720); the phone run uses `Emulation.setDeviceMetricsOverride`
   with `mobile: true` and touch emulation at 390×844. Dark theme through
   `Emulation.setEmulatedMedia` (`prefers-color-scheme: dark`).
5. The fixture answers a new bot's kickoff (`[HUI bot created]`) with
   "Hi, I'm new here and I don't have a name yet. What would you like to call
   me?" while the bot's prompt says it has no name yet, and with "Hi, I'm new
   here. What would you like me to look after for you?" otherwise;
   `E2E_SET_PROFILE` makes the bot call `set_profile` with the name Echo and the
   title "Fixture tester".

## Observed

1. **1440×900, Scout's chat, Settings tab**: Profile (Name with @scout, Title,
   Look "Blob · Blue" with Change), Model (*HUI SDK Fixture*, Medium, Utility
   model *Default (HUI Fixture Mini)*, "Applies from its next turn"), Calls
   (Call voice Ember, Language Spanish) and Workspace (Directory). The tab is
   770 px tall and the panel's body 816 px: no scrolling. Opening the Look adds
   Face | Emoji, five named shape chips and six named swatches (974 of 816 px,
   the body scrolls).
2. **+ in the Bots toolbar**: one `POST /__hui/bots` with the body `{}` (201);
   no dialog opens. 123 ms later the chat is `/bots/<new id>`, "New Bot ·
   Idle", on the note *New Bot was created*, then "Hi, I'm new here and I don't
   have a name yet. What would you like to call me?". The roster lists New Bot
   first; the panel stays on Settings, with Name "New Bot" and @new-bot.
3. Answering `E2E_SET_PROFILE call yourself Echo` from the composer: the bot
   calls `set_profile`, and without a reload the header reads "Echo · Fixture
   tester · Idle", the panel's title Echo, Settings' Name Echo with @echo and
   Title "Fixture tester", and the roster row Echo.
4. **Each change saves on its own**: on Pixel, Thinking → Low with 1.5 s of
   added network latency shows *Saving…* on the Thinking row (`aria-busy`
   true) while the picker already reads Low, then clears; one
   `PATCH {"thinking":"low"}` (200). A directory that does not exist, typed and
   saved with Enter, gets `PATCH {"cwd":…}` 400 and the gateway's "No such
   directory: …" under the field; leaving the field and coming back sends
   nothing more, and Escape puts the bot's directory back and drops the error
   without closing the panel. While Pixel runs a held turn (`E2E_REPLAY`) the
   directory field is disabled with "It is working. The directory can change
   once it is idle."; it unlocks when the turn ends.
5. **Edit bot…**: from Scout's chat on Routines, Pixel's row menu (Edit bot…,
   Hide, Archive…, Delete…) → **Edit bot…** opens Pixel's chat on Settings with
   the focus on the Settings tab (stored tab `settings`). From the Soul tab, the
   chat header's ⋯ (Edit bot…, Archive…, Delete…) → **Edit bot…** lands on
   Settings with the same focus.
6. **Tab row**: Routines 90, Memory 88, Soul 65 and Settings 88 px in 343 px;
   with a Tools tab and a routine count of 12 added in the page, 97, 68, 46,
   51 and 69 px, still 343 of 343 (no overflow, nothing clipped). Arrow keys,
   Home and End move through all four tabs and wrap.
7. **Ctrl+Shift+,** on a bot's chat (Memory tab showing): Settings; again:
   the panel closes; again: Settings.
8. **1280×720**: the panel stays 344 px and the chat 678 px; the Settings tab
   scrolls (794 of 636 px).
9. **390×844**: the drawer's Bots list with its +; + creates New Bot (body
   `{}`), closes the drawer and shows the note and the name question; the panel
   toggle opens the sheet (380 px, tab row 379 of 379 px) on Settings with Name
   "New Bot" (779 of 752 px, scrolls a little); Escape closes the sheet.
10. Console and page errors: none, apart from the expected 400 of the refused
    directory.

## Limits and gaps

- The model provider is a fixture: a real model's opener, and how it words the
  name question, were not part of this run.
- No VoiceStudio: the Settings tab has no VoiceStudio rows, by design. Calls
  were not placed; only their Settings rows were checked.
- Light theme and reduced motion were not captured for this change.
- Remote workers are not covered: the workers pull request adds its + menu and
  machine field later.
