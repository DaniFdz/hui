/**
 * `/__hui/voice` routes (HUI-18): the VoiceStudio connection and the speech
 * HUI relays for bots; see docs/api.md#voicestudio-bots-voice. No audio is stored: a recording
 * streams to VoiceStudio and its text comes back, speech streams back as
 * VoiceStudio sends it.
 *
 *   GET    /__hui/voice                 the connection (never the key) and whether VoiceStudio answers
 *   PUT    /__hui/voice                 { url, apiKey? } verified, then stored
 *   DELETE /__hui/voice                 forget the connection and its key
 *   GET    /__hui/voice/voices          { voices } from VoiceStudio
 *   POST   /__hui/voice/transcriptions  raw audio (its content type) or multipart → { text }
 *   POST   /__hui/voice/speech          { text, botId?, voice?, speed?, format? } → audio bytes
 */
import { SPEECH_FORMATS, VOICE_LIMITS, voiceProfileId, voiceSpeed, type BotVoice, type SpeechFormat, type VoiceConnection, type VoiceProfile } from "../shared/voice.ts";
import { BotNotFoundError } from "./bots.ts";
import { VoiceInputError, VoiceNotConfiguredError, VoiceRequestError } from "./voice.ts";

export const VOICE_ROUTE = "/__hui/voice";
const ROUTE = /^\/__hui\/voice(?:\/(voices|transcriptions|speech))?$/u;
const CONNECTION_BODY_BYTES = 16 * 1024;
/** 4,000 characters of up to four bytes each, plus the other fields. */
const SPEECH_BODY_BYTES = 64 * 1024;
const LANGUAGE = /^[a-z]{2,3}$/u;
const BOT_ID = /^[A-Za-z0-9_-]{1,100}$/u;

/** The body is larger than the route accepts (413). */
export class VoiceTooLargeError extends Error {
  override name = "VoiceTooLargeError";
}

/** The body is not audio (415). */
export class VoiceMediaTypeError extends Error {
  override name = "VoiceMediaTypeError";
}

export type VoiceRouteRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  /** The request's `content-type` header, as sent. */
  contentType: string;
  contentLength: number | undefined;
  /** The raw body, at most `maxBytes`; rejects with `VoiceTooLargeError` beyond. */
  body(maxBytes: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Aborts when the client goes away, which ends what HUI asked VoiceStudio for it. */
  signal: AbortSignal;
};

export type VoiceRouteResult =
  | { status: number; body: unknown }
  | { status: number; contentType: string; audio: ReadableStream<Uint8Array> };

/** What the routes need of `VoiceService`. */
export type VoiceRouteService = {
  connection(): Promise<VoiceConnection>;
  connect(body: unknown): Promise<VoiceConnection>;
  disconnect(): Promise<VoiceConnection>;
  voices(): Promise<VoiceProfile[]>;
  transcribe(audio: { data: Uint8Array<ArrayBuffer>; contentType: string; filename: string }, options: { language?: string | undefined; prompt?: string | undefined }, signal?: AbortSignal): Promise<string>;
  speech(request: { input: string; voice: string; speed: number; format: SpeechFormat }, signal?: AbortSignal): Promise<{ contentType: string; audio: ReadableStream<Uint8Array> }>;
};

type Deps = {
  service: VoiceRouteService;
  /** A bot's voice by id or handle; rejects with `BotNotFoundError` for an unknown bot. */
  botVoice(botId: string): Promise<BotVoice | undefined>;
};

/** 400 input, 404 unknown bot, 409 not connected, 413/415 for the audio, 502/504 for VoiceStudio. */
export function voiceErrorStatus(error: unknown): number {
  if (error instanceof VoiceInputError || error instanceof SyntaxError) return 400;
  if (error instanceof BotNotFoundError) return 404;
  if (error instanceof VoiceNotConfiguredError) return 409;
  if (error instanceof VoiceTooLargeError) return 413;
  if (error instanceof VoiceMediaTypeError) return 415;
  if (error instanceof VoiceRequestError) return error.timeout ? 504 : 502;
  return 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** `audio/webm;codecs=opus` → `audio/webm`. */
function mediaType(value: string): string {
  return value.split(";")[0]!.trim().toLowerCase();
}

/** A file name VoiceStudio (and ffmpeg behind it) can read the format from. */
export function audioFileName(type: string): string {
  const subtype = type.slice("audio/".length);
  const extension = ({ mpeg: "mp3", mp3: "mp3", "x-wav": "wav", wave: "wav", wav: "wav", "x-m4a": "m4a", mp4: "m4a", m4a: "m4a", webm: "webm", ogg: "ogg", opus: "opus", flac: "flac", "x-flac": "flac", aac: "aac" } as Record<string, string>)[subtype];
  return `recording.${extension ?? "audio"}`;
}

function transcriptionOptions(language: string | undefined, prompt: string | undefined): { language?: string; prompt?: string } {
  const options: { language?: string; prompt?: string } = {};
  if (language) {
    const code = language.trim().toLowerCase();
    if (!LANGUAGE.test(code)) throw new VoiceInputError("language is an ISO 639-1 code such as en or es.");
    options.language = code;
  }
  if (prompt?.trim()) {
    if (prompt.length > VOICE_LIMITS.prompt) throw new VoiceInputError(`prompt is at most ${VOICE_LIMITS.prompt} characters.`);
    options.prompt = prompt.trim();
  }
  return options;
}

type SpeechInput = { text: string; botId?: string; voice?: string; speed?: number; format: SpeechFormat };

function speechInput(body: unknown): SpeechInput {
  if (!isRecord(body)) throw new VoiceInputError("A speech request is an object with text.");
  const unknown = Object.keys(body).filter((key) => !["text", "botId", "voice", "speed", "format"].includes(key));
  if (unknown.length) throw new VoiceInputError(`Unknown speech field: ${unknown.join(", ")}.`);
  const text = typeof body["text"] === "string" ? body["text"].trim() : "";
  if (!text) throw new VoiceInputError("text is required.");
  if ([...text].length > VOICE_LIMITS.speechText) throw new VoiceInputError(`text is at most ${VOICE_LIMITS.speechText.toLocaleString("en-US")} characters; speak longer messages in parts.`);
  const input: SpeechInput = { text, format: "mp3" };
  if (body["botId"] !== undefined) {
    if (typeof body["botId"] !== "string" || !BOT_ID.test(body["botId"])) throw new VoiceInputError("botId is a bot's id or handle.");
    input.botId = body["botId"];
  }
  if (body["voice"] !== undefined) {
    // "" asks for VoiceStudio's default voice even when the bot has one.
    const voice = body["voice"] === "" ? "" : voiceProfileId(body["voice"]);
    if (voice === undefined) throw new VoiceInputError(`voice is a VoiceStudio voice id of at most ${VOICE_LIMITS.profile} characters.`);
    input.voice = voice;
  }
  if (body["speed"] !== undefined) {
    const speed = voiceSpeed(body["speed"]);
    if (speed === undefined) throw new VoiceInputError(`speed is a number from ${VOICE_LIMITS.speedMin} to ${VOICE_LIMITS.speedMax}.`);
    input.speed = speed;
  }
  if (body["format"] !== undefined) {
    if (!SPEECH_FORMATS.includes(body["format"] as SpeechFormat)) throw new VoiceInputError(`format is one of ${SPEECH_FORMATS.join(", ")}.`);
    input.format = body["format"] as SpeechFormat;
  }
  return input;
}

export function createVoiceRoutes(deps: Deps) {
  const { service } = deps;

  async function json(request: VoiceRouteRequest, maxBytes: number): Promise<unknown> {
    const bytes = await request.body(maxBytes);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new VoiceInputError("The request body must be JSON.");
    }
  }

  /** A recording as the browser sent it (audio/*), or a multipart form's `file` part. */
  async function transcribe(request: VoiceRouteRequest): Promise<string> {
    const type = mediaType(request.contentType);
    const tooLarge = `A recording is at most ${VOICE_LIMITS.audioBytes / 1024 / 1024} MB.`;
    if (request.contentLength !== undefined && request.contentLength > VOICE_LIMITS.audioBytes) throw new VoiceTooLargeError(tooLarge);
    let audio: { data: Uint8Array<ArrayBuffer>; contentType: string; filename: string };
    let options: { language?: string; prompt?: string };
    if (type.startsWith("audio/")) {
      audio = { data: await request.body(VOICE_LIMITS.audioBytes), contentType: type, filename: audioFileName(type) };
      options = transcriptionOptions(request.query.get("language") ?? undefined, request.query.get("prompt") ?? undefined);
    } else if (type === "multipart/form-data") {
      const raw = await request.body(VOICE_LIMITS.audioBytes);
      let form: FormData;
      try {
        form = await new Response(raw, { headers: { "content-type": request.contentType } }).formData();
      } catch {
        throw new VoiceInputError("The multipart body could not be read.");
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new VoiceInputError("The multipart body needs a file part with the recording.");
      const fileType = mediaType(file.type);
      if (!fileType.startsWith("audio/")) throw new VoiceMediaTypeError(`The file part is ${fileType || "untyped"}, not audio.`);
      audio = { data: new Uint8Array(await file.arrayBuffer()), contentType: fileType, filename: audioFileName(fileType) };
      const field = (name: string) => {
        const value = form.get(name) ?? request.query.get(name);
        return typeof value === "string" ? value : undefined;
      };
      options = transcriptionOptions(field("language"), field("prompt"));
    } else {
      throw new VoiceMediaTypeError("Send the recording as audio (audio/webm, audio/ogg, audio/wav, audio/mpeg, audio/mp4…) or as multipart/form-data with a file part.");
    }
    if (!audio.data.byteLength) throw new VoiceInputError("The recording is empty.");
    return service.transcribe(audio, options, request.signal);
  }

  /** The bot's voice and speed unless the request names its own (a preview). */
  async function speech(request: VoiceRouteRequest): Promise<VoiceRouteResult> {
    const input = speechInput(await json(request, SPEECH_BODY_BYTES));
    const bot = input.botId ? await deps.botVoice(input.botId) : undefined;
    const voice = input.voice ?? bot?.profile ?? "";
    const speed = input.speed ?? bot?.speed ?? 1;
    const { contentType, audio } = await service.speech({ input: input.text, voice: voice || "default", speed, format: input.format }, request.signal);
    return { status: 200, contentType, audio };
  }

  async function handle(request: VoiceRouteRequest): Promise<VoiceRouteResult | undefined> {
    const match = ROUTE.exec(request.path);
    if (!match) return undefined;
    const action = match[1];
    const { method } = request;
    const notAllowed = { status: 405, body: { error: "method not allowed" } };
    try {
      if (!action) {
        if (method === "GET") return { status: 200, body: await service.connection() };
        if (method === "PUT") return { status: 200, body: await service.connect(await json(request, CONNECTION_BODY_BYTES)) };
        if (method === "DELETE") return { status: 200, body: await service.disconnect() };
        return notAllowed;
      }
      if (action === "voices") return method === "GET" ? { status: 200, body: { voices: await service.voices() } } : notAllowed;
      if (method !== "POST") return notAllowed;
      if (action === "transcriptions") return { status: 200, body: { text: await transcribe(request) } };
      return await speech(request);
    } catch (error) {
      // Nobody reads the answer of a client that left; 499 keeps it out of the failures.
      if (request.signal.aborted) return { status: 499, body: { error: "The client closed the request." } };
      return { status: voiceErrorStatus(error), body: { error: error instanceof Error && error.message ? error.message : "The voice request failed." } };
    }
  }

  return { handle };
}
