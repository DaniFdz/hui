/**
 * Realtime calls with bots (HUI-18) through GPT-Live, over the operator's
 * ChatGPT subscription: the route ChatGPT's own voice mode uses. Shared by the
 * gateway, the CLI and the browser. The gateway owns the ChatGPT credential and
 * sets each call up; the browser owns the call's WebRTC media and its data
 * channel. The route belongs to ChatGPT and may change without notice.
 *
 * The shape follows OpenDots (CopilotKit/OpenDots, MIT): a realtime
 * conversation model, one tool that asks the bot (a quick helper on its utility
 * model), real work handed to the bot's chat, and one record of the call at
 * hang-up.
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
  /** How long a task handed to the bot's chat is followed for the call before the answer stays in the chat. */
  taskSeconds: 600,
  /** The helper's time budget per question; past it, the call offers to hand the question off. */
  helperSeconds: 25,
  /** Questions the helper answers per call; past them every request is handed off. */
  helperQuestions: 6,
  /** Tasks one call may hand to the bot's chat. */
  handoffs: 4,
  /** A call ends after this long. */
  maxMinutes: 15,
  /** Lines a call keeps for its record. */
  recordLines: 400,
  /** UTF-8 bytes of the bot's memory the helper reads. */
  helperMemoryBytes: 16_000,
} as const;

/** How a call's record starts in the bot's memory (OptChat's view). */
export const CALL_RECORD_PREFIX = "[call]";
/** How a task handed off from a call reaches the bot's chat. */
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

/**
 * A line of a call's record: something said (`user`, `assistant`), a question the helper answered (`helper`:
 * `request` is what GPT-Live asked, `text` the answer) or a task handed to the bot's chat (`handoff`: `text` is
 * the task). `at` is when, in ms.
 */
export type CallRecordLine = { role: "user" | "assistant" | "helper" | "handoff"; text: string; at: number; request?: string };

/** One call as the bot's chat keeps it: a single card with its summary and its whole transcript. */
export type CallRecord = {
  call: string;
  /** The bot's name when the call ended. */
  bot?: string;
  startedAt: number;
  endedAt: number;
  /** What happened, written by the bot's utility model at hang-up; absent when that failed. */
  summary?: string;
  summaryUnavailable?: true;
  lines: CallRecordLine[];
};

/** `POST /__hui/bots/:id/calls/:callId/delegations`: a question GPT-Live hands to the bot. `id` is its delegation item. */
export type CallDelegationRequest = { id: string; request: string };

/**
 * What to tell GPT-Live about a delegation (the speakable result): the helper's answer, a task handed to the bot's
 * chat (`task`: its id, to follow with `/tasks/:task`), or why there is no answer.
 */
export type CallDelegationResult = {
  status: "answered" | "handed-off" | "failed" | "timeout" | "limit";
  /** For GPT-Live to say in its own words; bounded to `CALL_LIMITS.result` characters. */
  speak: string;
  task?: string;
};

/** `POST /__hui/bots/:id/calls/:callId/tasks/:task`: how a handed-off task ended, once it did. */
export type CallTaskResult = { status: "answered" | "failed" | "needs-input" | "timeout"; speak: string };

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

const RECORD_ROLES: ReadonlySet<string> = new Set(["user", "assistant", "helper", "handoff"]);

/** A stored call record, keeping what validates; undefined when it is not one. */
export function parseCallRecord(raw: unknown): CallRecord | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const startedAt = value["startedAt"];
  const endedAt = value["endedAt"];
  if (typeof value["call"] !== "string" || typeof startedAt !== "number" || typeof endedAt !== "number" || !Array.isArray(value["lines"])) return undefined;
  const lines = value["lines"].flatMap((item): CallRecordLine[] => {
    if (!item || typeof item !== "object") return [];
    const line = item as Record<string, unknown>;
    if (typeof line["role"] !== "string" || !RECORD_ROLES.has(line["role"]) || typeof line["text"] !== "string") return [];
    return [{ role: line["role"] as CallRecordLine["role"], text: line["text"], at: typeof line["at"] === "number" ? line["at"] : startedAt, ...(typeof line["request"] === "string" ? { request: line["request"] } : {}) }];
  });
  return {
    call: value["call"],
    ...(typeof value["bot"] === "string" && value["bot"] ? { bot: value["bot"] } : {}),
    startedAt, endedAt,
    ...(typeof value["summary"] === "string" && value["summary"].trim() ? { summary: value["summary"] } : {}),
    ...(value["summaryUnavailable"] === true ? { summaryUnavailable: true as const } : {}),
    lines,
  };
}

/** The speaker of a record line, as a transcript reads it. */
export function callLineSpeaker(line: CallRecordLine, botName: string, operator = "You"): string {
  if (line.role === "user") return operator;
  if (line.role === "assistant") return botName;
  if (line.role === "helper") return `${botName}'s helper`;
  return `Handed to ${botName}'s chat`;
}

/** The call, one line per turn: what the helper and the summary read, and what the bot's memory keeps. */
export function callTranscriptText(lines: readonly CallRecordLine[], botName: string, operator = "User"): string {
  return lines.map((line) => line.role === "helper"
    ? `${callLineSpeaker(line, botName, operator)} (asked "${line.request ?? ""}"): ${line.text}`
    : `${callLineSpeaker(line, botName, operator)}: ${line.text}`).join("\n");
}

/** Minutes a call lasted, at least one. */
export function callMinutes(record: Pick<CallRecord, "startedAt" | "endedAt">): number {
  return Math.max(1, Math.round((record.endedAt - record.startedAt) / 60_000));
}

/** The record as OptChat logs it: its transcript (a user line), then its summary (the bot's), marked as a call. */
export function callRecordLines(record: CallRecord): { transcript: string; summary?: string } {
  const bot = record.bot ?? "Bot";
  const when = new Date(record.startedAt).toISOString().slice(0, 16).replace("T", " ");
  return {
    transcript: `${CALL_RECORD_PREFIX} A voice call with ${bot} (${when} UTC, about ${callMinutes(record)} min). Transcript:\n${callTranscriptText(record.lines, bot)}`,
    ...(record.summary ? { summary: `${CALL_RECORD_PREFIX} ${bot}'s summary of that call: ${record.summary}` } : {}),
  };
}

/** At most `max` characters, an ellipsis marking a cut at a word boundary when one is near. */
export function boundText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
