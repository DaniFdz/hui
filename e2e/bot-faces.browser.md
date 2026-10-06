# Bot faces browser verification

Journey for the bots' animated faces (part 5 of the bots stack, after OpenAI's
Dots): the roster's faces and states, a bot chat's header and empty-chat face,
the dialog's Look, the call view and its minimized bar, light and dark themes,
390×844, reduced motion, accessibility and cost. Run against
`e2e/visual-verification.mjs launch --branch feat/bot-faces --voice-fixture
--pi-sessions` in headless Chromium driven through CDP (the Browser tool's
headless Brave hangs on screenshots on this host). HUI, the gateway's
`/__hui/bots` routes and stream, Pi Durable, OptChat and the browser's audio
stack are real; the model provider (`e2e/pi-provider-fixture.mjs`) and
VoiceStudio (`e2e/voicestudio-fixture.mjs`) are deterministic fakes. No
operator transcript, credential or account is used.

## Reproduce

1. From the checkout, with `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` (any case) and
   `NODE_USE_ENV_PROXY` unset: `node e2e/visual-verification.mjs launch --branch
   feat/bot-faces --voice-fixture --pi-sessions`, then `doctor` on the receipt
   before and after the browser work, and `cleanup` at the end.
2. Setup through HUI's guarded API (not the journey under test): `PUT
   /__hui/settings {"bots":{"showTab":true}}`, then `POST /__hui/bots` for ten
   bots: Scout (blob, blue), Coach (heart, magenta), Atlas (round, mint), Pixel
   (cookie, coral), Tri (triangle, yellow), Juno (heart, lilac), Moss (cookie,
   mint), Owl (🦉), and Ledger and Nova with no look (their ids pick it); an
   eleventh, Old, archived. States come from messages
   (`POST /__hui/bots/:id/messages`): `E2E_REPLAY` holds a streaming reply
   (thinking), `E2E_COMMAND_RUNNING` holds a tool (working in the chat), a
   667-character message ending in `E2E_HOLD_MEMORY` and then a short one hold
   a memory summary (memory), `E2E_ERROR` fails a turn (error in the chat), and
   `/hui-e2e-question confirm` asks a question (waiting).
   `POST <providerUrl>/control/release-replay` releases every hold.
3. Calls: `PUT /__hui/voice {"url": <voiceUrl>}` connects the fake VoiceStudio;
   `POST <voiceUrl>/control/speech {"voiced": true}` makes it answer with
   speech-like syllables (WAV) so the speaking face has a voice to follow;
   `node e2e/fake-speech-wav.mjs <dir>/speech.wav` feeds Chromium's fake
   microphone (`--use-fake-device-for-media-stream
   --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>`).
4. Desktop runs use `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`
   at 1440×900; phones a separate browser at 390×844 with touch emulation.
   Themes through `Emulation.setEmulatedMedia` (`prefers-color-scheme`), and
   reduced motion through `prefers-reduced-motion: reduce`.

## Observed (2026-10-06, `805aab5`, clean checkout; doctor passed before and after)

1. Roster (light and dark): each bot shows its face with its activity badge and
   preview. Scout blob *thinking* ("Replay prefix —"), Moss cookie *thinking*
   (a held tool; the roster only knows the chat runs), Atlas round *memory*
   (sleepy eyes, thought dots, "Summarizing memory…"), Coach heart *waiting*
   (tilted, the hand badge, "Waiting for your answer"), the others *idle*,
   Owl's 🦉 on a tile of its id's color. Ledger and Nova show the faces their ids
   pick, the same after reloads and in every place they appear.
2. An empty chat (Tri, Nova, Juno): the 112 px face above *Say hi to …*; the
   header's 36 px face beside the name and "role · Idle". Moving the pointer
   250 px right of it turned the eyes from `translate(0px, 0px)` to
   `translate(5.9px, -1.68px)` and leaned the body `rotate(2.72deg)`.
3. Pixel's failed turn: its chat header's face reads *error* (muted body,
   brows) while the run-error notice shows; the roster row is idle.
4. A message typed in Tri's composer (later Ledger's) with
   `E2E_COMMAND_RUNNING`: the header face goes *working* (bobbing) while the
   tool runs and the roster row *thinking*; releasing it plays *done* (happy
   eyes, a hop) and then *idle*.
5. Row menu → **Edit bot…** on Ledger: the Look opens on **Face** with the
   shape and color its id picked checked. From the keyboard, the checked shape
   radio and ArrowRight twice, then Tab and ArrowRight: the preview turned to
   Heart in Mint (light run; Blob in Coral in the dark run) with a visible ring
   on the focused swatch; **Save** stored them (`GET` shows `avatar: { color,
   shape }`) and the row updated. Owl's dialog opened on **Emoji**; **Face** →
   Save cleared its emoji (`avatar` absent) and the row showed its id's face.
6. Call (Tri light, Owl dark, Nova on the phone): the call view takes the bot's
   color and shows the 176 px face (148 px on a phone). *Listening*: wide eyes,
   the body puffing with the microphone's level (`scale(1.05, 1.07)` while the
   fake voice spoke, `scale(1.03, 1.03)` in silence). *Thinking* while the
   reply is written, then *Speaking*: the body stretching with the voice's
   envelope, frame by frame from `scale(1, 1)` in the gaps between syllables to
   `scale(0.95, 1.09)` on them, in step with the player's `currentTime`.
   Minimized, the bar shows the small face beside the live dot, name and status.
7. 390×844: the drawer's roster, an empty chat with its face, and the Look in
   the dialog fit the width (`scrollWidth` 390; the card 366 px); swatches are
   28 px and chips 32 px tall.
8. Reduced motion: no face animation runs (`getAnimations()` 0 of 12 faces,
   `animation-name: none`), no blink or glance in 8 s, and the pointer moves
   neither eyes nor body; each state keeps its still expression.
9. Accessibility: every `hui-bot-face` is `aria-hidden` and none of its 22–24
   nodes is in the accessibility tree; names and statuses stay in text.
10. Cost: with 11–12 faces on screen (57–65 running keyframe animations), a
    `longtask` observer saw no long task in 10 s.
11. Browser page errors: none. Console errors: none (Lit's development-mode
    warnings, as on the base branch).

## Limits and gaps

- VoiceStudio and the microphone are fakes: the speaking face followed the
  fixture's synthetic syllables (opt-in `voiced`; its default clips are silent
  MP3, which keep a speaking face still because it follows the real level); no
  real voice or recognizer was involved.
- A roster row knows only the bot's status: a running tool reads *thinking*
  there and *working* only in the open chat; a failed turn reads *error* only
  in the chat (the roster shows *error* when the session itself fails).
- The *offline* face for an unreachable bot is unit-tested; the archived list
  shows it, but no disconnect was forced.
- Headless Chromium; screenshots cannot show motion, so motion is asserted
  through transforms and animation state, plus a screencast kept with the PR.
