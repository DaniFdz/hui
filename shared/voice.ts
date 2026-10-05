/**
 * Talking to bots (HUI-18): voice notes, read-aloud and calls through
 * VoiceStudio (https://github.com/debpalash/VoiceStudio), a separate speech
 * service HUI only calls over HTTP. Shared by the gateway, the CLI and the
 * browser; the gateway owns the connection and its key.
 */

/** Limits the gateway enforces at its boundary; the browser mirrors them. */
export const VOICE_LIMITS = {
  /** Characters of one `POST /__hui/voice/speech` (VoiceStudio's own cap is 4096). */
  speechText: 4_000,
  /** Bytes of one recording `POST /__hui/voice/transcriptions` accepts, as OpenAI's API does. */
  audioBytes: 25 * 1024 * 1024,
  /** A bot's speaking speed, as a multiple of the voice's own. */
  speedMin: 0.5,
  speedMax: 2,
  /** Characters of a voice profile id. */
  profile: 200,
  /** Characters of a transcription prompt (vocabulary hints). */
  prompt: 1_000,
} as const;

/** The discovery document's protocol a VoiceStudio speech platform reports. */
export const VOICE_PROTOCOL = "voicestudio.speech.v1";

/** Marks a message spoken into a bot's chat, so its memory knows it was said, not typed. */
export const VOICE_MESSAGE_PREFIX = "[voice] ";

/** `GET|PUT|DELETE /__hui/voice`. The API key is write-only: only `keySet` says one is stored. */
export type VoiceConnection = {
  configured: boolean;
  /** The service root, as in `http://127.0.0.1:3900`; empty when not configured. */
  url: string;
  keySet: boolean;
  /** The latest probe (at most 30 seconds old) reached VoiceStudio's discovery document. */
  reachable?: boolean;
  /** From the discovery document: `voicestudio.speech.v1`. */
  protocol?: string;
  service?: string;
  version?: string;
  /** The discovery document's feature switches. */
  features?: Record<string, boolean>;
  /** Why the latest probe failed. */
  error?: string;
  checkedAt?: string;
};

/** One entry of `GET /__hui/voice/voices`: a VoiceStudio voice profile, preset or OpenAI alias. */
export type VoiceProfile = {
  id: string;
  name: string;
  /** VoiceStudio's kind: `profile` (a cloned voice), `openai_alias`, or an engine's own. */
  type?: string;
  language?: string;
  description?: string;
};

/** A bot's voice: a VoiceStudio voice id and a speed; absent keys use VoiceStudio's defaults. */
export type BotVoice = { profile?: string; speed?: number };

/** Audio formats `POST /__hui/voice/speech` asks VoiceStudio for. */
export const SPEECH_FORMATS = ["mp3", "opus"] as const;
export type SpeechFormat = (typeof SPEECH_FORMATS)[number];

/** `POST /__hui/voice/speech`. `voice`/`speed` win over the bot's (a voice preview); absent, the bot's apply. */
export type SpeechRequest = {
  text: string;
  botId?: string;
  voice?: string;
  speed?: number;
  format?: SpeechFormat;
};

/** A speed within the limits, to two decimals; undefined for anything else. */
export function voiceSpeed(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < VOICE_LIMITS.speedMin || value > VOICE_LIMITS.speedMax) return undefined;
  return Math.round(value * 100) / 100;
}

/** A voice id VoiceStudio could know: one line of at most 200 characters, no control characters. */
export function voiceProfileId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id && id.length <= VOICE_LIMITS.profile && !/\p{Cc}/u.test(id) ? id : undefined;
}
