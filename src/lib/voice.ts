/**
 * Browser half of bots' voice (HUI-18). The gateway owns the VoiceStudio
 * connection and its key; this module moves credential-free views, recordings
 * and speech through `/__hui/voice`, and holds the small rules the views
 * share (what a microphone error means, how a voice is named).
 */
import type { SpeechRequest, VoiceConnection, VoiceProfile } from "../../shared/voice.ts";
import { CLIENT_HEADERS, fetchJson } from "./settings-store.ts";
import { trackedFetch } from "./ui-errors.ts";

const VOICE_URL = "/__hui/voice";
const JSON_HEADERS = { "content-type": "application/json" } as const;

/** The connection and whether VoiceStudio answered lately; the gateway probes for up to 5 s. */
export function loadVoiceConnection(): Promise<VoiceConnection> {
  return fetchJson<VoiceConnection>(VOICE_URL, { signal: AbortSignal.timeout(15_000) });
}

/** Verified by the gateway before anything is stored. An empty key keeps the saved one for the same address. */
export function connectVoice(input: { url: string; apiKey: string }): Promise<VoiceConnection> {
  return fetchJson<VoiceConnection>(VOICE_URL, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url: input.url, ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
}

export function disconnectVoice(): Promise<VoiceConnection> {
  return fetchJson<VoiceConnection>(VOICE_URL, { method: "DELETE" });
}

export async function loadVoices(): Promise<VoiceProfile[]> {
  return (await fetchJson<{ voices: VoiceProfile[] }>(`${VOICE_URL}/voices`, { signal: AbortSignal.timeout(20_000) })).voices;
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const detail = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  return new Error(typeof detail?.error === "string" ? detail.error : `${fallback} (HTTP ${response.status}).`);
}

/** A recording, as the browser made it, to text. Nothing is kept: the gateway relays it to VoiceStudio. */
export async function transcribeRecording(audio: Blob, options: { language?: string; signal?: AbortSignal } = {}): Promise<string> {
  const query = options.language ? `?language=${encodeURIComponent(options.language)}` : "";
  const response = await trackedFetch(`${VOICE_URL}/transcriptions${query}`, {
    method: "POST",
    headers: { ...CLIENT_HEADERS, "content-type": audio.type || "audio/webm" },
    body: audio,
    cache: "no-store",
    signal: options.signal ?? AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw await failure(response, "The recording could not be transcribed");
  return ((await response.json()) as { text: string }).text;
}

/** Speech for one chunk of text, read whole (VoiceStudio synthesizes a clip before it streams it). */
export async function synthesizeSpeech(request: SpeechRequest, signal?: AbortSignal): Promise<Blob> {
  const response = await trackedFetch(`${VOICE_URL}/speech`, {
    method: "POST",
    headers: { ...CLIENT_HEADERS, ...JSON_HEADERS },
    body: JSON.stringify(request),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw await failure(response, "VoiceStudio could not speak that");
  return await response.blob();
}

/** A message to a bot: a prompt when it is idle, a follow-up behind a busy turn (the bot route decides). */
export async function sendBotMessage(botId: string, text: string): Promise<"sent" | "queued"> {
  const result = await fetchJson<{ status: "sent" | "queued" }>(`/__hui/bots/${encodeURIComponent(botId)}/messages`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
  return result.status;
}

/** `65` seconds → `1:05`; an hour or more → `1:02:05`. */
export function formatCallTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** `1.25` → `1.25×`, `1` → `1×`. */
export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/** Picker options: VoiceStudio's default, the voice profiles (clones) first, then OpenAI's aliases. A saved
 * voice VoiceStudio no longer lists still shows what the bot uses. */
export function voiceOptions(voices: readonly VoiceProfile[], current: string): { value: string; label: string; description?: string }[] {
  const describe = (voice: VoiceProfile) => [voice.type === "profile" ? "Voice profile" : voice.type === "openai_alias" ? "OpenAI alias" : voice.type, voice.language].filter(Boolean).join(" · ");
  const ordered = [...voices.filter((voice) => voice.type === "profile"), ...voices.filter((voice) => voice.type !== "profile")];
  const options = [
    { value: "", label: "VoiceStudio default" },
    ...ordered.map((voice) => {
      const description = describe(voice);
      return { value: voice.id, label: voice.name, ...(description ? { description } : {}) };
    }),
  ];
  return current && !options.some((option) => option.value === current) ? [...options, { value: current, label: current, description: "Not listed by VoiceStudio now" }] : options;
}

/**
 * Why the microphone could not be used, in words: denied, missing, busy, or a
 * page the browser will not give a microphone to (plain HTTP away from this
 * machine, or HUI's desktop app, which allows none yet).
 */
export function microphoneErrorMessage(error: unknown, context: { secure: boolean; desktop: boolean }): string {
  if (context.desktop) return "HUI's desktop app does not allow the microphone yet. Open HUI in a browser to talk to bots.";
  if (!context.secure) return "Browsers give the microphone only to secure pages: open HUI on https:// (Tailscale Serve, say) or on this machine's localhost.";
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "Microphone access was denied. Allow it for this site in the browser's settings, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "The microphone is busy or unavailable. Close other apps using it and try again.";
  return error instanceof Error && error.message ? `The microphone could not be opened: ${error.message}` : "The microphone could not be opened.";
}

/** One line about the connection for Settings: who answered, or why not. */
export function voiceConnectionSummary(connection: VoiceConnection): string {
  if (!connection.configured) return "Not connected.";
  const key = connection.keySet ? " · API key saved" : "";
  if (connection.reachable === true) {
    const service = [connection.service ?? "VoiceStudio", connection.version].filter(Boolean).join(" ");
    return `Reachable · ${service}${key}`;
  }
  if (connection.reachable === false) return `Not reachable${key}: ${connection.error ?? "no answer."}`;
  return `Saved${key}; not checked yet.`;
}
