/**
 * Realtime calls with bots (HUI-18) through GPT-Live, over the operator's
 * ChatGPT subscription: the route ChatGPT's own voice mode uses. Shared by the
 * gateway, the CLI and the browser. The gateway owns the ChatGPT credential and
 * sets each call up; the browser owns the call's WebRTC media and its data
 * channel. The route belongs to ChatGPT and may change without notice.
 */

/** The ChatGPT route's GPT-Live model. */
export const GPT_LIVE_MODEL = "gpt-live-1-codex";

/** GPT-Live's built-in voices on the ChatGPT route, its default first. */
export const GPT_LIVE_VOICES = ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"] as const;
export type GptLiveVoice = (typeof GPT_LIVE_VOICES)[number];
export const DEFAULT_GPT_LIVE_VOICE: GptLiveVoice = "cove";

/** How calls with bots run: GPT-Live through the ChatGPT subscription, or VoiceStudio's speech chain. */
export const CALL_ENGINES = ["voicestudio", "gpt-live"] as const;
export type CallEngine = (typeof CALL_ENGINES)[number];

/** Limits the gateway enforces at its boundary; the browser mirrors them. */
export const CALL_LIMITS = {
  /** Bytes of the browser's SDP offer; an audio offer with its data channel is about 2 KB. */
  sdp: 64 * 1024,
  /** Calls the gateway holds at once, across every bot. */
  concurrent: 2,
  /** A call that sends nothing (no heartbeat, line or task) for this long is released. */
  idleMs: 90_000,
  /** Characters of one spoken line written to the chat. */
  line: 4_000,
  /** Lines in one transcript request. */
  lines: 40,
  /** Characters of the request GPT-Live delegates. */
  request: 4_000,
  /** Characters of a delegation's result read back to GPT-Live (OpenClaw's bound). */
  result: 1_800,
  /** UTF-8 bytes of one context append on the data channel (OpenClaw's chunk size). */
  appendBytes: 500,
  /** UTF-8 bytes of the bot's memory (the newest end of its OptChat view) in a call's instructions. */
  memoryBytes: 8_000,
  /** UTF-8 bytes of the bot's own instructions in a call's instructions. */
  personaBytes: 6_000,
  /** How long a delegated task may run before the call is told to look for the answer in the chat. */
  taskSeconds: 600,
} as const;

/** What a call's lines are marked with in the bot's memory (OptChat's view): spoken in a call, not typed. */
export const CALL_LINE_PREFIX = "[call] ";
/** How a task GPT-Live delegates reaches the bot's chat. */
export const CALL_TASK_PREFIX = "[call task] ";

export function isGptLiveVoice(value: unknown): value is GptLiveVoice {
  return typeof value === "string" && (GPT_LIVE_VOICES as readonly string[]).includes(value);
}

/** A voice by its id in any case; undefined for anything else. */
export function gptLiveVoice(value: unknown): GptLiveVoice | undefined {
  if (typeof value !== "string") return undefined;
  const voice = value.trim().toLowerCase();
  return isGptLiveVoice(voice) ? voice : undefined;
}

/** "Cove". */
export function gptLiveVoiceLabel(voice: GptLiveVoice): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}

/** The voice a bot's call uses: its own, else the one Settings chose, else GPT-Live's default. */
export function callVoice(botVoice: GptLiveVoice | undefined, settingsVoice: GptLiveVoice | undefined): GptLiveVoice {
  return botVoice ?? settingsVoice ?? DEFAULT_GPT_LIVE_VOICE;
}

/** `GET /__hui/calls`: what Settings → Models → Calls shows. Never a token or an account id. */
export type CallsStatus = {
  model: string;
  voices: readonly GptLiveVoice[];
  chatgpt: {
    /** A ChatGPT login (provider `openai-codex`) is saved in HUI. */
    signedIn: boolean;
    /** The account calls use now: the first signed-in one not waiting for its quota, as model turns choose. */
    account?: { name: string; email?: string };
    /** Every signed-in account waits for its quota until then. */
    waitingUntil?: number;
  };
  /** Calls held now, and how many may be. */
  active: number;
  limit: number;
};

/** `POST /__hui/bots/:id/calls`: the browser's offer. */
export type CallStartRequest = { sdp: string };

/** Its answer: the call's id in HUI (not the provider's), the answer SDP and what the call uses. */
export type CallStarted = {
  callId: string;
  answer: string;
  model: string;
  voice: GptLiveVoice;
  account: { name: string };
  /** UTF-8 bytes of the instructions the call started with, and of the memory inside them. */
  instructionsBytes: number;
  memoryBytes: number;
};

/** One line of a call, as it was said: what the operator said or what the voice model said. */
export type CallLine = { role: "user" | "assistant"; text: string };

/** `POST /__hui/bots/:id/calls/:callId/delegations`: a task GPT-Live hands to the bot. `id` is its delegation item. */
export type CallDelegationRequest = { id: string; request: string };

/** What the delegation's bot turn came to, and what to tell GPT-Live (the speakable result). */
export type CallDelegationResult = {
  status: "answered" | "failed" | "needs-input" | "timeout";
  /** For GPT-Live to say in its own words; bounded to `CALL_LIMITS.result` characters. */
  speak: string;
};

/**
 * Text cut into pieces of at most `maxBytes` UTF-8 bytes, without splitting a character, for context appends on the
 * data channel. After OpenClaw's `chunkOpenAIQuicksilverAppendText` (MIT, © OpenClaw contributors).
 */
export function chunkUtf8(text: string, maxBytes: number = CALL_LIMITS.appendBytes): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return [text];
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const character of text) {
    const bytes = encoder.encode(character).byteLength;
    if (current && size + bytes > maxBytes) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** At most `max` characters, an ellipsis marking a cut at a word boundary when one is near. */
export function boundText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
