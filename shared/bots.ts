/**
 * Bots (HUI-18): named, persistent agents, each with one forever chat whose
 * memory is OptChat and whose persona is the SOUL.md it writes in its first
 * conversation. Shared by the gateway, the `hui bot` CLI and the browser.
 * The chat itself is an ordinary Durable session (`BotRecord.sessionId`); the
 * session API drives it like any other.
 */
import type { GptLiveVoice } from "./calls.ts";
import type { BotVoice, VoiceLanguage } from "./voice.ts";

export type { BotVoice } from "./voice.ts";

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

/**
 * A bot's face, after OpenAI's Dots: a plush shape in a color, with two dot
 * eyes and no mouth. Stored in `avatar` beside the emoji, which still wins
 * while set (a bot switches to its face when the emoji is cleared).
 */
export const BOT_FACE_SHAPES = ["blob", "round", "triangle", "heart", "cookie"] as const;
export type BotFaceShape = (typeof BOT_FACE_SHAPES)[number];
export const BOT_FACE_SHAPE_LABELS: Readonly<Record<BotFaceShape, string>> = { blob: "Blob", round: "Pebble", triangle: "Triangle", heart: "Heart", cookie: "Cookie" };

/** The palette the Bots tab and `hui bot --color` name; the API takes any #rrggbb. */
export const BOT_FACE_COLORS = [
  { id: "blue", label: "Blue", hex: "#3a7bfa" },
  { id: "yellow", label: "Yellow", hex: "#f5c21b" },
  { id: "magenta", label: "Magenta", hex: "#d23ce0" },
  { id: "mint", label: "Mint", hex: "#2fc49a" },
  { id: "coral", label: "Coral", hex: "#ff6b4a" },
  { id: "lilac", label: "Lilac", hex: "#9b7cf6" },
] as const;
export type BotFaceColor = (typeof BOT_FACE_COLORS)[number];

/** `color`: #rrggbb, lowercase. `shape` and `color` absent: the face derived from the bot's id. */
export type BotAvatar = { emoji?: string; color?: string; shape?: BotFaceShape };

/** A skill as a bot's lists name it: its name and source, as Settings' disabled skills do (its SKILL.md path, or a
 * bundled skill's stable `hui:skill:` path). */
export type BotSkillRef = { name: string; path: string };

/** A skill in `POST` and `PATCH /__hui/bots`: its name, when no other skill of the bot's directory has it, or a ref. */
export type BotSkillSelector = string | BotSkillRef;

/** What the operator turned off in a bot's chat. */
export type BotAccess = { disabledTools: string[]; disabledSkills: BotSkillRef[] };

/** One bot as `bots.json` stores it. */
export type BotRecord = {
  id: string;
  /** Unique; how other bots and the CLI address it (`@handle`). */
  handle: string;
  name: string;
  /** Its role, one line. */
  title?: string;
  description?: string;
  /** Absolute working directory of its chat; on a worker, a directory there. Its persona is not here: it is SOUL.md in
   * the bot's home folder, on the machine its chat runs on. */
  cwd: string;
  /**
   * The remote worker (Settings → Workers) its chat runs on, by id: its conversation and OptChat memory live in that
   * worker's Durable store. Absent: this machine. Chosen at creation; a bot never moves.
   */
  worker?: string;
  /** `provider/id` of its chat. */
  model?: string;
  thinking?: string;
  /** `provider/id` OptChat's compactor uses; absent: the chat's own model. */
  memoryModel?: string;
  memoryThinking?: string;
  avatar?: BotAvatar;
  /** Its voice on calls: `voice.live` is its GPT-Live voice (absent: Settings' choice) and `voice.language` the
   * language it speaks there (absent: Auto). */
  voice?: BotVoice;
  hidden?: boolean;
  /** Archived bots keep their chat and memory; their routines are disabled. */
  archived?: boolean;
  /**
   * Tools and skills the operator turned off in its chat; absent: none. Everything else a session in its directory
   * gets is on, tools and skills that appear later included. A mirror: the chat's `hui.bot` document holds the lists,
   * and the host that runs the chat enforces them.
   */
  disabledTools?: string[];
  disabledSkills?: BotSkillRef[];
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
  /** Absolute or `~/`; absent: a new directory of its own in HUI's configuration (on a worker, in HUI's data directory there). */
  cwd?: string;
  /** A remote worker's id or exact name: the bot runs there. Only at creation. */
  worker?: string;
  model?: string;
  thinking?: string;
  memoryModel?: string;
  memoryThinking?: string;
  avatar?: BotAvatar;
  voice?: BotVoice;
  hidden?: boolean;
  /** Tools to turn off from its first turn: the ones every chat has (`GET /__hui/bots/:id/catalog` lists them all once
   * it runs, extension tools included). */
  disabledTools?: string[];
  /** Skills of its directory to turn off. */
  disabledSkills?: BotSkillSelector[];
};

/**
 * `PATCH /__hui/bots/:id`: only what changes. `""` clears `title`,
 * `description`, `model`, `thinking`, `memoryModel` and `memoryThinking`
 * (a cleared `model` or `thinking` puts the chat back on what a new chat
 * gets: the gateway's default model and thinking level); an avatar key set to
 * `""` clears that key (`emoji: ""` switches the bot to its face, `shape: ""`
 * and `color: ""` back to the ones its id picks) and `avatar: null` clears all
 * three. A voice `language: ""` (back to Auto) or `live: ""` (back to Settings'
 * call voice) clears that key and `voice: null` clears both. `disabledTools` and
 * `disabledSkills` replace the whole list (`[]` turns everything back on),
 * validated against the bot's catalog; they apply from its chat's next request.
 * SOUL.md changes through `PUT /__hui/bots/:id/soul` instead.
 */
export type BotPatch = Partial<Omit<BotInput, "avatar" | "voice" | "soul" | "worker">> & { avatar?: BotAvatarPatch | null; voice?: BotVoicePatch | null };

/** A change to a bot's look: given keys replace, `""` clears one. */
export type BotAvatarPatch = { emoji?: string; color?: string; shape?: BotFaceShape | "" };

/** A change to a bot's voice on calls: given keys replace, `language: ""` and `live: ""` clear one. */
export type BotVoicePatch = { language?: VoiceLanguage | ""; live?: GptLiveVoice | "" };

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

export type BotView = Omit<BotRecord, "worker"> & {
  /** The remote worker its chat runs on, named as session views name it; absent: this machine. */
  worker?: { id: string; name: string };
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

/* ── tools and skills ─────────────────────────────────────────────────── */

/** How the Tools tab groups a tool: files, shell, HUI's own, an extension's (by its source), or bots'. */
export type BotToolGroup = "files" | "shell" | "hui" | "extension" | "bots";

/** One tool the operator can turn off in a bot's chat. */
export type BotCatalogTool = {
  name: string;
  label: string;
  /** One line. */
  description: string;
  group: BotToolGroup;
  /** `Durable` (the coding tools), `HUI`, or an extension's source label. */
  source: string;
  /** It reaches past whatever else is off: it runs commands, changes files other programs load, or acts through another
   * session. On by default, like every tool; labelled so the operator knows. */
  powerful: boolean;
  enabled: boolean;
};

/** One skill of the bot's directory, Settings' choices applied. */
export type BotCatalogSkill = BotSkillRef & {
  description: string;
  /** Where it comes from: `HUI defaults` for a bundled skill, else the directory holding it. */
  source: string;
  enabled: boolean;
};

/** An access request (`request_access`) waiting for the operator in the bot's chat. */
export type BotAccessRequest = {
  /** The session question to answer (`POST /__hui/sessions/:id/question` with `value` `"Allow"` or `"Deny"`). */
  id: string;
  sessionId: string;
  title: string;
  /** The bot's reason, and who started the turn when it wasn't the operator. */
  message: string;
};

/** `GET /__hui/bots/:id/catalog`: what the operator can turn off in a bot's chat, and what is off. */
export type BotCatalog = {
  tools: BotCatalogTool[];
  skills: BotCatalogSkill[];
  /** Always on and never offered to turn off: its soul, profile and access tools, and OptChat's memory. */
  alwaysOn: { name: string; description: string }[];
  disabledTools: string[];
  disabledSkills: BotSkillRef[];
  /** False while its chat isn't running here: `tools` then lists only the tools every chat has, without extensions'. */
  live: boolean;
  request?: BotAccessRequest;
};

/* ── access requests ──────────────────────────────────────────────────── */

/** The two answers of an access request. */
export const BOT_ACCESS_ANSWERS = ["Allow", "Deny"] as const;

/** Whether a session question is a bot's access request, as `request_access` asks it. */
export function isBotAccessQuestion(question: { method: string; title?: string; options?: readonly string[] }): boolean {
  return question.method === "select" && (question.title ?? "").startsWith("Allow access to ")
    && question.options?.length === 2 && question.options[0] === BOT_ACCESS_ANSWERS[0] && question.options[1] === BOT_ACCESS_ANSWERS[1];
}

/** Who started a bot's turn, by the message that started it: a routine (`[routine: name] …`), another bot
 * (`[from @handle] …`), HUI's kickoff of a new bot, or else the operator. */
export type BotTurnOrigin = { kind: "operator" } | { kind: "kickoff" } | { kind: "routine"; name: string } | { kind: "bot"; handle: string };

export function botTurnOrigin(text: string | undefined): BotTurnOrigin {
  if (!text) return { kind: "operator" };
  if (text.startsWith("[routine: ")) return { kind: "routine", name: /^\[routine: (.*?)\] /u.exec(text)?.[1] ?? "" };
  const bot = /^\[from @([a-z0-9-]+)(?: · hop [1-9]\d*)?\] /u.exec(text);
  if (bot) return { kind: "bot", handle: bot[1]! };
  return botKickoffName(text) === undefined ? { kind: "operator" } : { kind: "kickoff" };
}

/* ── look ─────────────────────────────────────────────────────────────── */

export function isBotFaceShape(value: unknown): value is BotFaceShape {
  return typeof value === "string" && (BOT_FACE_SHAPES as readonly string[]).includes(value);
}

/** A shape by its id or its label (`pebble` is `round`), any case; undefined for anything else. */
export function botFaceShape(value: string): BotFaceShape | undefined {
  const key = value.trim().toLowerCase();
  return BOT_FACE_SHAPES.find((shape) => shape === key || BOT_FACE_SHAPE_LABELS[shape].toLowerCase() === key);
}

/** A palette color by its name (`mint`, any case) or hex; undefined for anything else. */
export function botFaceColor(value: string): BotFaceColor | undefined {
  const key = value.trim().toLowerCase();
  return BOT_FACE_COLORS.find((color) => color.id === key || color.hex === key);
}

/** A 32-bit hash of a bot's id (FNV-1a with a final mix): stable across renames, reloads and machines. */
export function botSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 0x01000193);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** What a bot looks like everywhere (roster, chat, call, CLI). `emoji` while it has one, else its face. */
export type BotLook = {
  kind: "face" | "emoji";
  emoji?: string;
  shape: BotFaceShape;
  /** #rrggbb: the face's body, the emoji's tile and the call's tint. */
  color: string;
  /** The shape or color comes from the id, not from the record. */
  derived: { shape: boolean; color: boolean };
  /** Seeds the plush texture, so the same bot has the same face everywhere. */
  seed: number;
};

/** The face a bot gets without a stored shape or color: picked by its id, the same everywhere. */
export function defaultBotLook(id: string): { shape: BotFaceShape; color: string } {
  const seed = botSeed(id);
  return {
    shape: BOT_FACE_SHAPES[seed % BOT_FACE_SHAPES.length]!,
    color: BOT_FACE_COLORS[Math.floor(seed / BOT_FACE_SHAPES.length) % BOT_FACE_COLORS.length]!.hex,
  };
}

export function botLook(bot: { id: string; avatar?: BotAvatar | undefined }): BotLook {
  const fallback = defaultBotLook(bot.id);
  const shape = isBotFaceShape(bot.avatar?.shape) ? bot.avatar.shape : undefined;
  const color = bot.avatar?.color && /^#[0-9a-f]{6}$/iu.test(bot.avatar.color) ? bot.avatar.color.toLowerCase() : undefined;
  return {
    kind: bot.avatar?.emoji ? "emoji" : "face",
    ...(bot.avatar?.emoji ? { emoji: bot.avatar.emoji } : {}),
    shape: shape ?? fallback.shape,
    color: color ?? fallback.color,
    derived: { shape: !shape, color: !color },
    seed: botSeed(bot.id),
  };
}

/** `Mint` for a palette color, the hex for any other. */
export function botColorName(hex: string): string {
  return botFaceColor(hex)?.label ?? hex;
}

/** The handle a name suggests: ASCII-folded and lowercase, every other run as one dash, at most 32 characters. */
export function handleFromName(name: string): string {
  const slug = name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+/u, "").slice(0, BOT_LIMITS.handle).replace(/-+$/u, "");
  return slug || "bot";
}

/** Where a bot works, as HUI shows it: `devbox:/srv/app` for a bot on a worker. */
export function botDisplayCwd(bot: Pick<BotView, "cwd" | "worker">): string {
  return bot.worker ? `${bot.worker.name}:${bot.cwd}` : bot.cwd;
}

/** One line: whitespace runs as single spaces, at most `max` characters (an ellipsis marks a cut). */
export function previewLine(text: string, max: number = BOT_LIMITS.preview): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
