# Bots' voice browser verification

Journey for HUI-18's voice (VoiceStudio): Settings → Integrations →
VoiceStudio, a bot's voice in its dialog, Read aloud, a voice note and a call.
Driven with the Browser tool (OpenClaw's managed profile attached to an owned
headless Brave on CDP port 18800) against `e2e/visual-verification.mjs launch …
--voice-fixture`: HUI, the gateway's `/__hui/voice` and `/__hui/bots` routes, Pi
Durable and the browser's audio stack are real; the model provider
(`e2e/pi-provider-fixture.mjs`, "Fixture response.") and VoiceStudio
(`e2e/voicestudio-fixture.mjs`: scripted transcripts, silent MP3 speech) are
deterministic fakes. No real VoiceStudio, microphone, operator transcript or
account is involved.

## Reproduce

1. From the checkout, with `HTTP_PROXY`/`HTTPS_PROXY`/`NODE_USE_ENV_PROXY` unset:
   `node e2e/visual-verification.mjs launch --branch <branch> --voice-fixture`,
   then `doctor` on the receipt before and after the Browser work. The receipt's
   `voiceUrl` is the fake VoiceStudio, left unconnected.
2. `node e2e/fake-speech-wav.mjs <dir>/speech.wav` writes the fake microphone's
   input: one 1.45 s speech-like utterance every 29.5 s.
3. With CDP port 18800 free (Browser `status` says `attachOnly`), start an owned
   headless Brave on a disposable profile:
   `brave --headless=new --remote-debugging-address=127.0.0.1
   --remote-debugging-port=18800 --user-data-dir=<tmp> --window-size=1440,900
   --no-first-run --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
   --use-file-for-fake-audio-capture=<dir>/speech.wav about:blank`. The fake UI
   flag answers the microphone prompt; HUI still asks for the microphone only
   after a click on the microphone or Call. Then open the receipt's
   `browserUrl` in a labeled tab at 1440×900.
4. `POST <voiceUrl>/control/transcripts {"texts": [...]}` queues what the next
   recordings "said"; `GET <voiceUrl>/control/requests` lists what HUI asked
   VoiceStudio for (fields, never audio).
5. In code-mode Browser cells the snapshot text is not returned: act with
   Playwright role selectors (`role=button[name='Call Vox']`), read state with a
   bounded `evaluate`, and inspect screenshots with the image viewer.

## Journey and expected results

1. Settings → Sessions → *Show the Bots tab* on.
2. Settings → Integrations → VoiceStudio: the chip reads *Not connected* and the
   form explains the setup. The receipt's `voiceUrl` → **Test & save**: "Connected
   to VoiceStudio 0.0.0-hui-fixture.", the chip *Connected*, the address with
   "Reachable · VoiceStudio 0.0.0-hui-fixture", Check again, Change, Disconnect
   and *Send voice notes immediately* (off). The fixture saw discovery, then
   `/v1/models`.
3. Bots → **New bot**: the dialog has a **Voice** section (picker, Preview,
   Speed 1×). The picker lists *VoiceStudio default*, the fixture's voice
   profiles (Aria, Bruno, Dani) and then OpenAI's names, with a search field.
   Aria, then the speed slider to 1.3× (keyboard arrows step 0.05). **Preview**
   turns into *Stop* (`aria-pressed=true`) while the shared player
   `#hui-voice-player` reports `data-state=playing`, then back to Preview with
   `data-clips` up by the two sentences spoken; the fixture saw two
   `/v1/audio/speech` requests with `voice: vp-aria`, `speed: 1.3`,
   `response_format: mp3`, `stream_format: audio`.
4. Name Vox, emoji 🎧 → **Create bot** opens `/bots/<id>`; `GET
   /__hui/bots` shows `voice: { profile: "vp-aria", speed: 1.3 }`. The header has
   **Call Vox**; the composer has **Record a voice note** beside Send.
5. A typed message is answered "Fixture response."; the reply's footer offers
   **Read aloud**: pressed, it reads *Stop reading aloud* (`data-status=playing`)
   while the player plays, then returns to Read aloud with one more clip played.
6. Voice note: with a transcript queued, the microphone → "Recording a voice
   note" with a running time, Cancel and Done (the button turns into a red
   stop) → **Done** → the queued text in the composer, focused, not sent. The
   fixture received `recording.webm` (`audio/webm`) with `model: whisper-1`.
7. Call: with a transcript queued, **Call Vox** → the call view (timer, avatar,
   *Listening*, both captions, Mute, Speaker, Hang up, the privacy line). The
   fake microphone's utterance moves it through *Hearing you…* to the queued
   words in *You*, "[voice] <words>" in the chat, the bot's "Fixture response."
   caption and *Speaking* while the player plays it, then *Listening* again.
8. **Mute** → *Muted* (`aria-pressed=true`) and *Microphone muted*; **Speaker**
   → *Speaker off* and back.
9. **Minimize the call** → the bar above the chat ("Vox · <status> · time",
   mute, hang up) with focus on it; the header's Call button reads *Return to
   the call with Vox*, in green. Another page (Automations) → the same bar floats
   at the top. The bar → back to `/bots/<id>` and the call view, focus on Hang
   up.
10. **Hang up** → the chat, focus on Call Vox, every `[voice] ` message and its
    reply in the transcript.
11. Edit Vox (row menu → Edit bot…): the dialog shows Aria and 1.3×; a new speed
    → Save → `GET /__hui/bots/vox` keeps `vp-aria` with the new speed.
12. 390×844: the header keeps Call, the composer the microphone; the call view
    and the minimized bar fit the width; the dialog's voice section fits and the
    card stays behind every field when it scrolls. The document never gets wider
    than the viewport. Browser page errors and console errors: none expected.

## Observed during development (2026-10-05)

On `feat/bots-voice` at `d5c51ce` with the dialog wiring uncommitted (the
commit after it), stacked on `feat/bots-ui` `ad3abf8`: steps 1–12 behaved as
described, the call's whole loop included (listening → hearing → transcribed →
"[voice] Can you hear me on this call?" → "Fixture response." spoken →
listening, about four seconds after the call opened; the fake microphone's next
loop arrived as a second `[voice]` turn before the microphone was muted). Two
defects found there are fixed by the following commits: the header's Call button
stayed grey during a call (theme specificity), and on a phone the dialog's last
fields scrolled past its card's background. No page or console errors. The PR's
evidence run is recorded with the PR, outside the repository.

## Limits and gaps

- VoiceStudio is a deterministic fake; a live VoiceStudio (its recognizer,
  voices and latency) is not verified.
- The microphone is Chromium's fake device playing a synthetic WAV through the
  browser's real capture path (getUserMedia with echo cancellation, the
  AudioWorklet and MediaRecorder); no real voice or microphone permission prompt.
- Headless Brave plays through its own audio stack; the screenshots cannot show
  sound, so playback is asserted through the player's `data-state`/`data-clips`
  and the fixture's request log.
- HUI's desktop app denies the microphone (renderer permission policy); only the
  browser was exercised.
