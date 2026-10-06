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

/**
 * The languages a bot can listen and speak in: Whisper's 100, with its names
 * and in its order (openai/whisper, whisper/tokenizer.py `LANGUAGES`), which
 * VoiceStudio's default recognizers (the Whisper family) take as `language`.
 * The codes are ISO 639-1, except Hawaiian `haw` and Cantonese `yue` (ISO
 * 639-3, VoiceStudio's ids too) and Javanese: Whisper alone says `jw` for
 * ISO's `jv`, so speech sends `jv` (`speechLanguage`).
 */
export const VOICE_LANGUAGES = {
  en: "english", zh: "chinese", de: "german", es: "spanish", ru: "russian", ko: "korean", fr: "french",
  ja: "japanese", pt: "portuguese", tr: "turkish", pl: "polish", ca: "catalan", nl: "dutch", ar: "arabic",
  sv: "swedish", it: "italian", id: "indonesian", hi: "hindi", fi: "finnish", vi: "vietnamese", he: "hebrew",
  uk: "ukrainian", el: "greek", ms: "malay", cs: "czech", ro: "romanian", da: "danish", hu: "hungarian", ta: "tamil",
  no: "norwegian", th: "thai", ur: "urdu", hr: "croatian", bg: "bulgarian", lt: "lithuanian", la: "latin",
  mi: "maori", ml: "malayalam", cy: "welsh", sk: "slovak", te: "telugu", fa: "persian", lv: "latvian", bn: "bengali",
  sr: "serbian", az: "azerbaijani", sl: "slovenian", kn: "kannada", et: "estonian", mk: "macedonian", br: "breton",
  eu: "basque", is: "icelandic", hy: "armenian", ne: "nepali", mn: "mongolian", bs: "bosnian", kk: "kazakh",
  sq: "albanian", sw: "swahili", gl: "galician", mr: "marathi", pa: "punjabi", si: "sinhala", km: "khmer",
  sn: "shona", yo: "yoruba", so: "somali", af: "afrikaans", oc: "occitan", ka: "georgian", be: "belarusian",
  tg: "tajik", sd: "sindhi", gu: "gujarati", am: "amharic", yi: "yiddish", lo: "lao", uz: "uzbek", fo: "faroese",
  ht: "haitian creole", ps: "pashto", tk: "turkmen", nn: "nynorsk", mt: "maltese", sa: "sanskrit",
  lb: "luxembourgish", my: "myanmar", bo: "tibetan", tl: "tagalog", mg: "malagasy", as: "assamese", tt: "tatar",
  haw: "hawaiian", ln: "lingala", ha: "hausa", ba: "bashkir", jw: "javanese", su: "sundanese", yue: "cantonese",
} as const;

export type VoiceLanguage = keyof typeof VOICE_LANGUAGES;

const LANGUAGE_CODES: ReadonlySet<string> = new Set(Object.keys(VOICE_LANGUAGES));

/** Codes a refusal names as examples. */
export const VOICE_LANGUAGE_EXAMPLES = "en, es, fr, de or ja";

/** A bot's voice: a VoiceStudio voice id, a speed and the language it hears and speaks in; absent keys use
 * VoiceStudio's defaults (for the language, Auto: the recognizer detects it). */
export type BotVoice = { profile?: string; speed?: number; language?: VoiceLanguage };

/** Audio formats `POST /__hui/voice/speech` asks VoiceStudio for. */
export const SPEECH_FORMATS = ["mp3", "opus"] as const;
export type SpeechFormat = (typeof SPEECH_FORMATS)[number];

/**
 * `POST /__hui/voice/speech`. `voice`, `speed` and `language` win over the bot's (a voice preview); absent, the
 * bot's apply. `language: ""` asks for Auto even when the bot has a language.
 */
export type SpeechRequest = {
  text: string;
  botId?: string;
  voice?: string;
  speed?: number;
  language?: VoiceLanguage | "";
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

/** One of Whisper's language codes (trimmed, in any case); undefined for anything else, a name included. */
export function voiceLanguage(value: unknown): VoiceLanguage | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toLowerCase();
  return LANGUAGE_CODES.has(code) ? code as VoiceLanguage : undefined;
}

/** The language VoiceStudio's speech is asked for: the code itself, but Javanese as ISO's `jv`, its id there. */
export function speechLanguage(code: VoiceLanguage): string {
  return code === "jw" ? "jv" : code;
}

/** Whisper's name for the language, capitalized: `Haitian Creole`. */
export function whisperLanguageName(code: VoiceLanguage): string {
  return VOICE_LANGUAGES[code].replace(/(^|\s)\p{Ll}/gu, (initial) => initial.toUpperCase());
}

/** What names languages: the platform's `Intl.DisplayNames`, or a stand-in under test. */
export type LanguageNames = { of(code: string): string | undefined };

let englishNames: LanguageNames | null | undefined;

function platformNames(): LanguageNames | null {
  if (englishNames === undefined) {
    try {
      englishNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    } catch {
      englishNames = null;
    }
  }
  return englishNames;
}

/** The language's English name (HUI's UI language): the platform's, else Whisper's. */
export function voiceLanguageName(code: VoiceLanguage, names: LanguageNames | null = platformNames()): string {
  let name: string | undefined;
  try {
    name = names?.of(code);
  } catch {
    name = undefined;
  }
  return name || whisperLanguageName(code);
}
