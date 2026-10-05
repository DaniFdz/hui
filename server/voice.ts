/**
 * VoiceStudio (https://github.com/debpalash/VoiceStudio, AGPL-3.0) is the
 * speech backend of bots' voice notes, read-aloud and calls (HUI-18). HUI only
 * calls it over HTTP — its discovery document and its OpenAI-compatible audio
 * routes — and copies none of its code.
 *
 * HUI owns one connection in `CONFIG_DIR/voicestudio.json` (mode 0600): the
 * service root and an optional API key (VoiceStudio's OMNIVOICE_API_KEY, which
 * remote clients present as a bearer). The key is write-only: it never crosses
 * a `/__hui/` response, is sent only to the configured origin with redirects
 * elsewhere refused, and only over HTTPS, to this machine or to a Tailscale
 * address. Audio passes through: HUI stores no recording and no speech.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIPv4, isIPv6 } from "node:net";
import { dirname, join } from "node:path";

import { VOICE_PROTOCOL, type SpeechFormat, type VoiceConnection, type VoiceProfile } from "../shared/voice.ts";
import { CONFIG_DIR } from "./paths.ts";

export const VOICE_CONFIG_FILE = join(CONFIG_DIR, "voicestudio.json");

export type VoiceConfig = { url: string; apiKey?: string };

/** The caller's input is wrong (400). */
export class VoiceInputError extends Error {
  override name = "VoiceInputError";
}

/** Nothing is connected yet (409). */
export class VoiceNotConfiguredError extends Error {
  override name = "VoiceNotConfiguredError";
  constructor() {
    super("Connect VoiceStudio in Settings → Integrations first.");
  }
}

/** VoiceStudio refused, failed or could not be reached (502), or did not answer in time (504). */
export class VoiceRequestError extends Error {
  override name = "VoiceRequestError";
  /** VoiceStudio's HTTP status, when it answered. */
  readonly status: number | undefined;
  readonly timeout: boolean;
  constructor(message: string, options: { status?: number; timeout?: boolean } = {}) {
    super(message);
    this.status = options.status;
    this.timeout = options.timeout ?? false;
  }
}

/** Speech for 4,000 characters is a few megabytes of MP3; far more is not speech. */
const MAX_SPEECH_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_VOICES = 500;
/** A path the discovery document names, relative to the service root. */
const RELATIVE_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,200}$/u;

export type VoiceTimeouts = {
  /** Discovery while `GET /__hui/voice` reports whether VoiceStudio is reachable. */
  probe: number;
  /** Verifying a connection, the model list and voices. */
  request: number;
  /** One transcription: VoiceStudio may load its recognizer first. */
  transcription: number;
  /** Until speech starts arriving: VoiceStudio synthesizes a whole clip before it streams it. */
  speech: number;
  /** Between two chunks of streamed speech. */
  idle: number;
};

export const VOICE_TIMEOUTS: VoiceTimeouts = { probe: 5_000, request: 10_000, transcription: 120_000, speech: 120_000, idle: 30_000 };

export const KEY_TRANSPORT_MESSAGE = "HUI sends the API key only over HTTPS, to this machine or to a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48, *.ts.net). Use https:// (Tailscale Serve, say) or VoiceStudio's Tailscale address, or leave the key empty for a backend that trusts this network.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneLine(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

/* ── configuration ─────────────────────────────────────────────────────── */

/**
 * The service root: `127.0.0.1:3900`, `http://gpu-box:3900` or
 * `https://gpu.tailnet.ts.net/voicestudio`. Without a scheme it is HTTP, as
 * VoiceStudio serves by default. A pasted OpenAI base URL loses its `/v1`:
 * discovery lives at the root. Credentials, queries and fragments are refused.
 */
export function normalizeVoiceUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new VoiceInputError("Enter VoiceStudio's address, for example http://127.0.0.1:3900.");
  if (raw.length > 500) throw new VoiceInputError("That VoiceStudio address is too long.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new VoiceInputError("That VoiceStudio address is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new VoiceInputError("VoiceStudio's address starts with http:// or https://.");
  if (url.username || url.password) throw new VoiceInputError("Put the API key in its own field, not in the address.");
  if (url.search || url.hash) throw new VoiceInputError("VoiceStudio's address is its service root, without ? or #.");
  const path = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  return `${url.origin}${path}`;
}

/** Where a bearer key cannot be read off the wire: HTTPS, this machine, or a Tailscale address (WireGuard). */
export function keyTransportAllowed(root: string): boolean {
  const url = new URL(root);
  if (url.protocol === "https:") return true;
  const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".ts.net")) return true;
  if (isIPv4(host)) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return a === 127 || (a === 100 && b >= 64 && b <= 127);
  }
  return isIPv6(host) && (host === "::1" || host.startsWith("fd7a:115c:a1e0:"));
}

function apiKeyFrom(value: string): string {
  const key = value.trim();
  if (key.length > 1_000) throw new VoiceInputError("That API key is too long.");
  if (/[\s\p{Cc}]/u.test(key)) throw new VoiceInputError("An API key has no spaces or line breaks.");
  return key;
}

function parseConfig(raw: unknown): VoiceConfig | undefined {
  if (!isRecord(raw)) return undefined;
  try {
    const url = normalizeVoiceUrl(raw["url"]);
    const apiKey = typeof raw["apiKey"] === "string" ? apiKeyFrom(raw["apiKey"]) : "";
    return apiKey ? { url, apiKey } : { url };
  } catch {
    return undefined;
  }
}

export class VoiceConfigStore {
  readonly path: string;
  constructor(path = VOICE_CONFIG_FILE) {
    this.path = path;
  }

  async read(): Promise<VoiceConfig | undefined> {
    try {
      return parseConfig(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  async write(config: VoiceConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }

  async remove(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export type VoiceDiscovery = {
  protocol: string;
  service?: string;
  version?: string;
  features: Record<string, boolean>;
  /** The batch transcription route the document names, relative to the root. */
  transcriptionPath?: string;
};

/** The latest reachability check. */
export type VoiceProbe = { at: number; ok: true; discovery: VoiceDiscovery } | { at: number; ok: false; error: string };

export function voiceConnectionView(config: VoiceConfig | undefined, probe?: VoiceProbe): VoiceConnection {
  if (!config) return { configured: false, url: "", keySet: false };
  const view: VoiceConnection = { configured: true, url: config.url, keySet: Boolean(config.apiKey) };
  if (!probe) return view;
  view.reachable = probe.ok;
  view.checkedAt = new Date(probe.at).toISOString();
  if (probe.ok) {
    view.protocol = probe.discovery.protocol;
    if (probe.discovery.service) view.service = probe.discovery.service;
    if (probe.discovery.version) view.version = probe.discovery.version;
    view.features = probe.discovery.features;
  } else {
    view.error = probe.error;
  }
  return view;
}

/* ── responses ─────────────────────────────────────────────────────────── */

/** OpenAI's `{ error: { message } }` or FastAPI's `{ detail }`, which VoiceStudio's middleware uses. */
function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) return "";
    const error = parsed["error"];
    const message = isRecord(error) ? error["message"] : typeof error === "string" ? error : parsed["detail"];
    return oneLine(message, 300);
  } catch {
    return "";
  }
}

export function voiceErrorMessage(status: number, body: string, keySet: boolean): string {
  const detail = errorDetail(body);
  if (status === 401 || status === 403) {
    if (/\bpin required\b/iu.test(detail)) return "VoiceStudio's share PIN is on. HUI connects with VoiceStudio's API key (OMNIVOICE_API_KEY) or from one of its trusted networks instead.";
    if (status === 401) return keySet ? "VoiceStudio rejected the API key." : "VoiceStudio asks remote clients for its API key (OMNIVOICE_API_KEY). Add it to the connection.";
    return detail ? `VoiceStudio refused: ${detail}` : "VoiceStudio refused the request.";
  }
  if (detail) return `VoiceStudio: ${detail}`;
  if (status === 404) return "VoiceStudio has no such route. Check that the address is its service root, as in http://127.0.0.1:3900.";
  if (status === 413) return "VoiceStudio refused the audio as too large.";
  if (status === 429) return "VoiceStudio is busy (rate limited). Try again shortly.";
  return status >= 500 ? `VoiceStudio failed (HTTP ${status}).` : `VoiceStudio answered HTTP ${status}.`;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new VoiceRequestError("VoiceStudio returned more data than HUI accepts.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

function networkDetail(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  if (code === "ECONNREFUSED") return " (connection refused; is it running?)";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return " (unknown host)";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return " (the connection was reset)";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return " (the connection timed out)";
  if (/CERT|SSL|TLS/u.test(code)) return " (its TLS certificate was not accepted)";
  return "";
}

export function parseDiscovery(raw: unknown): VoiceDiscovery {
  const source = isRecord(raw) ? raw : {};
  if (source["protocol"] !== VOICE_PROTOCOL) {
    throw new VoiceRequestError(`That address answers, but not as VoiceStudio's speech platform (no ${VOICE_PROTOCOL} discovery document).`);
  }
  const features = isRecord(source["features"])
    ? Object.fromEntries(Object.entries(source["features"]).filter(([name, on]) => typeof on === "boolean" && /^[a-z0-9_]{1,64}$/u.test(name)).slice(0, 40)) as Record<string, boolean>
    : {};
  const endpoints = isRecord(source["endpoints"]) ? source["endpoints"] : {};
  const batch = isRecord(endpoints["batch_transcription"]) ? endpoints["batch_transcription"]["path"] : undefined;
  const service = oneLine(source["service"], 60);
  const version = oneLine(source["service_version"], 40);
  return {
    protocol: VOICE_PROTOCOL,
    ...(service ? { service } : {}),
    ...(version ? { version } : {}),
    features,
    ...(typeof batch === "string" && RELATIVE_PATH.test(batch) ? { transcriptionPath: batch } : {}),
  };
}

/** VoiceStudio's `voices` list (`voice_id`, name, type, language): bounded, one entry per id. */
export function parseVoices(items: readonly unknown[]): VoiceProfile[] {
  const voices: VoiceProfile[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || voices.length >= MAX_VOICES) continue;
    const id = oneLine(item["voice_id"] ?? item["id"], 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = oneLine(item["type"], 40);
    const language = oneLine(item["language"], 20);
    const description = oneLine(item["description"], 300);
    voices.push({
      id,
      name: oneLine(item["name"], 120) || id,
      ...(type ? { type } : {}),
      ...(language ? { language } : {}),
      ...(description ? { description } : {}),
    });
  }
  return voices;
}

/* ── client ────────────────────────────────────────────────────────────── */

export type VoiceFetch = (url: string, init: RequestInit) => Promise<Response>;

/** One request's abort: a deadline that can be re-armed (an idle timeout) or disarmed. */
class Deadline {
  readonly signal: AbortSignal;
  expired = false;
  readonly #controller = new AbortController();
  #ms = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(ms: number, caller?: AbortSignal) {
    this.signal = caller ? AbortSignal.any([this.#controller.signal, caller]) : this.#controller.signal;
    this.restart(ms);
  }

  /** The wait that is (or was last) armed. */
  get ms(): number {
    return this.#ms;
  }

  restart(ms: number): void {
    this.#ms = ms;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.expired = true;
      this.#controller.abort(new DOMException("VoiceStudio did not answer in time.", "TimeoutError"));
    }, ms);
  }

  clear(): void {
    clearTimeout(this.#timer);
  }
}

type ExchangeInit = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Repeatable bodies only: a same-origin 307/308 sends it again. */
  body?: string | FormData;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
};

export class VoiceStudioClient {
  readonly #root: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: VoiceFetch;
  readonly #timeouts: VoiceTimeouts;

  constructor(config: VoiceConfig, options: { fetch?: VoiceFetch; timeouts?: Partial<VoiceTimeouts> } = {}) {
    this.#root = config.url;
    this.#apiKey = config.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeouts = { ...VOICE_TIMEOUTS, ...options.timeouts };
  }

  /** A timeout, the caller leaving, or the network: what went wrong, in words. */
  #failure(error: unknown, deadline: Deadline, caller: AbortSignal | undefined): unknown {
    if (error instanceof VoiceRequestError) return error;
    if (caller?.aborted) return caller.reason ?? error;
    if (deadline.expired) return new VoiceRequestError(`VoiceStudio did not answer within ${(deadline.ms / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s.`, { timeout: true });
    return new VoiceRequestError(`VoiceStudio could not be reached at ${this.#root}${networkDetail(error)}.`);
  }

  /** Sends one request to the configured origin and follows only same-origin redirects. */
  async #exchange(path: string, init: ExchangeInit): Promise<{ response: Response; deadline: Deadline }> {
    let url = new URL(`${this.#root}${path}`);
    const origin = url.origin;
    const method = init.method ?? "GET";
    const deadline = new Deadline(init.timeoutMs, init.signal);
    try {
      for (let hop = 0; ; hop += 1) {
        if (url.origin !== origin) throw new VoiceRequestError("Refusing to send VoiceStudio's key to another origin.");
        const response = await this.#fetch(url.toString(), {
          method,
          redirect: "manual",
          signal: deadline.signal,
          headers: {
            accept: "application/json",
            ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
            ...init.headers,
          },
          ...(init.body === undefined ? {} : { body: init.body }),
        });
        if (response.status < 300 || response.status >= 400 || response.status === 304) return { response, deadline };
        await response.body?.cancel().catch(() => undefined);
        let next: URL | undefined;
        try {
          next = new URL(response.headers.get("location") ?? "", url);
        } catch {
          next = undefined;
        }
        if (!next || !response.headers.get("location") || next.origin !== origin) {
          throw new VoiceRequestError(`VoiceStudio redirected to ${next && response.headers.get("location") ? next.origin : "an unusable address"}; HUI sends nothing to another origin.`, { status: response.status });
        }
        if (hop >= MAX_REDIRECTS) throw new VoiceRequestError("VoiceStudio redirected too many times.", { status: response.status });
        if (method !== "GET" && response.status !== 307 && response.status !== 308) {
          throw new VoiceRequestError(`VoiceStudio answered ${path} with a redirect HUI cannot repeat.`, { status: response.status });
        }
        url = next;
      }
    } catch (error) {
      deadline.clear();
      throw this.#failure(error, deadline, init.signal);
    }
  }

  async #json<T>(path: string, init: ExchangeInit): Promise<T> {
    const { response, deadline } = await this.#exchange(path, init);
    try {
      const text = await readBounded(response, MAX_JSON_BYTES);
      if (!response.ok) throw new VoiceRequestError(voiceErrorMessage(response.status, text, Boolean(this.#apiKey)), { status: response.status });
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new VoiceRequestError("VoiceStudio returned a response HUI could not read.");
      }
    } catch (error) {
      throw this.#failure(error, deadline, init.signal);
    } finally {
      deadline.clear();
    }
  }

  /** `GET /.well-known/voicestudio-speech`: proves the address is VoiceStudio's speech platform. */
  async discover(timeoutMs = this.#timeouts.request): Promise<VoiceDiscovery> {
    try {
      return parseDiscovery(await this.#json<unknown>("/.well-known/voicestudio-speech", { timeoutMs }));
    } catch (error) {
      if (error instanceof VoiceRequestError && error.status === 404) {
        throw new VoiceRequestError("That address has no VoiceStudio discovery document (/.well-known/voicestudio-speech). Use VoiceStudio's service root, as in http://127.0.0.1:3900.", { status: 404 });
      }
      throw error;
    }
  }

  /** `GET /v1/models` (OpenAI's list): the speech engines and the active recognizer. */
  async models(): Promise<{ speech: string[]; transcription: string[] }> {
    const raw = await this.#json<unknown>("/v1/models", { timeoutMs: this.#timeouts.request });
    const data = isRecord(raw) ? raw["data"] : undefined;
    if (!Array.isArray(data)) throw new VoiceRequestError("VoiceStudio's model list is not in OpenAI's shape.");
    const models = { speech: [] as string[], transcription: [] as string[] };
    for (const item of data) {
      if (!isRecord(item) || typeof item["id"] !== "string") continue;
      const kind = isRecord(item["voicestudio"]) ? item["voicestudio"]["kind"] : undefined;
      if (kind === "stt") models.transcription.push(item["id"]);
      else models.speech.push(item["id"]);
    }
    return models;
  }

  /** `GET /v1/audio/voices` (VoiceStudio's extension). */
  async voices(): Promise<VoiceProfile[]> {
    const raw = await this.#json<unknown>("/v1/audio/voices", { timeoutMs: this.#timeouts.request });
    const voices = isRecord(raw) ? raw["voices"] : undefined;
    if (!Array.isArray(voices)) throw new VoiceRequestError("VoiceStudio's voice list could not be read.");
    return parseVoices(voices);
  }

  /** `POST /v1/audio/transcriptions`: any OpenAI model id makes VoiceStudio use its active recognizer. */
  async transcribe(
    audio: { data: Uint8Array<ArrayBuffer>; contentType: string; filename: string },
    options: { language?: string | undefined; prompt?: string | undefined; path?: string | undefined } = {},
    signal?: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([audio.data], { type: audio.contentType }), audio.filename);
    form.append("model", "whisper-1");
    form.append("response_format", "json");
    if (options.language) form.append("language", options.language);
    if (options.prompt) form.append("prompt", options.prompt);
    const path = options.path && RELATIVE_PATH.test(options.path) ? options.path : "/v1/audio/transcriptions";
    const raw = await this.#json<unknown>(path, { method: "POST", body: form, timeoutMs: this.#timeouts.transcription, signal });
    const text = isRecord(raw) ? raw["text"] : undefined;
    if (typeof text !== "string") throw new VoiceRequestError("VoiceStudio's transcription had no text.");
    return text.trim();
  }

  /**
   * `POST /v1/audio/speech` with `stream_format: "audio"`: the audio bytes as they
   * arrive, with VoiceStudio's content type. Until the first byte the speech
   * timeout applies, then an idle timeout between chunks and a size cap.
   */
  async speech(
    request: { input: string; voice: string; speed: number; format: SpeechFormat },
    signal?: AbortSignal,
  ): Promise<{ contentType: string; audio: ReadableStream<Uint8Array> }> {
    const { response, deadline } = await this.#exchange("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/*, application/json" },
      body: JSON.stringify({
        model: "tts-1",
        input: request.input,
        voice: request.voice,
        speed: request.speed,
        response_format: request.format,
        stream_format: "audio",
      }),
      timeoutMs: this.#timeouts.speech,
      signal,
    });
    let contentType = "";
    try {
      if (!response.ok) {
        throw new VoiceRequestError(voiceErrorMessage(response.status, await readBounded(response, MAX_JSON_BYTES), Boolean(this.#apiKey)), { status: response.status });
      }
      contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!/^audio\/[a-z0-9.+-]{1,60}$/u.test(contentType) || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new VoiceRequestError(`VoiceStudio answered with ${contentType || "no content type"} instead of audio.`);
      }
    } catch (error) {
      deadline.clear();
      throw this.#failure(error, deadline, signal);
    }
    deadline.restart(this.#timeouts.idle);
    const reader = response.body.getReader();
    let size = 0;
    const audio = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            deadline.clear();
            controller.close();
            return;
          }
          size += value.byteLength;
          if (size > MAX_SPEECH_BYTES) {
            deadline.clear();
            await reader.cancel().catch(() => undefined);
            controller.error(new VoiceRequestError("VoiceStudio sent more audio than HUI relays."));
            return;
          }
          deadline.restart(this.#timeouts.idle);
          controller.enqueue(value);
        } catch (error) {
          deadline.clear();
          controller.error(this.#failure(error, deadline, signal));
        }
      },
      cancel: async (reason) => {
        deadline.clear();
        await reader.cancel(reason).catch(() => undefined);
      },
    });
    return { contentType, audio };
  }
}

/* ── service ───────────────────────────────────────────────────────────── */

export type VoiceServiceOptions = {
  store?: VoiceConfigStore;
  fetch?: VoiceFetch;
  timeouts?: Partial<VoiceTimeouts>;
  now?: () => number;
  /** How long a reachability probe answers `GET /__hui/voice`. */
  probeTtlMs?: number;
};

type ConnectionInput = { url: string; apiKey: string | null | undefined };

function connectionInput(body: unknown): ConnectionInput {
  if (!isRecord(body)) throw new VoiceInputError("The connection is an object with url and apiKey.");
  const unknown = Object.keys(body).filter((key) => key !== "url" && key !== "apiKey");
  if (unknown.length) throw new VoiceInputError(`Unknown connection field: ${unknown.join(", ")}.`);
  const url = normalizeVoiceUrl(body["url"]);
  const raw = body["apiKey"];
  if (raw !== undefined && raw !== null && typeof raw !== "string") throw new VoiceInputError("apiKey is text, or null to remove the key.");
  return { url, apiKey: raw === null ? null : typeof raw === "string" && raw.trim() ? apiKeyFrom(raw) : undefined };
}

/** The gateway's one VoiceStudio connection: storage, verification, a reachability cache and the calls. */
export class VoiceService {
  readonly #store: VoiceConfigStore;
  readonly #fetch: VoiceFetch | undefined;
  readonly #timeouts: VoiceTimeouts;
  readonly #now: () => number;
  readonly #probeTtlMs: number;
  readonly #ready: Promise<void>;
  #config: VoiceConfig | undefined;
  /** Bumped by every connect and disconnect: an older probe never lands on a newer connection. */
  #generation = 0;
  #probe: VoiceProbe | undefined;
  #probing: Promise<void> | undefined;

  constructor(options: VoiceServiceOptions = {}) {
    this.#store = options.store ?? new VoiceConfigStore();
    this.#fetch = options.fetch;
    this.#timeouts = { ...VOICE_TIMEOUTS, ...options.timeouts };
    this.#now = options.now ?? Date.now;
    this.#probeTtlMs = options.probeTtlMs ?? 30_000;
    this.#ready = this.#store.read().then((config) => { this.#config = config; });
  }

  #client(config: VoiceConfig): VoiceStudioClient {
    return new VoiceStudioClient(config, { ...(this.#fetch ? { fetch: this.#fetch } : {}), timeouts: this.#timeouts });
  }

  async #configured(): Promise<VoiceConfig> {
    await this.#ready;
    if (!this.#config) throw new VoiceNotConfiguredError();
    return this.#config;
  }

  async #refreshProbe(config: VoiceConfig): Promise<void> {
    const generation = this.#generation;
    let probe: VoiceProbe;
    try {
      const discovery = await this.#client(config).discover(this.#timeouts.probe);
      probe = { at: this.#now(), ok: true, discovery };
    } catch (error) {
      probe = { at: this.#now(), ok: false, error: error instanceof Error ? error.message : "VoiceStudio could not be reached." };
    }
    if (generation === this.#generation) this.#probe = probe;
  }

  /** The stored connection and whether VoiceStudio answered within the last 30 seconds (probing when older). */
  async connection(): Promise<VoiceConnection> {
    await this.#ready;
    const config = this.#config;
    if (!config) return voiceConnectionView(undefined);
    if (!this.#probe || this.#now() - this.#probe.at >= this.#probeTtlMs) {
      this.#probing ??= this.#refreshProbe(config).finally(() => { this.#probing = undefined; });
      await this.#probing;
    }
    return voiceConnectionView(this.#config, this.#config === config ? this.#probe : undefined);
  }

  /**
   * Verifies the address and key (discovery, then the model list) before
   * anything is stored. An empty or absent key keeps the stored one while the
   * origin stays the same; `null` removes it.
   */
  async connect(body: unknown): Promise<VoiceConnection> {
    await this.#ready;
    const input = connectionInput(body);
    const previous = this.#config;
    const apiKey = input.apiKey === null
      ? undefined
      : input.apiKey ?? (previous && new URL(previous.url).origin === new URL(input.url).origin ? previous.apiKey : undefined);
    if (apiKey && !keyTransportAllowed(input.url)) throw new VoiceInputError(KEY_TRANSPORT_MESSAGE);
    const config: VoiceConfig = apiKey ? { url: input.url, apiKey } : { url: input.url };
    const client = this.#client(config);
    const discovery = await client.discover();
    await client.models();
    await this.#store.write(config);
    this.#generation += 1;
    this.#config = config;
    this.#probe = { at: this.#now(), ok: true, discovery };
    this.#probing = undefined;
    return voiceConnectionView(config, this.#probe);
  }

  async disconnect(): Promise<VoiceConnection> {
    await this.#ready;
    await this.#store.remove();
    this.#generation += 1;
    this.#config = undefined;
    this.#probe = undefined;
    this.#probing = undefined;
    return voiceConnectionView(undefined);
  }

  async voices(): Promise<VoiceProfile[]> {
    return this.#client(await this.#configured()).voices();
  }

  async transcribe(
    audio: { data: Uint8Array<ArrayBuffer>; contentType: string; filename: string },
    options: { language?: string | undefined; prompt?: string | undefined },
    signal?: AbortSignal,
  ): Promise<string> {
    const config = await this.#configured();
    const path = this.#probe?.ok ? this.#probe.discovery.transcriptionPath : undefined;
    return this.#client(config).transcribe(audio, { ...options, path }, signal);
  }

  async speech(
    request: { input: string; voice: string; speed: number; format: SpeechFormat },
    signal?: AbortSignal,
  ): Promise<{ contentType: string; audio: ReadableStream<Uint8Array> }> {
    return this.#client(await this.#configured()).speech(request, signal);
  }
}
