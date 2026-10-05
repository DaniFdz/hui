import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import type { VoiceRouteRequest } from "./voice-routes.ts";

// HUI's state lives in a temporary directory: set before any module reads CONFIG_DIR.
const dir = await mkdtemp(join(tmpdir(), "hui-voice-routes-"));
process.env["HUI_CONFIG_DIR"] = join(dir, "hui");
const { createVoiceRoutes, VoiceTooLargeError } = await import("./voice-routes.ts");
const { VoiceConfigStore, VoiceService } = await import("./voice.ts");
const { BotNotFoundError } = await import("./bots.ts");

const fixture = spawn(process.execPath, [fileURLToPath(new URL("../e2e/voicestudio-fixture.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HUI_E2E_VOICE_PORT: "0" },
});
const [ready] = await once(fixture.stdout!, "data");
const origin = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0] ?? "";
assert(origin, String(ready));

type FixtureRequest = { path: string; auth: string; speech?: Record<string, unknown>; transcription?: Record<string, unknown> };
async function control<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/control/${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return await response.json() as T;
}
const fixtureRequests = () => control<FixtureRequest[]>("requests");

const voices: Record<string, { profile?: string; speed?: number }> = { scout: { profile: "vp-bruno", speed: 1.25 }, plain: {} };
let stores = 0;
function routes(timeouts?: { speech?: number; transcription?: number }) {
  const service = new VoiceService({ store: new VoiceConfigStore(join(dir, `voicestudio-${++stores}.json`)), ...(timeouts ? { timeouts } : {}) });
  return createVoiceRoutes({
    service,
    botVoice: async (id) => {
      if (!(id in voices)) throw new BotNotFoundError(`No bot "${id}".`);
      return voices[id];
    },
  });
}

function request(method: string, path: string, init: { json?: unknown; raw?: Uint8Array; contentType?: string; contentLength?: number | null; query?: string; signal?: AbortSignal } = {}): VoiceRouteRequest & { reads: number } {
  const bytes = init.json !== undefined ? new TextEncoder().encode(JSON.stringify(init.json)) : init.raw ?? new Uint8Array();
  const built = {
    reads: 0,
    method,
    path,
    query: new URLSearchParams(init.query ?? ""),
    contentType: init.contentType ?? (init.json !== undefined ? "application/json" : ""),
    contentLength: init.contentLength === null ? undefined : init.contentLength ?? bytes.byteLength,
    body: async (maxBytes: number) => {
      built.reads += 1;
      if (bytes.byteLength > maxBytes) throw new VoiceTooLargeError("The request body is too large.");
      return new Uint8Array(bytes);
    },
    signal: init.signal ?? new AbortController().signal,
  };
  return built;
}

async function multipart(form: FormData): Promise<{ raw: Uint8Array; contentType: string }> {
  const encoded = new Request("http://form.invalid/", { method: "POST", body: form });
  return { raw: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type") ?? "" };
}

async function readAudio(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

function body(result: Awaited<ReturnType<ReturnType<typeof routes>["handle"]>>): { status: number; body: Record<string, unknown> } {
  assert.ok(result && "body" in result, "a JSON answer");
  return result as { status: number; body: Record<string, unknown> };
}

async function connected(timeouts?: { speech?: number; transcription?: number }) {
  const voice = routes(timeouts);
  assert.equal(body(await voice.handle(request("PUT", "/__hui/voice", { json: { url: origin } }))).status, 200);
  await control("reset", {});
  return voice;
}

beforeEach(async () => {
  await control("reset", {});
  await control("key", { key: null });
});

const recording = new Uint8Array(4096).fill(3);

test("connects, reports and forgets VoiceStudio without ever returning its key", async () => {
  await control("key", { key: "route-key" });
  const voice = routes();
  const put = body(await voice.handle(request("PUT", "/__hui/voice", { json: { url: origin, apiKey: "route-key" } })));
  assert.equal(put.status, 200);
  assert.equal(put.body["keySet"], true);
  assert.equal(put.body["reachable"], true);
  const get = body(await voice.handle(request("GET", "/__hui/voice")));
  assert.equal(get.status, 200);
  assert.equal(get.body["configured"], true);
  assert.equal(get.body["url"], origin);
  for (const answer of [put, get]) assert.equal(JSON.stringify(answer).includes("route-key"), false);
  assert.deepEqual(body(await voice.handle(request("DELETE", "/__hui/voice"))), { status: 200, body: { configured: false, url: "", keySet: false } });
  assert.equal(body(await voice.handle(request("POST", "/__hui/voice"))).status, 405);
  assert.equal(await voice.handle(request("GET", "/__hui/voices")), undefined, "not a voice route");
});

test("refuses connection input it cannot use", async () => {
  const voice = routes();
  const put = async (init: Parameters<typeof request>[2]) => body(await voice.handle(request("PUT", "/__hui/voice", init)));
  assert.deepEqual(await put({ raw: new TextEncoder().encode("{oops"), contentType: "application/json" }), { status: 400, body: { error: "The request body must be JSON." } });
  assert.equal((await put({ json: { url: "" } })).status, 400);
  assert.equal((await put({ json: { url: origin, token: "x" } })).body["error"], "Unknown connection field: token.");
  assert.equal((await put({ json: { url: "x".repeat(17_000) } })).status, 413);
  const elsewhere = createServer((_, response) => { response.writeHead(404, { "content-type": "text/plain" }); response.end("nope"); });
  elsewhere.listen(0, "127.0.0.1");
  await once(elsewhere, "listening");
  const address = elsewhere.address();
  assert.ok(address && typeof address !== "string");
  try {
    const wrong = await put({ json: { url: `http://127.0.0.1:${address.port}` } });
    assert.equal(wrong.status, 502);
    assert.match(String(wrong.body["error"]), /no VoiceStudio discovery document/u);
  } finally {
    elsewhere.close();
  }
  assert.equal(body(await voice.handle(request("GET", "/__hui/voice"))).body["configured"], false, "a refused connection is not stored");
});

test("lists VoiceStudio's voices once it is connected", async () => {
  const voice = routes();
  assert.deepEqual(body(await voice.handle(request("GET", "/__hui/voice/voices"))), { status: 409, body: { error: "Connect VoiceStudio in Settings → Integrations first." } });
  await voice.handle(request("PUT", "/__hui/voice", { json: { url: origin } }));
  const listed = body(await voice.handle(request("GET", "/__hui/voice/voices")));
  assert.equal(listed.status, 200);
  const ids = (listed.body["voices"] as { id: string }[]).map((item) => item.id);
  assert.ok(ids.includes("vp-aria") && ids.includes("alloy"));
  assert.equal(body(await voice.handle(request("POST", "/__hui/voice/voices"))).status, 405);
});

test("transcribes a recording sent raw or as a form, storing nothing", async () => {
  const voice = await connected();
  await control("transcripts", { texts: ["Remind me to call Ana.", "¿Qué tiempo hace mañana?"] });
  const raw = body(await voice.handle(request("POST", "/__hui/voice/transcriptions", { raw: recording, contentType: "audio/webm;codecs=opus", query: "language=ES&prompt=Ana" })));
  assert.deepEqual(raw, { status: 200, body: { text: "Remind me to call Ana." } });
  const form = new FormData();
  form.append("file", new Blob([recording], { type: "audio/ogg; codecs=opus" }), "note.ogg");
  form.append("language", "es");
  const encoded = await multipart(form);
  assert.deepEqual(body(await voice.handle(request("POST", "/__hui/voice/transcriptions", encoded))), { status: 200, body: { text: "¿Qué tiempo hace mañana?" } });
  const [first, second] = await fixtureRequests();
  assert.deepEqual(first?.transcription, { model: "whisper-1", language: "es", prompt: "Ana", response_format: "json", filename: "recording.webm", fileType: "audio/webm", fileBytes: 4096, text: "Remind me to call Ana." });
  assert.equal(second?.transcription?.["fileType"], "audio/ogg");
  assert.equal(second?.transcription?.["filename"], "recording.ogg");
  assert.equal(second?.transcription?.["language"], "es");
  // Nothing of the recording stays behind in HUI's directory.
  await assert.rejects(stat(join(dir, "hui", "attachments")), { code: "ENOENT" });
});

test("refuses what is not a usable recording", async () => {
  const voice = await connected();
  const post = async (init: Parameters<typeof request>[2]) => {
    const built = request("POST", "/__hui/voice/transcriptions", init);
    return { ...body(await voice.handle(built)), reads: built.reads };
  };
  assert.equal((await post({ raw: new TextEncoder().encode("hello"), contentType: "text/plain" })).status, 415);
  const textFile = new FormData();
  textFile.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  assert.equal((await post(await multipart(textFile))).status, 415);
  const noFile = new FormData();
  noFile.append("language", "en");
  assert.equal((await post(await multipart(noFile))).body["error"], "The multipart body needs a file part with the recording.");
  const huge = await post({ raw: recording, contentType: "audio/wav", contentLength: 26 * 1024 * 1024 });
  assert.deepEqual([huge.status, huge.reads], [413, 0], "a declared oversize body is refused unread");
  assert.equal((await post({ raw: new Uint8Array(25 * 1024 * 1024 + 1), contentType: "audio/wav", contentLength: null })).status, 413);
  assert.deepEqual((await post({ raw: new Uint8Array(), contentType: "audio/wav" })).body, { error: "The recording is empty." });
  assert.equal((await post({ raw: recording, contentType: "audio/wav", query: "language=english" })).status, 400);
  assert.equal((await post({ raw: recording, contentType: "audio/wav", query: `prompt=${"x".repeat(1001)}` })).status, 400);
  const silent = await post({ raw: new Uint8Array(12), contentType: "audio/wav" });
  assert.deepEqual([silent.status, silent.body["error"]], [502, "VoiceStudio: The uploaded file has no audio stream."]);
  assert.equal(body(await voice.handle(request("GET", "/__hui/voice/transcriptions"))).status, 405);
});

test("speaks with the bot's voice and speed unless the request names its own", async () => {
  const voice = await connected();
  const speak = async (json: unknown) => {
    const result = await voice.handle(request("POST", "/__hui/voice/speech", { json }));
    assert.ok(result && "audio" in result, JSON.stringify(result));
    return { contentType: result.contentType, bytes: await readAudio(result.audio) };
  };
  const bot = await speak({ text: "  Hello there.  ", botId: "scout" });
  assert.equal(bot.contentType, "audio/mpeg");
  assert.deepEqual([...bot.bytes.subarray(0, 2)], [0xff, 0xfb]);
  await speak({ text: "Preview.", botId: "scout", voice: "vp-aria", speed: 0.8 });
  await speak({ text: "Default voice.", botId: "scout", voice: "" });
  await speak({ text: "No bot.", botId: "plain" });
  const opus = await speak({ text: "Opus.", format: "opus" });
  assert.equal(opus.contentType, "audio/ogg");
  assert.deepEqual((await fixtureRequests()).map((item) => [item.speech?.["input"], item.speech?.["voice"], item.speech?.["speed"], item.speech?.["response_format"], item.speech?.["stream_format"]]), [
    ["Hello there.", "vp-bruno", 1.25, "mp3", "audio"],
    ["Preview.", "vp-aria", 0.8, "mp3", "audio"],
    ["Default voice.", "default", 1.25, "mp3", "audio"],
    ["No bot.", "default", 1, "mp3", "audio"],
    ["Opus.", "default", 1, "opus", "audio"],
  ]);
  const longest = await speak({ text: "é".repeat(4000) });
  assert.ok(longest.bytes.length > 0, "4,000 characters is the limit, not past it");
});

test("refuses speech requests it cannot serve", async () => {
  const voice = routes();
  const speak = async (json: unknown) => body(await voice.handle(request("POST", "/__hui/voice/speech", { json })));
  assert.equal((await speak({ text: "Hi" })).status, 409);
  await voice.handle(request("PUT", "/__hui/voice", { json: { url: origin } }));
  assert.deepEqual(await speak({}), { status: 400, body: { error: "text is required." } });
  assert.deepEqual(await speak({ text: "x".repeat(4001) }), { status: 400, body: { error: "text is at most 4,000 characters; speak longer messages in parts." } });
  assert.equal((await speak({ text: "Hi", speed: 3 })).status, 400);
  assert.equal((await speak({ text: "Hi", speed: "1" })).status, 400);
  assert.equal((await speak({ text: "Hi", format: "wav" })).status, 400);
  assert.equal((await speak({ text: "Hi", voice: "a\nb" })).status, 400);
  assert.equal((await speak({ text: "Hi", botId: "../etc" })).status, 400);
  assert.equal((await speak({ text: "Hi", volume: 2 })).body["error"], "Unknown speech field: volume.");
  assert.deepEqual(await speak({ text: "Hi", botId: "ghost" }), { status: 404, body: { error: 'No bot "ghost".' } });
  assert.deepEqual(await speak({ text: "Hi", voice: "ghost" }), { status: 502, body: { error: "VoiceStudio: Voice 'ghost' was not found." } });
  assert.equal(body(await voice.handle(request("GET", "/__hui/voice/speech"))).status, 405);
});

test("answers 504 when VoiceStudio takes longer than the gateway waits, and 499 when the client leaves", async () => {
  const voice = await connected({ speech: 200, transcription: 200 });
  await control("delay", { path: "/v1/audio/speech", ms: 3000 });
  assert.deepEqual(body(await voice.handle(request("POST", "/__hui/voice/speech", { json: { text: "Too slow." } }))), { status: 504, body: { error: "VoiceStudio did not answer within 0.2 s." } });
  await control("delay", { path: "/v1/audio/transcriptions", ms: 3000 });
  assert.equal(body(await voice.handle(request("POST", "/__hui/voice/transcriptions", { raw: recording, contentType: "audio/wav" }))).status, 504);
  const leaving = new AbortController();
  await control("delay", { path: "/v1/audio/speech", ms: 3000 });
  const pending = voice.handle(request("POST", "/__hui/voice/speech", { json: { text: "Never mind." }, signal: leaving.signal }));
  leaving.abort();
  assert.equal(body(await pending).status, 499);
});

/* ── the gateway boundary: hui.ts, over HTTP ── */

let gateway = "";
let server: Server | undefined;
let stopBackend: (() => void) | undefined;

before(async () => {
  const hui = await import("./hui.ts");
  stopBackend = hui.stopBackend;
  server = createServer((incoming, response) => hui.middleware(incoming as never, response, () => { response.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  gateway = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  stopBackend?.();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  const exit = once(fixture, "exit");
  fixture.kill();
  await exit;
  await rm(dir, { recursive: true, force: true });
});

test("the gateway serves the voice routes behind x-hui, reads raw audio and relays speech as it streams", async () => {
  const hui = { "x-hui": "1" };
  assert.equal((await fetch(`${gateway}/__hui/voice`)).status, 403);
  assert.deepEqual(await (await fetch(`${gateway}/__hui/voice`, { headers: hui })).json(), { configured: false, url: "", keySet: false });
  const put = await fetch(`${gateway}/__hui/voice`, { method: "PUT", headers: { ...hui, "content-type": "application/json" }, body: JSON.stringify({ url: origin }) });
  assert.equal(put.status, 200);
  assert.equal((await stat(join(dir, "hui", "voicestudio.json"))).mode & 0o777, 0o600);

  await control("transcripts", { texts: ["Through the gateway."] });
  const transcription = await fetch(`${gateway}/__hui/voice/transcriptions?language=en`, { method: "POST", headers: { ...hui, "content-type": "audio/webm" }, body: recording });
  assert.deepEqual([transcription.status, await transcription.json()], [200, { text: "Through the gateway." }]);

  const speech = await fetch(`${gateway}/__hui/voice/speech`, { method: "POST", headers: { ...hui, "content-type": "application/json" }, body: JSON.stringify({ text: "Streaming through HUI, one chunk after another." }) });
  assert.equal(speech.status, 200);
  assert.equal(speech.headers.get("content-type"), "audio/mpeg");
  assert.equal(speech.headers.get("transfer-encoding"), "chunked");
  assert.equal(speech.headers.get("content-length"), null);
  assert.equal(speech.headers.get("cache-control"), "no-store");
  assert.equal(speech.headers.get("x-content-type-options"), "nosniff");
  const audio = Buffer.from(await speech.arrayBuffer());
  const relayed = (await fixtureRequests()).find((item) => item.speech)?.speech;
  assert.equal(audio.length, relayed?.["bytes"]);
  // A bot that does not exist is the registry's 404, through the real bot service.
  const ghost = await fetch(`${gateway}/__hui/voice/speech`, { method: "POST", headers: { ...hui, "content-type": "application/json" }, body: JSON.stringify({ text: "Hi", botId: "ghost" }) });
  assert.equal(ghost.status, 404);
  const tooBig = await fetch(`${gateway}/__hui/voice/transcriptions`, { method: "POST", headers: { ...hui, "content-type": "audio/wav" }, body: new Uint8Array(25 * 1024 * 1024 + 10) });
  assert.equal(tooBig.status, 413);
  assert.equal((await fetch(`${gateway}/__hui/voice/elsewhere`, { headers: hui })).status, 404);
  const removed = await fetch(`${gateway}/__hui/voice`, { method: "DELETE", headers: hui });
  assert.deepEqual(await removed.json(), { configured: false, url: "", keySet: false });
  await assert.rejects(stat(join(dir, "hui", "voicestudio.json")), { code: "ENOENT" });
});
