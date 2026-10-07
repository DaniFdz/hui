/**
 * HUI's bot registry (HUI-18).
 *
 * A bot is a named, persistent agent whose one chat is an ordinary Durable
 * session (its record carries `bot`). Only HUI writes this file; the chat's
 * conversation and OptChat memory stay in the Durable store.
 *
 *   ~/.config/hui/bots.json   { version: 1, bots: BotRecord[] }
 *
 * Writes go through a temporary file and a rename, and every read/modify/write
 * is serialized, like the session registry. A record that does not validate is
 * skipped, reported once and written back untouched, so a hand edit never
 * takes the gateway down or loses data. A file that is not JSON or comes from
 * a newer HUI is refused and never overwritten.
 *
 * A bot's persona is not here: it is SOUL.md in its home folder
 * (`bot-souls.ts`). Records from before SOUL.md may still carry
 * `instructions`: the registry keeps that field in the file, untouched by every
 * write, until `BotService.migrate` has turned it into SOUL.md and
 * `forgetInstructions` drops it.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { BOT_HANDLE, BOT_LIMITS, BOT_THINKING_LEVELS, handleFromName, NEW_BOT_NAME, type BotAvatar, type BotInput, type BotPatch, type BotRecord } from "../shared/bots.ts";
import { CONFIG_DIR } from "./paths.ts";

export const BOTS_FILE = join(CONFIG_DIR, "bots.json");
/** Default working directories, one per bot, created with it. */
export const BOTS_DIR = join(CONFIG_DIR, "bots");
export const BOTS_VERSION = 1;
/** Handles a route already uses: `/__hui/bots/events` is the list stream. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set(["events"]);

/** Rejected input: the route answers 400 with the message. */
export class BotInputError extends Error {
  override name = "BotInputError";
}

export class BotNotFoundError extends Error {
  override name = "BotNotFoundError";
}

/** The request is valid but the bot's state refuses it now (409). */
export class BotConflictError extends Error {
  override name = "BotConflictError";
}

/** bots.json cannot be read or written safely; it is left untouched. */
export class BotStoreError extends Error {
  override name = "BotStoreError";
}

const ID = /^[A-Za-z0-9_-]{1,100}$/u;
/** Only the first slash separates the provider; model ids may contain more. */
const MODEL = /^[^/\s]+\/\S+$/u;
const COLOR = /^#[0-9a-f]{6}$/u;
const CONTROL = /\p{Cc}/u;
const LEVELS: ReadonlySet<string> = new Set(BOT_THINKING_LEVELS);
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Exactly one user-perceived character (an emoji with its modifiers counts as one). */
export function isOneGrapheme(value: string): boolean {
  if (!value || value.length > 32 || CONTROL.test(value) || value.trim() !== value) return false;
  const segments = GRAPHEMES.segment(value)[Symbol.iterator]();
  return !segments.next().done && segments.next().done === true;
}

function storedAvatar(raw: unknown): BotAvatar | undefined {
  if (!isRecord(raw)) return undefined;
  const emoji = str(raw["emoji"]);
  const color = str(raw["color"]);
  const avatar = { ...(isOneGrapheme(emoji) ? { emoji } : {}), ...(COLOR.test(color) ? { color } : {}) };
  return Object.keys(avatar).length ? avatar : undefined;
}

/**
 * A stored record, or undefined when a required field is missing or invalid.
 * Optional fields that do not validate are dropped, so a bad color never hides
 * a bot.
 */
export function parseBotRecord(raw: unknown): BotRecord | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw["id"]);
  const handle = str(raw["handle"]);
  const name = str(raw["name"]).trim();
  const cwd = str(raw["cwd"]);
  const sessionId = str(raw["sessionId"]);
  const createdAt = str(raw["createdAt"]);
  const updatedAt = str(raw["updatedAt"]);
  if (!ID.test(id) || !BOT_HANDLE.test(handle) || !name || name.length > BOT_LIMITS.name || CONTROL.test(name)
    || !isAbsolute(cwd) || !ID.test(sessionId) || !createdAt || !updatedAt) return undefined;
  const text = (key: string, maximum: number): string | undefined => {
    const value = str(raw[key]);
    return value.trim() && value.length <= maximum ? value : undefined;
  };
  const model = (key: string): string | undefined => MODEL.test(str(raw[key])) ? str(raw[key]) : undefined;
  const level = (key: string): string | undefined => LEVELS.has(str(raw[key])) ? str(raw[key]) : undefined;
  const title = text("title", BOT_LIMITS.title);
  const description = text("description", BOT_LIMITS.description);
  const chatModel = model("model");
  const thinking = level("thinking");
  const memoryModel = model("memoryModel");
  const memoryThinking = level("memoryThinking");
  const avatar = storedAvatar(raw["avatar"]);
  return {
    id, handle, name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    cwd,
    ...(chatModel ? { model: chatModel } : {}),
    ...(thinking ? { thinking } : {}),
    ...(memoryModel ? { memoryModel } : {}),
    ...(memoryThinking ? { memoryThinking } : {}),
    ...(avatar ? { avatar } : {}),
    ...(raw["hidden"] === true ? { hidden: true } : {}),
    ...(raw["archived"] === true ? { archived: true } : {}),
    sessionId, createdAt, updatedAt,
  };
}

/** The `instructions` a record from before SOUL.md still carries, or undefined. */
function legacyInstructions(raw: unknown): string | undefined {
  const value = isRecord(raw) ? raw["instructions"] : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** `legacy`: bot id → the `instructions` its record still carries, written back with it until forgotten. */
type BotsFile = { bots: BotRecord[]; invalid: unknown[]; legacy: Map<string, string> };

export class BotRegistry {
  readonly file: string;
  readonly #onInvalid: (count: number) => void;
  #mutation: Promise<unknown> = Promise.resolve();
  #cache: readonly BotRecord[] = [];
  /** Invalid records last reported, so a lasting problem is reported once. */
  #reported = 0;

  constructor(file = BOTS_FILE, onInvalid: (count: number) => void = () => {}) {
    this.file = file;
    this.#onInvalid = onInvalid;
  }

  /** The list last read or written, for synchronous projections such as session views. */
  get cached(): readonly BotRecord[] {
    return this.#cache;
  }

  async #read(): Promise<BotsFile> {
    let source: string;
    try {
      source = await readFile(this.file, "utf8");
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") {
        this.#cache = [];
        return { bots: [], invalid: [], legacy: new Map() };
      }
      throw new BotStoreError("HUI's bot registry could not be read.", { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new BotStoreError("HUI's bot registry (bots.json) is not valid JSON. Fix or move it; HUI will not overwrite it.", { cause: error });
    }
    if (!isRecord(parsed) || !Array.isArray(parsed["bots"])) throw new BotStoreError("HUI's bot registry (bots.json) has an invalid shape.");
    if (typeof parsed["version"] === "number" && parsed["version"] > BOTS_VERSION) {
      throw new BotStoreError("bots.json was written by a newer HUI. Update HUI to manage these bots.");
    }
    const bots: BotRecord[] = [];
    const invalid: unknown[] = [];
    const legacy = new Map<string, string>();
    const ids = new Set<string>();
    const handles = new Set<string>();
    const sessions = new Set<string>();
    for (const raw of parsed["bots"]) {
      const bot = parseBotRecord(raw);
      // A duplicate would make addressing ambiguous: the first one wins, the rest are kept aside.
      if (!bot || ids.has(bot.id) || handles.has(bot.handle) || sessions.has(bot.sessionId)) {
        invalid.push(raw);
        continue;
      }
      ids.add(bot.id);
      handles.add(bot.handle);
      sessions.add(bot.sessionId);
      bots.push(bot);
      const instructions = legacyInstructions(raw);
      if (instructions !== undefined) legacy.set(bot.id, instructions);
    }
    if (invalid.length !== this.#reported) {
      this.#reported = invalid.length;
      if (invalid.length) this.#onInvalid(invalid.length);
    }
    this.#cache = bots;
    return { bots, invalid, legacy };
  }

  async list(): Promise<BotRecord[]> {
    return [...(await this.#read()).bots];
  }

  /** Bot id → the `instructions` its record still carries from before SOUL.md (`BotService.migrate`). */
  async legacyInstructions(): Promise<Map<string, string>> {
    return new Map((await this.#read()).legacy);
  }

  /** Drops a record's legacy `instructions` once they live on as its SOUL.md; nothing else changes. */
  forgetInstructions(id: string): Promise<void> {
    return this.#serialized(async () => {
      const current = await this.#read();
      if (!current.legacy.delete(id)) return;
      await this.#write(current.bots, current.invalid, current.legacy);
    });
  }

  /** Serialized read/modify/write. `mutate` returns the next list and a result; a failed write changes nothing. */
  update<T>(mutate: (bots: readonly BotRecord[]) => { bots: readonly BotRecord[]; result: T }): Promise<T> {
    return this.#serialized(async () => {
      const current = await this.#read();
      const { bots, result } = mutate(current.bots);
      await this.#write(bots, current.invalid, current.legacy);
      this.#cache = [...bots];
      return result;
    });
  }

  #serialized<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.#mutation.then(work);
    // A failed mutation must not poison the queue for later requests.
    this.#mutation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  /** Legacy `instructions` go back on their records (a deleted bot's go with it). */
  async #write(bots: readonly BotRecord[], invalid: readonly unknown[], legacy: ReadonlyMap<string, string>): Promise<void> {
    // A unique name: a slower writer must not clobber another's temporary file.
    const temporary = `${this.file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      // Personas can be private: owner-only, like the Durable store.
      const records = bots.map((bot) => legacy.has(bot.id) ? { ...bot, instructions: legacy.get(bot.id) } : bot);
      await writeFile(temporary, `${JSON.stringify({ version: BOTS_VERSION, bots: [...records, ...invalid] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw new BotStoreError("HUI's bot registry could not be written.", { cause: error });
    }
  }
}

/** `base`, or `base-2`, `base-3`… while another bot holds it, still within 32 characters. */
export function uniqueHandle(base: string, taken: ReadonlySet<string>): string {
  const free = (handle: string) => !taken.has(handle) && !RESERVED_HANDLES.has(handle);
  if (free(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, BOT_LIMITS.handle - tail.length).replace(/-+$/u, "")}${tail}`;
    if (free(candidate)) return candidate;
  }
}

/**
 * Whether `handle` is the one `name` gives a bot automatically: its slug, or that slug with the `-2`, `-3`… suffix
 * `uniqueHandle` adds. A renamed bot's handle follows the new name only while this holds; a chosen handle stays.
 */
export function isDerivedHandle(handle: string, name: string): boolean {
  const base = handleFromName(name);
  if (handle === base) return true;
  const match = /^(.+)-([1-9]\d*)$/u.exec(handle);
  if (!match || Number(match[2]) < 2) return false;
  const tail = `-${match[2]}`;
  return match[1] === base.slice(0, BOT_LIMITS.handle - tail.length).replace(/-+$/u, "");
}

/** A bot by id, handle (`@` optional, any case) or exact name; a name two bots share must be given as id or handle. */
export function findBot(bots: readonly BotRecord[], target: string): BotRecord {
  const value = target.trim();
  const byId = bots.find((bot) => bot.id === value);
  if (byId) return byId;
  const handle = value.replace(/^@/u, "").toLowerCase();
  const byHandle = bots.find((bot) => bot.handle === handle);
  if (byHandle) return byHandle;
  const named = bots.filter((bot) => bot.name === value);
  if (named.length === 1) return named[0]!;
  if (named.length) throw new BotConflictError(`${named.length} bots are named ${value}. Use a handle or an id.`);
  throw new BotNotFoundError(`No bot named ${value}.`);
}

const INPUT_KEYS = new Set([
  "name", "handle", "title", "description", "soul", "cwd", "model", "thinking", "memoryModel", "memoryThinking", "avatar", "hidden",
]);
const LABELS: Record<string, string> = {
  name: "Bot name", handle: "Bot handle", title: "Bot title", description: "Bot description", soul: "SOUL.md",
  cwd: "Working directory", model: "Bot model", thinking: "Thinking level", memoryModel: "Memory model", memoryThinking: "Memory thinking level",
};

function body(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BotInputError(`${what} must be an object.`);
  // A client from before SOUL.md: say where the persona went instead of only refusing the field.
  if ("instructions" in value) {
    throw new BotInputError("Bots have no instructions any more: a bot's persona is its SOUL.md, which it writes in its first conversation. Send soul when creating it, or PUT /__hui/bots/:id/soul.");
  }
  const unknown = Object.keys(value).filter((key) => !INPUT_KEYS.has(key));
  if (unknown.length) throw new BotInputError(`Unknown bot field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  return value;
}

/**
 * SOUL.md as `POST /__hui/bots` or `PUT /__hui/bots/:id/soul` gives it: text of
 * at most 20,000 characters, trimmed. `""` means none: the bot has (again) its
 * first conversation.
 */
export function normalizeSoul(raw: unknown): string {
  if (typeof raw !== "string") throw new BotInputError("SOUL.md must be text.");
  const value = raw.replace(/\r\n?/gu, "\n").trim();
  if (value.length > BOT_LIMITS.soul) throw new BotInputError(`SOUL.md must be at most ${BOT_LIMITS.soul} characters (it has ${value.length}).`);
  if (value.includes("\0")) throw new BotInputError("SOUL.md must be text.");
  return value;
}

function textField(raw: unknown, key: string, maximum: number, options: { line?: boolean; required?: boolean } = {}): string {
  if (typeof raw !== "string") throw new BotInputError(`${LABELS[key]} must be text.`);
  const value = raw.trim();
  if (options.required && !value) throw new BotInputError(`${LABELS[key]} must be 1-${maximum} characters.`);
  if (value.length > maximum) throw new BotInputError(`${LABELS[key]} must be ${options.required ? `1-${maximum}` : `at most ${maximum}`} characters.`);
  if (options.line && /[\r\n]|\p{Cc}/u.test(value)) throw new BotInputError(`${LABELS[key]} must be one line.`);
  return value;
}

/** `provider/id`, or `""` to clear it. */
function modelField(raw: unknown, key: string): string {
  const value = textField(raw, key, 200);
  if (!value) return "";
  if (!MODEL.test(value)) throw new BotInputError(`${LABELS[key]} must use provider/id format.`);
  return value;
}

/** A thinking level, or `""` to clear it. */
function levelField(raw: unknown, key: string): string {
  const value = textField(raw, key, 16);
  if (!value) return "";
  if (!LEVELS.has(value)) throw new BotInputError(`${LABELS[key]} must be one of: ${BOT_THINKING_LEVELS.join(", ")}.`);
  return value;
}

function handleField(raw: unknown): string {
  const value = textField(raw, "handle", BOT_LIMITS.handle, { line: true }).replace(/^@/u, "");
  if (!BOT_HANDLE.test(value)) {
    throw new BotInputError("Bot handle must be 1-32 lowercase letters, digits or dashes, without a leading or trailing dash.");
  }
  if (RESERVED_HANDLES.has(value)) throw new BotInputError(`@${value} is reserved; choose another handle.`);
  return value;
}

/** `{ emoji?, color? }`; `""` clears a key (kept as `""` so a patch can tell). */
function avatarField(raw: unknown): BotAvatar {
  if (!isRecord(raw)) throw new BotInputError("Avatar must be an object with emoji and/or color.");
  const unknown = Object.keys(raw).filter((key) => key !== "emoji" && key !== "color");
  if (unknown.length) throw new BotInputError(`Unknown avatar field: ${unknown.join(", ")}.`);
  const avatar: BotAvatar = {};
  if ("emoji" in raw) {
    if (typeof raw["emoji"] !== "string" || (raw["emoji"] !== "" && !isOneGrapheme(raw["emoji"]))) throw new BotInputError("Avatar emoji must be one character.");
    avatar.emoji = raw["emoji"];
  }
  if ("color" in raw) {
    const color = typeof raw["color"] === "string" ? raw["color"].toLowerCase() : undefined;
    if (color === undefined || (color !== "" && !COLOR.test(color))) throw new BotInputError("Avatar color must be #rrggbb.");
    avatar.color = color;
  }
  return avatar;
}

function cwdField(raw: unknown): string {
  const value = textField(raw, "cwd", 4_096, { required: true });
  if (value.includes("\0")) throw new BotInputError("Working directory must be a path.");
  return value;
}

/** Validates `POST /__hui/bots`. Optional text left empty is omitted. The directory is checked by the service. */
export function normalizeBotInput(value: unknown): BotInput {
  const input = body(value, "A bot");
  // Without a name the bot is "New Bot" until its first conversation names it (set_profile).
  const { soul: rawSoul, ...fields } = "name" in input ? input : { ...input, name: NEW_BOT_NAME };
  const soul = rawSoul === undefined ? "" : normalizeSoul(rawSoul);
  // The patch rules, then empty optional text and avatar keys dropped: a new bot has nothing to clear.
  const patch = normalizeBotPatch(fields);
  const result: BotInput = { name: patch.name! };
  if (patch.handle) result.handle = patch.handle;
  if (patch.title) result.title = patch.title;
  if (patch.description) result.description = patch.description;
  if (soul) result.soul = soul;
  if (patch.cwd) result.cwd = patch.cwd;
  if (patch.model) result.model = patch.model;
  if (patch.thinking) result.thinking = patch.thinking;
  if (patch.memoryModel) result.memoryModel = patch.memoryModel;
  if (patch.memoryThinking) result.memoryThinking = patch.memoryThinking;
  const avatar = patch.avatar ? patchedAvatar(undefined, patch.avatar) : undefined;
  if (avatar) result.avatar = avatar;
  if (patch.hidden) result.hidden = true;
  return result;
}

/** Validates `PATCH /__hui/bots/:id`: only the given fields, `""` where a field may be cleared. */
export function normalizeBotPatch(value: unknown): BotPatch {
  const input = body(value, "A bot change");
  if (!Object.keys(input).length) throw new BotInputError("Nothing to change.");
  if ("soul" in input) throw new BotInputError("Change a bot's SOUL.md with PUT /__hui/bots/:id/soul.");
  const patch: BotPatch = {};
  if ("name" in input) patch.name = textField(input["name"], "name", BOT_LIMITS.name, { line: true, required: true });
  if ("handle" in input) patch.handle = handleField(input["handle"]);
  if ("title" in input) patch.title = textField(input["title"], "title", BOT_LIMITS.title, { line: true });
  if ("description" in input) patch.description = textField(input["description"], "description", BOT_LIMITS.description);
  if ("cwd" in input) patch.cwd = cwdField(input["cwd"]);
  // `""` puts the chat back on the model or thinking level a new chat gets, and the memory on the chat's own model.
  if ("model" in input) patch.model = modelField(input["model"], "model");
  if ("thinking" in input) patch.thinking = levelField(input["thinking"], "thinking");
  if ("memoryModel" in input) patch.memoryModel = modelField(input["memoryModel"], "memoryModel");
  if ("memoryThinking" in input) patch.memoryThinking = levelField(input["memoryThinking"], "memoryThinking");
  if ("avatar" in input) patch.avatar = input["avatar"] === null ? null : avatarField(input["avatar"]);
  if ("hidden" in input) {
    if (typeof input["hidden"] !== "boolean") throw new BotInputError("Hidden must be a boolean.");
    patch.hidden = input["hidden"];
  }
  return patch;
}

/** The avatar after a patch: given keys replace, `""` clears a key, `null` clears both. */
export function patchedAvatar(current: BotAvatar | undefined, patch: BotAvatar | null): BotAvatar | undefined {
  if (patch === null) return undefined;
  const next = { ...current, ...patch };
  const avatar = { ...(next.emoji ? { emoji: next.emoji } : {}), ...(next.color ? { color: next.color } : {}) };
  return Object.keys(avatar).length ? avatar : undefined;
}
