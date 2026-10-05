/**
 * Bots (HUI-18): named, persistent agents, each with one forever chat whose
 * memory is OptChat. Shared by the gateway, the `hui bot` CLI and the browser.
 * The chat itself is an ordinary Durable session (`BotRecord.sessionId`); the
 * session API drives it like any other.
 */

/** Limits the gateway enforces at its boundary; the CLI and browser mirror them. */
export const BOT_LIMITS = {
  name: 60,
  handle: 32,
  title: 80,
  description: 500,
  instructions: 20_000,
  /** One `message_bot` message. */
  message: 20_000,
  /** `lastMessage.text`, a one-line preview. */
  preview: 200,
} as const;

export const BOT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

/** Lowercase ASCII letters, digits and inner dashes, 1–32 characters. */
export const BOT_HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

export type BotAvatar = { emoji?: string; color?: string };

/** One bot as `bots.json` stores it. */
export type BotRecord = {
  id: string;
  /** Unique; how other bots and the CLI address it (`@handle`). */
  handle: string;
  name: string;
  /** Its role, one line. */
  title?: string;
  description?: string;
  /** Standing instructions (persona): the chat's Durable `instructions`. */
  instructions?: string;
  /** Absolute working directory of its chat. */
  cwd: string;
  /** `provider/id` of its chat. */
  model?: string;
  thinking?: string;
  /** `provider/id` OptChat's compactor uses; absent: the chat's own model. */
  memoryModel?: string;
  memoryThinking?: string;
  avatar?: BotAvatar;
  hidden?: boolean;
  /** Archived bots keep their chat and memory; their routines are disabled. */
  archived?: boolean;
  /** HUI session record of its chat. */
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

/** `POST /__hui/bots`. Without `handle`, one is derived from the name. */
export type BotInput = {
  name: string;
  handle?: string;
  title?: string;
  description?: string;
  instructions?: string;
  /** Absolute or `~/`; absent: a new directory of its own in HUI's configuration. */
  cwd?: string;
  model?: string;
  thinking?: string;
  memoryModel?: string;
  memoryThinking?: string;
  avatar?: BotAvatar;
  hidden?: boolean;
};

/**
 * `PATCH /__hui/bots/:id`: only what changes. `""` clears `title`,
 * `description`, `instructions`, `model`, `thinking`, `memoryModel` and
 * `memoryThinking` (a cleared `model` or `thinking` puts the chat back on what
 * a new chat gets: the gateway's default model and thinking level); an avatar
 * key set to `""` clears that key and `avatar: null` clears both.
 */
export type BotPatch = Partial<Omit<BotInput, "avatar">> & { avatar?: BotAvatar | null };

/** A bot chat's session status, as `SessionView.status` reports it. */
export type BotSessionStatus = "idle" | "running" | "waiting" | "starting" | "error" | "reconnecting" | "disconnected";

/** What OptChat's compactor spent: model calls, tokens and cost (USD) as the providers report them. */
export type BotMemoryUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

/** What OptChat reports about one bot's memory. */
export type BotMemoryStatus = {
  /** Messages in the log. */
  messages: number;
  /** Summary nodes built, and those still to build. */
  built: number;
  pending: number;
  /** UTF-8 bytes of the current view, and its lines. */
  viewBytes: number;
  viewLines: number;
  /** A turn waits for the compactor to summarize the newest messages ("Summarizing memory…"). */
  waiting?: boolean;
  /** A node keeps failing; OptChat retries it. */
  failing?: { node: string; error: string; since: string };
  /** The compactor's spend since the gateway opened this memory (it is not persisted). */
  usage: BotMemoryUsage;
};

export type BotLastMessage = { role: "user" | "assistant"; text: string; at: string };

export type BotView = BotRecord & {
  status: BotSessionStatus;
  /** The newest message of its chat, one line of at most 200 characters. */
  lastMessage?: BotLastMessage;
  /** A turn settled while nobody watched the chat. */
  unread: boolean;
  /** Absent when the gateway cannot read the chat's memory. */
  memory?: BotMemoryStatus;
  /** Automation tasks targeting its chat. */
  routines: number;
};

/** A question the bot's chat is waiting on, as the session API reports it. */
export type BotQuestion = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: readonly string[];
  placeholder?: string;
  prefill?: string;
};

/** `POST /__hui/bots/:id/messages` without `wait` (202). */
export type BotDelivery = { status: "sent" | "queued" };

/** `POST /__hui/bots/:id/messages` with `wait: true` (200): how the run that answers the message ended. */
export type BotReply = {
  status: "answered" | "failed" | "needs-input" | "timeout";
  reply?: string;
  error?: string;
  /** `needs-input`: what the chat asks; answer through the session question route. */
  questions?: BotQuestion[];
};

export type BotMessageResult = BotDelivery | BotReply;

/** A frame of `GET /__hui/bots/events`: `ids` (every bot, in list order) only when it changed. */
export type BotsUpdate = { revision: number; ids?: string[]; upserts: BotView[] };

/** The handle a name suggests: ASCII-folded and lowercase, every other run as one dash, at most 32 characters. */
export function handleFromName(name: string): string {
  const slug = name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+/u, "").slice(0, BOT_LIMITS.handle).replace(/-+$/u, "");
  return slug || "bot";
}

/** One line: whitespace runs as single spaces, at most `max` characters (an ellipsis marks a cut). */
export function previewLine(text: string, max: number = BOT_LIMITS.preview): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
