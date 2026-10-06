import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pickerRows } from "./picker-options.ts";
import { formatCallTime, languageOptions, microphoneErrorMessage, sendBotMessage, speedLabel, synthesizeSpeech, transcribeRecording, voiceConnectionSummary, voiceOptions, voiceStatusChip, withTranscript } from "./voice.ts";

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

test("the voice picker lists VoiceStudio's default, then cloned voices and engine voices, never OpenAI's aliases", () => {
  const alias = (id: string) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), type: "openai_alias", description: `OpenAI '${id}' voice — maps to the active VoiceStudio engine's default voice.` });
  const voices = [
    alias("alloy"),
    alias("nova"),
    { id: "vp-dani", name: "Dani (own voice)", type: "profile", language: "es" },
    { id: "preset-1", name: "Narrator", type: "kittentts" },
  ];
  const listed = [
    { value: "", label: "VoiceStudio default" },
    { value: "vp-dani", label: "Dani (own voice)", description: "Voice profile · es" },
    { value: "preset-1", label: "Narrator", description: "kittentts" },
  ];
  assert.deepEqual(voiceOptions(voices, ""), listed, "each alias only plays VoiceStudio's default voice again");
  assert.deepEqual(voiceOptions(voices, "vp-dani"), listed);
  assert.deepEqual(voiceOptions(voices, "nova"), [...listed, { value: "nova", label: "Nova", description: "OpenAI alias: plays VoiceStudio's default voice" }],
    "a bot that already uses an alias keeps it, described for what it plays");
  assert.deepEqual(voiceOptions([], "vp-gone").at(-1), { value: "vp-gone", label: "vp-gone", description: "Not listed by VoiceStudio now" }, "a saved voice still shows");
  assert.deepEqual(voiceOptions([], "alloy").at(-1), { value: "alloy", label: "alloy", description: "Not listed by VoiceStudio now" }, "an alias VoiceStudio does not list is just unlisted");
});

test("the language picker offers Auto, then Whisper's 100 languages by English name with their codes", () => {
  const options = languageOptions();
  assert.equal(options.length, 101);
  assert.deepEqual(options[0], { value: "", label: "Auto (detect)" });
  const labels = options.slice(1).map((option) => option.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "en")), "sorted by name");
  const byCode = new Map(options.map((option) => [option.value, option]));
  assert.deepEqual(byCode.get("es"), { value: "es", label: "Spanish", description: "es" });
  assert.deepEqual(byCode.get("haw"), { value: "haw", label: "Hawaiian", description: "haw" });
  assert.deepEqual(byCode.get("yue"), { value: "yue", label: "Cantonese", description: "yue" });
  assert.equal(byCode.get("jw")?.label, "Javanese", "Whisper's jw is Javanese");
  assert.equal(byCode.has("jv"), false, "ISO's jv is not a code HUI stores");
  // Where the browser names a language otherwise, Whisper's name stays searchable.
  assert.deepEqual(byCode.get("bn"), { value: "bn", label: "Bangla", description: "bn · Bengali" });
  const search = (query: string) => pickerRows(options, query).map((option) => option.value);
  assert.deepEqual(search("spanish"), ["es"], "by name");
  assert.ok(search("es").includes("es"), "by code");
  assert.deepEqual(search("bengali"), ["bn"]);
  assert.deepEqual(search("haw"), ["haw"]);
  assert.deepEqual(search("canto"), ["yue"]);
  assert.deepEqual(search("auto"), [""]);
});

test("a language the browser cannot name keeps Whisper's name", () => {
  const names = { of: (code: string) => ({ es: "Spanish", ht: "Haitian Creole", my: "Burmese" } as Record<string, string>)[code] };
  const byCode = new Map(languageOptions(names).map((option) => [option.value, option]));
  assert.deepEqual(byCode.get("es"), { value: "es", label: "Spanish", description: "es" });
  assert.deepEqual(byCode.get("ht"), { value: "ht", label: "Haitian Creole", description: "ht" }, "the same name in another case is no alias");
  assert.deepEqual(byCode.get("my"), { value: "my", label: "Burmese", description: "my · Myanmar" });
  assert.deepEqual(byCode.get("jw"), { value: "jw", label: "Javanese", description: "jw" });
  assert.deepEqual(byCode.get("de"), { value: "de", label: "German", description: "de" });
  const failing = new Map(languageOptions({ of: () => { throw new RangeError("no names"); } }).map((option) => [option.value, option]));
  assert.equal(failing.get("yue")?.label, "Cantonese", "a platform that throws still names it");
  assert.equal(languageOptions(null).length, 101, "no platform names at all");
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
  await transcribeRecording(recording, { botId: "vox" });
  assert.equal(calls[1]!.url, "/__hui/voice/transcriptions?botId=vox", "the gateway reads the bot's language");
  await transcribeRecording(recording, { botId: "vox", language: "" });
  assert.equal(calls[2]!.url, "/__hui/voice/transcriptions?botId=vox&language=", "\"\" asks for Auto over the bot's");
  await transcribeRecording(recording);
  assert.equal(calls[3]!.url, "/__hui/voice/transcriptions");
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
  assert.deepEqual(voiceStatusChip(undefined), { kind: "muted", label: "Checking…" });
  assert.deepEqual(voiceStatusChip({ configured: false, url: "", keySet: false }), { kind: "muted", label: "Not connected" });
  assert.deepEqual(voiceStatusChip({ configured: true, url: "x", keySet: false, reachable: true }), { kind: "ok", label: "Connected" });
  assert.deepEqual(voiceStatusChip({ configured: true, url: "x", keySet: false, reachable: false }), { kind: "danger", label: "Unreachable" });
});

test("a voice note joins what the composer already holds", () => {
  assert.equal(withTranscript("", "  Call Ana at five. "), "Call Ana at five.");
  assert.equal(withTranscript("Reminder:", "call Ana"), "Reminder: call Ana");
  assert.equal(withTranscript("Reminder:\n", "call Ana"), "Reminder:\ncall Ana");
  assert.equal(withTranscript("Keep this", "   "), "Keep this");
});
