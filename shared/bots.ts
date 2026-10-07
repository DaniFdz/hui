/**
 * Bots (HUI-18): named, persistent agents, each with one forever chat whose
 * memory is OptChat and whose persona is the SOUL.md it writes in its first
 * conversation. Shared by the gateway, the `hui bot` CLI and the browser.
 * The chat itself is an ordinary Durable session (`BotRecord.sessionId`); the
 * session API drives it like any other.
 */

/** Limits the gateway enforces at its boundary; the CLI and browser mirror them. */
export const BOT_LIMITS = {
  name: 60,
  handle: 32,
  title: 80,
  description: 500,
  /** SOUL.md, in characters: what a bot's chat reads of it, and what `PUT …/soul` accepts. */
  soul: 20_000,
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
  /** Absolute working directory of its chat. Its persona is not here: it is SOUL.md in the bot's home folder. */
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

/** The name of a bot created without one; it asks the operator for a real one in its first conversation. */
export const NEW_BOT_NAME = "New Bot";

/** `POST /__hui/bots`. Without `name` the bot is `NEW_BOT_NAME`; without `handle`, one is derived from the name. */
export type BotInput = {
  name: string;
  handle?: string;
  title?: string;
  description?: string;
  /** SOUL.md for the new bot, at most 20,000 characters: it starts with this persona and skips the first conversation. */
  soul?: string;
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
 * `description`, `model`, `thinking`, `memoryModel` and `memoryThinking`
 * (a cleared `model` or `thinking` puts the chat back on what a new chat
 * gets: the gateway's default model and thinking level); an avatar key set to
 * `""` clears that key and `avatar: null` clears both. SOUL.md changes through
 * `PUT /__hui/bots/:id/soul` instead.
 */
export type BotPatch = Partial<Omit<BotInput, "avatar" | "soul">> & { avatar?: BotAvatar | null };

/** `GET` and `PUT /__hui/bots/:id/soul`: SOUL.md's text, `null` while the bot has none (its first conversation). */
export type BotSoul = { soul: string | null };

/** The persona file in each bot's home folder. */
export const BOT_SOUL_FILE = "SOUL.md";

/**
 * The first line of the message HUI sends a new bot without a soul, so it speaks
 * first: an ordinary user-role message (like a routine's), which the chat shows
 * as a note ("<name> was created"), never as the operator's bubble.
 */
export const BOT_KICKOFF_MARKER = "[HUI bot created]";

/** The kickoff message: the marker, the bot's name, and what HUI asks of it. */
export function botKickoffText(name: string): string {
  return [
    BOT_KICKOFF_MARKER,
    `name: ${name.replace(/\s+/gu, " ").trim()}`,
    "HUI just created you. This note is from HUI, not the operator, who will read your chat when they open it. Write your opening message to them now (your greeting and first question, as your soul section says) and reply with that message only.",
  ].join("\n");
}

/** The bot's name when `text` is a kickoff message (`""` if it names none); undefined for every other message. */
export function botKickoffName(text: string): string | undefined {
  if (text !== BOT_KICKOFF_MARKER && !text.startsWith(`${BOT_KICKOFF_MARKER}\n`)) return undefined;
  return /^name: (.*)$/mu.exec(text)?.[1]?.trim() ?? "";
}

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
  /** SOUL.md exists in its home folder; false while the bot has its first conversation. */
  soul: boolean;
  /** The newest message of its chat, one line of at most 200 characters. */
  lastMessage?: BotLastMessage;
  /** A turn settled while nobody watched the chat. */
  unread: boolean;
  /** Absent when the gateway cannot read the chat's memory. */
  memory?: BotMemoryStatus;
  /** Automation tasks targeting its chat. */
  routines: number;
};

/** A question the bot's chat is waiting on, as the session API reports it. `secret` is HUI's own `secret_request`
 * prompt (`title` names the secret, `message` says why): it is answered in HUI's masked Secret card. */
export type BotQuestion = {
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "secret";
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
