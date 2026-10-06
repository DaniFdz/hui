#!/usr/bin/env node
/** Deterministic VoiceStudio speech-platform subset for HUI's voice tests and Browser E2E.
 * Usage: HUI_E2E_VOICE_PORT=0 [HUI_E2E_VOICE_KEY=<bearer>] node e2e/voicestudio-fixture.mjs
 * It neither recognizes nor synthesizes speech: /v1/audio/transcriptions answers scripted text,
 * /v1/audio/speech a short valid clip in the asked format (a soft tone in wav/pcm, silent MP3
 * frames, silent Ogg Opus), streamed in chunks for stream_format "audio". Shapes follow
 * VoiceStudio's docs (docs/agentic-voice.md, docs/speech-platform.md, docs/api-auth.md).
 * Control routes (never behind the key):
 *   GET  /control/requests     every API request (fields such as the language, sizes, auth), never audio bytes
 *   POST /control/transcripts  {"texts": [...]} queues the next transcriptions' text
 *   POST /control/key          {"key": "..." | null} requires a bearer key, or stops requiring one
 *   POST /control/speech       {"secondsPerCharacter"?, "minSeconds"?, "maxSeconds"?} clip length
 *   POST /control/fail         {"path", "status", "message"?, "code"?, "text"?, "times"?}
 *   POST /control/delay        {"path", "ms", "phase"?: "headers" | "body", "times"?}
 *   POST /control/redirect     {"path", "location", "status"?, "times"?}
 *   POST /control/reset        forgets requests, transcripts and every injected behavior */
import { createServer } from "node:http";

const port = Number(process.env.HUI_E2E_VOICE_PORT ?? 43139);
let origin = `http://127.0.0.1:${port}`;
const DEFAULT_TRANSCRIPT = "Hello from the voice fixture.";
const OPENAI_VOICES = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];
const PROFILES = [
  { voice_id: "vp-aria", name: "Aria", type: "profile", language: "en" },
  { voice_id: "vp-bruno", name: "Bruno", type: "profile", language: "en" },
  { voice_id: "vp-dani", name: "Dani (own voice)", type: "profile", language: "es" },
];
const KNOWN_VOICES = new Set(["default", ...OPENAI_VOICES, ...PROFILES.map((profile) => profile.voice_id)]);
const TTS_MODELS = ["tts-1", "tts-1-hd", "gpt-4o-mini-tts", "omnivoice"];
const STT_MODELS = ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "faster-whisper"];
const MEDIA = { mp3: "audio/mpeg", opus: "audio/ogg", wav: "audio/wav", pcm: "audio/pcm", flac: "audio/flac", aac: "audio/aac" };
const PCM_RATE = 24_000;
const CHUNK = 4096;

const initialSpeech = { secondsPerCharacter: 0.06, minSeconds: 0.6, maxSeconds: 6 };
let key = process.env.HUI_E2E_VOICE_KEY || null;
let speech = { ...initialSpeech };
let requests = [];
let transcripts = [];
let failures = [];
let delays = [];
let redirects = [];

/* ── audio ── */

/** A soft 440 Hz tone with short fades, so the bytes are audibly real audio. */
function tone(seconds) {
  const count = Math.max(1, Math.round(seconds * PCM_RATE));
  const samples = new Int16Array(count);
  const fade = Math.max(1, Math.min(count / 2, PCM_RATE * 0.02));
  for (let index = 0; index < count; index++) {
    const envelope = Math.min(1, index / fade, (count - 1 - index) / fade);
    samples[index] = Math.round(Math.sin((2 * Math.PI * 440 * index) / PCM_RATE) * 0.08 * 32767 * envelope);
  }
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Silent MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz, mono, zero side information). */
function mp3(seconds) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: Math.max(1, Math.ceil((seconds * 44_100) / 1152)) }, () => frame));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function oggPage(packets, { granule, sequence, flags }) {
  const lacing = [];
  for (const packet of packets) {
    let size = packet.length;
    for (; size >= 255; size -= 255) lacing.push(255);
    lacing.push(size);
  }
  const header = Buffer.alloc(27 + lacing.length);
  header.write("OggS", 0);
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(0x48554931, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = lacing.length;
  header.set(lacing, 27);
  const page = Buffer.concat([header, ...packets]);
  let crc = 0;
  for (const byte of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  page.writeUInt32LE(crc, 22);
  return page;
}

/** Ogg Opus at 48 kHz: OpusHead, OpusTags, then 20 ms silent CELT frames. */
function opus(seconds) {
  const preSkip = 312;
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0);
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(48_000, 12);
  const vendor = Buffer.from("hui-voicestudio-fixture");
  const tags = Buffer.alloc(16 + vendor.length);
  tags.write("OpusTags", 0);
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  const pages = [oggPage([head], { granule: 0, sequence: 0, flags: 2 }), oggPage([tags], { granule: 0, sequence: 1, flags: 0 })];
  const frames = Math.max(1, Math.ceil(seconds * 50));
  const silence = Buffer.from([0xf8, 0xff, 0xfe]);
  for (let written = 0; written < frames;) {
    const count = Math.min(50, frames - written);
    written += count;
    pages.push(oggPage(Array.from({ length: count }, () => silence), { granule: preSkip + written * 960, sequence: pages.length, flags: written === frames ? 4 : 0 }));
  }
  return Buffer.concat(pages);
}

/* ── http ── */

const errorType = (status) => status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "server_error" : "invalid_request_error";
function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
/** VoiceStudio's /v1 errors: OpenAI's shape plus FastAPI's `detail`. */
function openAiError(response, status, message, { param = null, code = null } = {}) {
  json(response, status, { error: { message, type: errorType(status), param, code }, detail: message });
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The first matching rule, used up after `times` matches. */
function take(rules, path, matches = () => true) {
  const rule = rules.find((item) => item.path === path && matches(item));
  if (rule && --rule.times <= 0) rules.splice(rules.indexOf(rule), 1);
  return rule;
}

async function control(request, response, url, body) {
  const route = `${request.method} ${url.pathname}`;
  const input = body.length ? JSON.parse(body.toString("utf8")) : {};
  if (route === "GET /control/requests") return json(response, 200, requests);
  if (route === "POST /control/reset") {
    requests = []; transcripts = []; failures = []; delays = []; redirects = [];
    speech = { ...initialSpeech };
    return json(response, 200, { ok: true });
  }
  if (route === "POST /control/transcripts") { transcripts.push(...input.texts); return json(response, 200, { queued: transcripts.length }); }
  if (route === "POST /control/key") { key = input.key || null; return json(response, 200, { key: Boolean(key) }); }
  if (route === "POST /control/speech") { speech = { ...speech, ...input }; return json(response, 200, speech); }
  if (route === "POST /control/fail") { failures.push({ times: 1, ...input }); return json(response, 200, { ok: true }); }
  if (route === "POST /control/delay") { delays.push({ times: 1, phase: "headers", ...input }); return json(response, 200, { ok: true }); }
  if (route === "POST /control/redirect") { redirects.push({ times: 1, status: 302, ...input }); return json(response, 200, { ok: true }); }
  return json(response, 404, { detail: "Not Found" });
}

function discovery() {
  return {
    schema: "voicestudio.speech-capabilities",
    protocol: "voicestudio.speech.v1",
    protocol_version: "1.0",
    service: "VoiceStudio",
    service_version: "0.0.0-hui-fixture",
    local_first: true,
    endpoints: {
      capabilities: { path: "/.well-known/voicestudio-speech", transport: "http", method: "GET", protocol: null },
      batch_transcription: { path: "/v1/audio/transcriptions", transport: "http", method: "POST", protocol: "openai.audio.transcriptions" },
      streaming_transcription: { path: "/v1/audio/transcriptions/stream", transport: "websocket", method: null, protocol: "voicestudio.speech.v1" },
      mcp: { path: "/mcp", transport: "mcp-streamable-http", method: "POST", protocol: "mcp" },
    },
    stream_input: { framing: "binary", formats: ["audio/pcm;encoding=s16le;channels=1", "audio/webm;codecs=opus"], default_format: "audio/webm;codecs=opus", sample_rate_query: "sr", end_control: { type: "input_audio.end" } },
    stream_output: { framing: "json", events: ["session.started", "status", "partial", "final", "error"], final_kinds: ["utterance", "summary"] },
    features: { batch_transcription: true, streaming_transcription: true, partial_transcripts: true, utterance_finals: true, session_summary: true, word_timestamps: true, local_refinement: true, acoustic_echo_cancellation: true, native_dictation_control: false },
    authentication: { loopback: "none", remote: "bearer", header: "Authorization: Bearer <OMNIVOICE_API_KEY>", browser_session_endpoint: "/api/auth/session", websocket_ticket_endpoint: "/api/auth/ws-ticket", websocket_ticket_query_parameter: "ws_ticket" },
  };
}

const model = (id, kind, alias) => ({ id, object: "model", created: 0, owned_by: "voicestudio", voicestudio: { kind, alias_for_active_engine: alias } });

async function transcription(request, response, body, record) {
  let form;
  try {
    form = await new Response(body, { headers: { "content-type": request.headers["content-type"] ?? "" } }).formData();
  } catch {
    return openAiError(response, 400, "Invalid multipart body.", { code: "invalid_value" });
  }
  const file = form.get("file");
  const field = (name) => typeof form.get(name) === "string" ? form.get(name) : undefined;
  record.transcription = {
    model: field("model"), language: field("language"), prompt: field("prompt"), response_format: field("response_format"),
    filename: file?.name, fileType: file?.type, fileBytes: file?.size,
  };
  if (!(file instanceof Blob)) return openAiError(response, 400, "Invalid value for 'file': Field required", { param: "file", code: "invalid_value" });
  if (field("stream") === "true") return openAiError(response, 400, "stream=true is not supported; use the WebSocket.", { param: "stream", code: "unsupported_value" });
  if (file.size < 64) return openAiError(response, 400, "The uploaded file has no audio stream.", { param: "file", code: "no_audio_track" });
  const format = field("response_format") ?? "json";
  const text = transcripts.length ? transcripts.shift() : DEFAULT_TRANSCRIPT;
  record.transcription.text = text;
  if (format === "text") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end(text);
  }
  if (format === "verbose_json") return json(response, 200, { task: "transcribe", language: field("language") ?? "en", duration: 1, text, segments: [] });
  if (format !== "json") return openAiError(response, 400, `Unsupported response_format '${format}'.`, { param: "response_format", code: "invalid_value" });
  return json(response, 200, { text });
}

async function synthesize(response, body, record, url) {
  let input;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    return openAiError(response, 400, "Invalid JSON body.", { code: "invalid_value" });
  }
  const format = input.response_format ?? "mp3";
  const voice = typeof input.voice === "object" && input.voice ? input.voice.id : input.voice ?? "default";
  const speed = input.speed ?? 1;
  // `language` (VoiceStudio's extension) only when the request has one, as `/control/requests` shows it.
  record.speech = { model: input.model, voice, speed, language: input.language, response_format: format, stream_format: input.stream_format, input: input.input };
  if (input.model !== undefined && !TTS_MODELS.includes(input.model)) return openAiError(response, 400, `The model '${input.model}' does not exist on this VoiceStudio server.`, { param: "model", code: "model_not_found" });
  if (typeof input.input !== "string" || !input.input || input.input.length > 4096) return openAiError(response, 400, "Invalid value for 'input': String should have at most 4096 characters", { param: "input", code: "invalid_value" });
  if (!KNOWN_VOICES.has(voice)) return openAiError(response, 400, `Voice '${voice}' was not found.`, { param: "voice", code: "voice_not_found" });
  if (typeof speed !== "number" || speed < 0.25 || speed > 4) return openAiError(response, 400, "Invalid value for 'speed': Input should be between 0.25 and 4", { param: "speed", code: "invalid_value" });
  if (!(format in MEDIA)) return openAiError(response, 400, `Invalid value for 'response_format': '${format}'`, { param: "response_format", code: "invalid_value" });
  if (format === "flac" || format === "aac") return openAiError(response, 400, `The fixture does not encode ${format}.`, { param: "response_format", code: "unsupported_response_format" });
  const seconds = Math.min(speech.maxSeconds, Math.max(speech.minSeconds, [...input.input].length * speech.secondsPerCharacter)) / speed;
  const audio = format === "mp3" ? mp3(seconds) : format === "opus" ? opus(seconds) : format === "wav" ? wav(tone(seconds)) : tone(seconds);
  record.speech.bytes = audio.length;
  record.speech.seconds = Math.round(seconds * 1000) / 1000;
  if (input.stream_format === "sse") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (let offset = 0; offset < audio.length; offset += CHUNK) response.write(`data: ${JSON.stringify({ type: "speech.audio.delta", audio: audio.subarray(offset, offset + CHUNK).toString("base64") })}\n\n`);
    return response.end(`data: ${JSON.stringify({ type: "speech.audio.done", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } })}\n\n`);
  }
  if (input.stream_format !== "audio") {
    response.writeHead(200, { "content-type": MEDIA[format], "content-length": audio.length });
    return response.end(audio);
  }
  // Chunked, without content-length, as VoiceStudio streams.
  response.writeHead(200, { "content-type": MEDIA[format] });
  const stall = take(delays, url.pathname, (item) => item.phase === "body");
  for (let offset = 0; offset < audio.length; offset += CHUNK) {
    if (response.destroyed) return;
    response.write(audio.subarray(offset, offset + CHUNK));
    if (offset === 0 && stall) await wait(stall.ms);
    await new Promise((resolve) => setImmediate(resolve));
  }
  response.end();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", origin);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (url.pathname.startsWith("/control/")) return control(request, response, url, body);
  const authorization = request.headers.authorization;
  const record = {
    at: new Date().toISOString(), method: request.method, path: url.pathname,
    auth: !authorization ? "none" : authorization === `Bearer ${key}` ? "valid" : "invalid",
    contentType: request.headers["content-type"] ?? "", bytes: body.length,
  };
  requests.push(record);
  const delay = take(delays, url.pathname, (item) => item.phase === "headers");
  if (delay) await wait(delay.ms);
  if (response.destroyed) return;
  // VoiceStudio's middleware answers FastAPI-style, not OpenAI-style.
  if (key && authorization !== `Bearer ${key}`) return json(response, 401, { detail: "API key required" });
  const redirect = take(redirects, url.pathname);
  if (redirect) {
    response.writeHead(redirect.status, { location: redirect.location });
    return response.end();
  }
  const failure = take(failures, url.pathname);
  if (failure) {
    if (failure.text !== undefined) {
      response.writeHead(failure.status, { "content-type": "text/plain" });
      return response.end(failure.text);
    }
    return openAiError(response, failure.status, failure.message ?? "Injected failure.", { code: failure.code ?? null });
  }
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /.well-known/voicestudio-speech" || route === "GET /v1/audio/capabilities") return json(response, 200, discovery());
  if (route === "GET /v1/models") return json(response, 200, { object: "list", data: [...TTS_MODELS.slice(0, 3).map((id) => model(id, "tts", true)), ...STT_MODELS.slice(0, 3).map((id) => model(id, "stt", true)), model("omnivoice", "tts", false), model("faster-whisper", "stt", false)] });
  if (route === "GET /v1/audio/voices") {
    return json(response, 200, {
      voices: [
        ...OPENAI_VOICES.map((name) => ({ voice_id: name, name: name[0].toUpperCase() + name.slice(1), type: "openai_alias", description: `OpenAI '${name}' voice — maps to the active VoiceStudio engine's default voice.` })),
        ...PROFILES,
      ],
      engines: [{ id: "omnivoice", name: "OmniVoice", available: true }],
    });
  }
  if (route === "POST /v1/audio/transcriptions") return transcription(request, response, body, record);
  if (route === "POST /v1/audio/speech") return synthesize(response, body, record, url);
  return json(response, 404, { detail: "Not Found" });
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
  process.stdout.write(`VoiceStudio fixture listening on ${origin}\n`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
