import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";

import { speechLanguage, VOICE_LANGUAGES, VOICE_PROTOCOL, voiceLanguage, voiceLanguageName } from "../shared/voice.ts";
import {
  KEY_TRANSPORT_MESSAGE,
  keyTransportAllowed,
  normalizeVoiceUrl,
  parseDiscovery,
  parseVoices,
  VoiceConfigStore,
  voiceConnectionView,
  voiceErrorMessage,
  VoiceInputError,
  VoiceNotConfiguredError,
  VoiceRequestError,
  VoiceService,
  VoiceStudioClient,
  type VoiceFetch,
} from "./voice.ts";

// One deterministic VoiceStudio for the whole file (e2e/voicestudio-fixture.mjs), reset before each test.
const dir = await mkdtemp(join(tmpdir(), "hui-voice-"));
const fixture = spawn(process.execPath, [fileURLToPath(new URL("../e2e/voicestudio-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_VOICE_PORT: "0" },
});
const [ready] = await once(fixture.stdout!, "data");
const origin = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0] ?? "";
assert(origin, String(ready));

type FixtureRequest = { method: string; path: string; auth: string; contentType: string; bytes: number; speech?: Record<string, unknown>; transcription?: Record<string, unknown> };

async function control<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/control/${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return await response.json() as T;
}
const fixtureRequests = () => control<FixtureRequest[]>("requests");

let stores = 0;
const freshStore = () => new VoiceConfigStore(join(dir, `voicestudio-${++stores}.json`));

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

/** A port nothing listens on. */
async function closedOrigin(): Promise<string> {
  const server = createServer();
  const url = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return url;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<{ bytes: Buffer; chunks: number }> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return { bytes: Buffer.concat(parts), chunks: parts.length };
}

/** An in-memory VoiceStudio for request-shape checks that need no network. */
function fakeVoiceStudio(handler?: (url: URL, init: RequestInit) => Response | undefined) {
  const calls: { url: string; method: string; authorization: string | null; redirect: RequestRedirect | undefined }[] = [];
  const fetchImpl: VoiceFetch = async (url, init) => {
    calls.push({ url, method: init.method ?? "GET", authorization: new Headers(init.headers).get("authorization"), redirect: init.redirect });
    const parsed = new URL(url);
    const custom = handler?.(parsed, init);
    if (custom) return custom;
    if (parsed.pathname.endsWith("/.well-known/voicestudio-speech")) {
      return Response.json({ protocol: VOICE_PROTOCOL, service: "VoiceStudio", service_version: "1.2.3", features: { batch_transcription: true, native_dictation_control: false, "not a feature": true } });
    }
    if (parsed.pathname.endsWith("/v1/models")) return Response.json({ object: "list", data: [{ id: "tts-1", voicestudio: { kind: "tts" } }, { id: "whisper-1", voicestudio: { kind: "stt" } }] });
    return Response.json({ detail: "Not Found" }, { status: 404 });
  };
  return { calls, fetch: fetchImpl };
}

beforeEach(async () => {
  await control("reset", {});
  await control("key", { key: null });
});

after(async () => {
  const exit = once(fixture, "exit");
  fixture.kill();
  await exit;
  await rm(dir, { recursive: true, force: true });
});

test("normalizes VoiceStudio's address to its service root", () => {
  assert.equal(normalizeVoiceUrl("127.0.0.1:3900"), "http://127.0.0.1:3900");
  assert.equal(normalizeVoiceUrl(" http://gpu-box:3900/ "), "http://gpu-box:3900");
  assert.equal(normalizeVoiceUrl("https://GPU.tail1234.ts.net/v1"), "https://gpu.tail1234.ts.net", "a pasted OpenAI base URL loses /v1");
  assert.equal(normalizeVoiceUrl("https://proxy.example/voicestudio/v1/"), "https://proxy.example/voicestudio", "a reverse-proxy prefix stays");
  assert.equal(normalizeVoiceUrl("http://[::1]:3900"), "http://[::1]:3900");
  for (const bad of ["", "   ", "ftp://gpu-box", "http://user:secret@gpu-box:3900", "http://gpu-box:3900/?key=1", "http://gpu-box:3900/#x", "http://exa mple"]) {
    assert.throws(() => normalizeVoiceUrl(bad), VoiceInputError, bad);
  }
  assert.throws(() => normalizeVoiceUrl(42), VoiceInputError);
});

test("sends a key only over HTTPS, to this machine or to a Tailscale address", () => {
  for (const allowed of ["https://voice.example", "http://127.0.0.1:3900", "http://127.8.0.1", "http://localhost:3900", "http://[::1]:3900", "http://100.64.0.1:3900", "http://100.127.255.254", "http://gpu.tail1234.ts.net:3900", "http://[fd7a:115c:a1e0::12]:3900"]) {
    assert.equal(keyTransportAllowed(allowed), true, allowed);
  }
  for (const refused of ["http://192.168.1.20:3900", "http://10.0.0.5", "http://100.128.0.1", "http://100.63.255.255", "http://gpu-box:3900", "http://voice.example", "http://[fe80::1]:3900"]) {
    assert.equal(keyTransportAllowed(refused), false, refused);
  }
});

test("stores the connection privately and never shows the key", async () => {
  const store = freshStore();
  assert.equal(await store.read(), undefined);
  await store.write({ url: "http://127.0.0.1:3900", apiKey: "secret-voice-key" });
  assert.deepEqual(await store.read(), { url: "http://127.0.0.1:3900", apiKey: "secret-voice-key" });
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  const view = voiceConnectionView(await store.read());
  assert.deepEqual(view, { configured: true, url: "http://127.0.0.1:3900", keySet: true });
  assert.equal(JSON.stringify(view).includes("secret-voice-key"), false);
  assert.deepEqual(voiceConnectionView(undefined), { configured: false, url: "", keySet: false });
  // A damaged file is no connection, never a crash.
  await writeFile(store.path, "{not json");
  assert.equal(await store.read(), undefined);
  await writeFile(store.path, JSON.stringify({ url: "ftp://nowhere", apiKey: "x" }));
  assert.equal(await store.read(), undefined);
  await store.remove();
  await store.remove();
  assert.equal(await store.read(), undefined);
});

test("reads VoiceStudio's discovery document, model list and voices", async () => {
  const client = new VoiceStudioClient({ url: origin });
  const discovery = await client.discover();
  assert.equal(discovery.protocol, VOICE_PROTOCOL);
  assert.equal(discovery.service, "VoiceStudio");
  assert.equal(discovery.version, "0.0.0-hui-fixture");
  assert.equal(discovery.features["batch_transcription"], true);
  assert.equal(discovery.features["native_dictation_control"], false);
  assert.equal(discovery.transcriptionPath, "/v1/audio/transcriptions");
  const models = await client.models();
  assert.ok(models.speech.includes("tts-1") && models.speech.includes("omnivoice"));
  assert.ok(models.transcription.includes("whisper-1") && models.transcription.includes("faster-whisper"));
  const voices = await client.voices();
  assert.deepEqual(voices.find((voice) => voice.id === "vp-dani"), { id: "vp-dani", name: "Dani (own voice)", type: "profile", language: "es" });
  assert.equal(voices.find((voice) => voice.id === "alloy")?.type, "openai_alias");
  assert.deepEqual(parseVoices([{ voice_id: "a" }, { voice_id: "a", name: "dupe" }, { name: "no id" }, "junk", { id: "b", name: "  B  " }]), [{ id: "a", name: "a" }, { id: "b", name: "B" }]);
  assert.throws(() => parseDiscovery({ protocol: "other" }), /not as VoiceStudio's speech platform/u);
  assert.equal(parseDiscovery({ protocol: VOICE_PROTOCOL, endpoints: { batch_transcription: { path: "//evil.example/x" } } }).transcriptionPath, undefined, "a discovered path never leaves the origin");
});

test("transcribes a recording with the recognizer fields OpenAI's API takes", async () => {
  await control("transcripts", { texts: ["Plan the week with me."] });
  const client = new VoiceStudioClient({ url: origin });
  const audio = { data: new Uint8Array(2048).fill(7), contentType: "audio/webm", filename: "recording.webm" };
  assert.equal(await client.transcribe(audio, { language: "es", prompt: "HUI, OptChat" }), "Plan the week with me.");
  const [request] = await fixtureRequests();
  assert.equal(request?.path, "/v1/audio/transcriptions");
  assert.match(request?.contentType ?? "", /^multipart\/form-data; boundary=/u);
  assert.deepEqual(request?.transcription, { model: "whisper-1", language: "es", prompt: "HUI, OptChat", response_format: "json", filename: "recording.webm", fileType: "audio/webm", fileBytes: 2048, text: "Plan the week with me." });
  // VoiceStudio's own refusal reaches the caller in its words.
  await assert.rejects(client.transcribe({ ...audio, data: new Uint8Array(10) }), (error: unknown) => error instanceof VoiceRequestError && error.status === 400 && error.message === "VoiceStudio: The uploaded file has no audio stream.");
});

test("streams speech in the content type VoiceStudio sends", async () => {
  // VoiceStudio holds the rest of the clip after its first chunk: what arrives before the rest is sent proves the
  // client streams it rather than waiting for the whole body (socket reads alone may merge chunks under load).
  await control("delay", { path: "/v1/audio/speech", ms: 400, phase: "body" });
  const client = new VoiceStudioClient({ url: origin });
  const mp3 = await client.speech({ input: "Good morning, Dani. Here is your plan.", voice: "vp-aria", speed: 1.25, format: "mp3" });
  assert.equal(mp3.contentType, "audio/mpeg");
  const read = await readAll(mp3.audio);
  assert.ok(read.chunks > 1, "the clip arrives in chunks, not as one buffer");
  assert.deepEqual([...read.bytes.subarray(0, 4)], [0xff, 0xfb, 0x90, 0xc4], "MPEG audio frames");
  const opus = await client.speech({ input: "Short.", voice: "default", speed: 1, format: "opus" });
  assert.equal(opus.contentType, "audio/ogg");
  assert.equal((await readAll(opus.audio)).bytes.subarray(0, 4).toString("latin1"), "OggS");
  const [first, second] = await fixtureRequests();
  assert.deepEqual(first?.speech && { ...first.speech, bytes: undefined, seconds: undefined }, { model: "tts-1", voice: "vp-aria", speed: 1.25, response_format: "mp3", stream_format: "audio", input: "Good morning, Dani. Here is your plan.", bytes: undefined, seconds: undefined });
  assert.equal(read.bytes.length, first?.speech?.["bytes"]);
  assert.equal(second?.speech?.["response_format"], "opus");
  await assert.rejects(client.speech({ input: "Hi", voice: "nobody", speed: 1, format: "mp3" }), /VoiceStudio: Voice 'nobody' was not found\./u);
});

test("a bot's language is one of Whisper's 100 codes, haw and yue included, and Javanese speaks as jv", () => {
  const codes = Object.keys(VOICE_LANGUAGES);
  assert.equal(codes.length, 100);
  assert.equal(new Set(codes).size, 100);
  assert.deepEqual(codes.slice(0, 4), ["en", "zh", "de", "es"], "Whisper's order");
  assert.deepEqual(codes.filter((code) => code.length !== 2), ["haw", "yue"], "two ISO 639-3 codes, the rest ISO 639-1-shaped");
  assert.equal(VOICE_LANGUAGES.jw, "javanese");
  for (const [input, code] of [["es", "es"], [" ES ", "es"], ["haw", "haw"], ["YUE", "yue"], ["jw", "jw"]] as const) assert.equal(voiceLanguage(input), code, input);
  // A regex for two or three letters would let these through; the list does not.
  for (const input of ["jv", "xx", "zzz", "spanish", "es-ES", "auto", "", "constructor", "__proto__", 7, null, undefined, ["es"]]) {
    assert.equal(voiceLanguage(input), undefined, String(input));
  }
  assert.equal(speechLanguage("jw"), "jv", "VoiceStudio knows Javanese as ISO's jv");
  for (const code of codes) if (code !== "jw") assert.equal(speechLanguage(code as keyof typeof VOICE_LANGUAGES), code);
  assert.equal(voiceLanguageName("es"), "Spanish");
  assert.equal(voiceLanguageName("haw"), "Hawaiian");
  assert.equal(voiceLanguageName("es", null), "Spanish", "Whisper's name when the platform has none");
  assert.equal(voiceLanguageName("ht", { of: () => undefined }), "Haitian Creole");
});

test("asks VoiceStudio's speech for a language only when there is one, Javanese as jv", async () => {
  const client = new VoiceStudioClient({ url: origin });
  for (const language of ["es", "jw", undefined] as const) {
    const spoken = await client.speech({ input: "Son las 10:30.", voice: "default", speed: 1, format: "mp3", language });
    await readAll(spoken.audio);
  }
  const sent = (await fixtureRequests()).map((item) => item.speech && Object.hasOwn(item.speech, "language") ? item.speech["language"] : "(none)");
  assert.deepEqual(sent, ["es", "jv", "(none)"]);
});

test("presents the API key as a bearer and explains VoiceStudio's refusals", async () => {
  await control("key", { key: "fixture-key" });
  await assert.rejects(new VoiceStudioClient({ url: origin }).discover(), (error: unknown) => error instanceof VoiceRequestError && error.status === 401 && /asks remote clients for its API key/u.test(error.message));
  await assert.rejects(new VoiceStudioClient({ url: origin, apiKey: "wrong" }).discover(), /VoiceStudio rejected the API key\./u);
  await new VoiceStudioClient({ url: origin, apiKey: "fixture-key" }).discover();
  assert.deepEqual((await fixtureRequests()).map((request) => request.auth), ["none", "invalid", "valid"]);
  assert.match(voiceErrorMessage(401, JSON.stringify({ detail: "PIN required" }), false), /share PIN is on/u);
  assert.equal(voiceErrorMessage(400, JSON.stringify({ error: { message: "Invalid value for 'speed'", type: "invalid_request_error" } }), false), "VoiceStudio: Invalid value for 'speed'");
  assert.equal(voiceErrorMessage(500, "Internal Server Error", false), "VoiceStudio failed (HTTP 500).");
  assert.equal(voiceErrorMessage(429, "", false), "VoiceStudio is busy (rate limited). Try again shortly.");
});

test("tells a wrong address, a different service and an unreachable host apart", async () => {
  await control("fail", { path: "/.well-known/voicestudio-speech", status: 404, text: "" });
  await assert.rejects(new VoiceStudioClient({ url: origin }).discover(), /no VoiceStudio discovery document/u);
  const other = createServer((_, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ protocol: "something.else" })); });
  const otherUrl = await listen(other);
  try {
    await assert.rejects(new VoiceStudioClient({ url: otherUrl }).discover(), /not as VoiceStudio's speech platform/u);
  } finally {
    other.close();
  }
  const closed = await closedOrigin();
  await assert.rejects(new VoiceStudioClient({ url: closed }).discover(), (error: unknown) => error instanceof VoiceRequestError && !error.timeout && error.message === `VoiceStudio could not be reached at ${closed} (connection refused; is it running?).`);
});

test("follows same-origin redirects only, so the key never reaches another origin", async () => {
  await control("key", { key: "fixture-key" });
  const client = new VoiceStudioClient({ url: origin, apiKey: "fixture-key" });
  await control("redirect", { path: "/.well-known/voicestudio-speech", location: "/v1/audio/capabilities", status: 307 });
  assert.equal((await client.discover()).protocol, VOICE_PROTOCOL);
  assert.deepEqual((await fixtureRequests()).map((request) => `${request.path}:${request.auth}`), ["/.well-known/voicestudio-speech:valid", "/v1/audio/capabilities:valid"]);

  let reached = 0;
  const elsewhere = createServer((_, response) => { reached += 1; response.end("{}"); });
  const elsewhereUrl = await listen(elsewhere);
  try {
    await control("redirect", { path: "/.well-known/voicestudio-speech", location: `${elsewhereUrl}/.well-known/voicestudio-speech`, status: 302 });
    await assert.rejects(client.discover(), (error: unknown) => error instanceof VoiceRequestError && error.message === `VoiceStudio redirected to ${elsewhereUrl}; HUI sends nothing to another origin.`);
    assert.equal(reached, 0);
  } finally {
    elsewhere.close();
  }

  // A recording is sent again on 307/308; any other redirect of a POST is refused.
  const audio = { data: new Uint8Array(512).fill(1), contentType: "audio/wav", filename: "recording.wav" };
  await control("reset", {});
  await control("redirect", { path: "/v1/audio/transcriptions", location: "/v1/audio/transcriptions", status: 307 });
  assert.equal(await client.transcribe(audio), "Hello from the voice fixture.");
  assert.deepEqual((await fixtureRequests()).map((request) => request.bytes > 512), [true, true]);
  await control("redirect", { path: "/v1/audio/transcriptions", location: "/v1/audio/transcriptions", status: 302 });
  await assert.rejects(client.transcribe(audio), /with a redirect HUI cannot repeat/u);
  const fake = fakeVoiceStudio(() => new Response(null, { status: 302, headers: { location: "/next" } }));
  await assert.rejects(new VoiceStudioClient({ url: "https://voice.example" }, { fetch: fake.fetch }).discover(), /redirected too many times/u);
  assert.equal(fake.calls.length, 4, "the first request and three redirects");
  assert.ok(fake.calls.every((call) => call.redirect === "manual"));
});

test("bounds every request with a timeout and lets a leaving client cancel", async () => {
  const quick = new VoiceStudioClient({ url: origin }, { timeouts: { request: 250, transcription: 250, idle: 250 } });
  await control("delay", { path: "/.well-known/voicestudio-speech", ms: 3000 });
  await assert.rejects(quick.discover(), (error: unknown) => error instanceof VoiceRequestError && error.timeout && error.message === "VoiceStudio did not answer within 0.3 s.");
  // Speech that stalls after its first chunk ends on the idle timeout.
  await control("delay", { path: "/v1/audio/speech", ms: 3000, phase: "body" });
  const speech = await quick.speech({ input: "This sentence is long enough to need several chunks of silent audio.", voice: "default", speed: 1, format: "mp3" });
  await assert.rejects(readAll(speech.audio), (error: unknown) => error instanceof VoiceRequestError && error.timeout);
  // A caller that leaves gets its own abort back, not a VoiceStudio failure.
  await control("delay", { path: "/v1/audio/transcriptions", ms: 3000 });
  const leaving = new AbortController();
  const pending = new VoiceStudioClient({ url: origin }).transcribe({ data: new Uint8Array(256), contentType: "audio/ogg", filename: "recording.ogg" }, {}, leaving.signal);
  leaving.abort(new DOMException("gone", "AbortError"));
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
});

test("connects only after VoiceStudio answers, then reports and forgets it", async () => {
  const store = freshStore();
  let now = 1_000_000;
  const service = new VoiceService({ store, now: () => now });
  assert.deepEqual(await service.connection(), { configured: false, url: "", keySet: false });
  await assert.rejects(service.voices(), VoiceNotConfiguredError);
  await assert.rejects(service.connect({ url: await closedOrigin() }), /could not be reached/u);
  await assert.rejects(service.connect({ url: origin, extra: 1 }), /Unknown connection field: extra/u);
  await assert.rejects(service.connect({ url: origin, apiKey: 7 }), VoiceInputError);
  assert.equal(await store.read(), undefined, "nothing is stored until VoiceStudio answers");

  const connected = await service.connect({ url: `${origin}/v1` });
  assert.deepEqual(connected, {
    configured: true, url: origin, keySet: false, reachable: true, checkedAt: new Date(now).toISOString(),
    protocol: VOICE_PROTOCOL, service: "VoiceStudio", version: "0.0.0-hui-fixture",
    features: { batch_transcription: true, streaming_transcription: true, partial_transcripts: true, utterance_finals: true, session_summary: true, word_timestamps: true, local_refinement: true, acoustic_echo_cancellation: true, native_dictation_control: false },
  });
  assert.deepEqual((await fixtureRequests()).map((request) => request.path), ["/.well-known/voicestudio-speech", "/v1/models"]);
  assert.deepEqual(await store.read(), { url: origin });

  // The reachability probe is reused for 30 seconds, then repeated.
  now += 29_000;
  assert.equal((await service.connection()).reachable, true);
  assert.equal((await fixtureRequests()).length, 2);
  now += 2_000;
  await control("fail", { path: "/.well-known/voicestudio-speech", status: 500, text: "boom" });
  const down = await service.connection();
  assert.equal(down.reachable, false);
  assert.equal(down.error, "VoiceStudio failed (HTTP 500).");
  assert.equal(down.configured, true);

  const voices = await service.voices();
  assert.ok(voices.some((voice) => voice.id === "vp-bruno"));
  assert.deepEqual(await service.disconnect(), { configured: false, url: "", keySet: false });
  assert.equal(await store.read(), undefined);
  await assert.rejects(stat(store.path), { code: "ENOENT" });
});

test("keeps the stored key for the same origin, drops it elsewhere and removes it on null", async () => {
  await control("key", { key: "fixture-key" });
  const store = freshStore();
  const service = new VoiceService({ store });
  await assert.rejects(service.connect({ url: origin }), /asks remote clients for its API key/u);
  await assert.rejects(service.connect({ url: origin, apiKey: "wrong" }), /rejected the API key/u);
  const connected = await service.connect({ url: origin, apiKey: " fixture-key " });
  assert.equal(connected.keySet, true);
  assert.equal(JSON.stringify(connected).includes("fixture-key"), false);
  assert.match(await readFile(store.path, "utf8"), /"apiKey": "fixture-key"/u);
  // An empty key means "keep the saved one" while the origin is the same.
  assert.equal((await service.connect({ url: `${origin}/`, apiKey: "" })).keySet, true);
  assert.equal((await new VoiceService({ store }).connection()).keySet, true, "a restarted gateway reads it back");
  // null asks to send none: this backend refuses, so the stored connection stays as it was.
  await assert.rejects(service.connect({ url: origin, apiKey: null }), /asks remote clients/u);
  assert.equal((await store.read())?.apiKey, "fixture-key");

  const fake = fakeVoiceStudio();
  const elsewhere = new VoiceService({ store: freshStore(), fetch: fake.fetch });
  await elsewhere.connect({ url: "https://voice-a.example", apiKey: "key-a" });
  await elsewhere.connect({ url: "https://voice-a.example/voicestudio" });
  assert.equal(fake.calls.at(-1)?.authorization, "Bearer key-a", "same origin, new path: the key stays");
  const moved = await elsewhere.connect({ url: "https://voice-b.example" });
  assert.equal(moved.keySet, false, "another origin never inherits the key");
  assert.equal(fake.calls.at(-1)?.authorization, null);
  assert.deepEqual(new Set(fake.calls.filter((call) => call.url.startsWith("https://voice-b.example")).map((call) => call.authorization)), new Set([null]));
});

test("refuses to send a key over plain HTTP to another network", async () => {
  const fake = fakeVoiceStudio();
  const service = new VoiceService({ store: freshStore(), fetch: fake.fetch });
  await assert.rejects(service.connect({ url: "http://192.168.1.20:3900", apiKey: "secret" }), (error: unknown) => error instanceof VoiceInputError && error.message === KEY_TRANSPORT_MESSAGE);
  assert.equal(fake.calls.length, 0, "nothing was sent");
  const keyless = await service.connect({ url: "http://192.168.1.20:3900" });
  assert.equal(keyless.keySet, false, "a backend that trusts this network needs no key");
  const tailnet = await service.connect({ url: "http://100.101.102.103:3900", apiKey: "secret" });
  assert.equal(tailnet.keySet, true);
  assert.equal(fake.calls.at(-1)?.authorization, "Bearer secret");
  // The discovery document's feature list is filtered to well-formed switches.
  assert.deepEqual(tailnet.features, { batch_transcription: true, native_dictation_control: false });
});
