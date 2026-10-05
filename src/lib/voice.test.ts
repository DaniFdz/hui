import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { formatCallTime, microphoneErrorMessage, sendBotMessage, speedLabel, synthesizeSpeech, transcribeRecording, voiceConnectionSummary, voiceOptions } from "./voice.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Records requests and answers them with `reply`. */
function stubFetch(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return reply(String(input), init ?? {});
  }) as typeof fetch;
  return calls;
}

test("call times read like a phone's", () => {
  assert.equal(formatCallTime(0), "0:00");
  assert.equal(formatCallTime(-5), "0:00");
  assert.equal(formatCallTime(65_400), "1:05");
  assert.equal(formatCallTime(3_725_000), "1:02:05");
  assert.equal(speedLabel(1), "1×");
  assert.equal(speedLabel(1.25), "1.25×");
  assert.equal(speedLabel(0.5), "0.5×");
});

test("the voice picker lists VoiceStudio's default, then cloned voices, then aliases", () => {
  const voices = [
    { id: "alloy", name: "Alloy", type: "openai_alias" },
    { id: "vp-dani", name: "Dani (own voice)", type: "profile", language: "es" },
    { id: "preset-1", name: "Narrator", type: "kittentts" },
  ];
  assert.deepEqual(voiceOptions(voices, ""), [
    { value: "", label: "VoiceStudio default" },
    { value: "vp-dani", label: "Dani (own voice)", description: "Voice profile · es" },
    { value: "alloy", label: "Alloy", description: "OpenAI alias" },
    { value: "preset-1", label: "Narrator", description: "kittentts" },
  ]);
  assert.deepEqual(voiceOptions([], "vp-gone").at(-1), { value: "vp-gone", label: "vp-gone", description: "Not listed by VoiceStudio now" }, "a saved voice still shows");
});

test("microphone failures say what to do", () => {
  const secure = { secure: true, desktop: false };
  assert.match(microphoneErrorMessage(new DOMException("denied", "NotAllowedError"), secure), /denied\. Allow it for this site/u);
  assert.match(microphoneErrorMessage(new DOMException("none", "NotFoundError"), secure), /No microphone was found/u);
  assert.match(microphoneErrorMessage(new DOMException("busy", "NotReadableError"), secure), /busy or unavailable/u);
  assert.equal(microphoneErrorMessage(new Error("weird"), secure), "The microphone could not be opened: weird");
  assert.match(microphoneErrorMessage(new DOMException("denied", "NotAllowedError"), { secure: false, desktop: false }), /secure pages: open HUI on https:\/\//u);
  assert.match(microphoneErrorMessage(undefined, { secure: true, desktop: true }), /desktop app does not allow the microphone yet/u);
});

test("a recording goes to the gateway as raw audio with the local-client header", async () => {
  const calls = stubFetch(() => Response.json({ text: "Hola" }));
  const recording = new Blob([new Uint8Array(64)], { type: "audio/webm" });
  assert.equal(await transcribeRecording(recording, { language: "es" }), "Hola");
  assert.equal(calls[0]!.url, "/__hui/voice/transcriptions?language=es");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(calls[0]!.init.headers, { "x-hui": "1", "content-type": "audio/webm" });
  assert.equal(calls[0]!.init.body, recording);
  stubFetch(() => Response.json({ error: "Connect VoiceStudio in Settings → Integrations first." }, { status: 409 }));
  await assert.rejects(transcribeRecording(recording), /Connect VoiceStudio in Settings/u);
});

test("speech is asked for with the bot and comes back as audio", async () => {
  const calls = stubFetch(() => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0xc4]), { headers: { "content-type": "audio/mpeg" } }));
  const audio = await synthesizeSpeech({ text: "Hi.", botId: "scout" });
  assert.equal(audio.type, "audio/mpeg");
  assert.equal(audio.size, 4);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { text: "Hi.", botId: "scout" });
  stubFetch(() => new Response("bad gateway", { status: 502 }));
  await assert.rejects(synthesizeSpeech({ text: "Hi." }), /VoiceStudio could not speak that \(HTTP 502\)\./u);
  const sent = stubFetch(() => Response.json({ status: "queued" }, { status: 202 }));
  assert.equal(await sendBotMessage("scout", "[voice] Hello"), "queued");
  assert.equal(sent[0]!.url, "/__hui/bots/scout/messages");
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { text: "[voice] Hello" });
});

test("Settings sums the connection up in one line, never with the key", () => {
  assert.equal(voiceConnectionSummary({ configured: false, url: "", keySet: false }), "Not connected.");
  assert.equal(voiceConnectionSummary({ configured: true, url: "https://gpu.ts.net", keySet: true, reachable: true, service: "VoiceStudio", version: "2.4.0" }), "Reachable · VoiceStudio 2.4.0 · API key saved");
  assert.equal(voiceConnectionSummary({ configured: true, url: "http://127.0.0.1:3900", keySet: false, reachable: false, error: "VoiceStudio could not be reached at http://127.0.0.1:3900 (connection refused; is it running?)." }), "Not reachable: VoiceStudio could not be reached at http://127.0.0.1:3900 (connection refused; is it running?).");
  assert.equal(voiceConnectionSummary({ configured: true, url: "http://127.0.0.1:3900", keySet: false }), "Saved; not checked yet.");
});
