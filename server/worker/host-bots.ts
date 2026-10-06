/**
 * Bots on this worker (HUI-18): what a gateway asks the host for a bot whose
 * chat runs here. Its conversation and OptChat memory live in the host's own
 * Durable store, so these reuse the gateway's adapters (`bot-conversations.ts`
 * and `bot-memory.ts`) against the host's DurableHost: a bot's conversation is
 * created here exactly as the gateway creates a local one, its persona, its
 * `hui.bot` document and OptChat in one commit. A bot without a directory gets
 * a private folder under HUI's data directory here, as the gateway makes one
 * under its configuration. The bot itself (its record, routines, roster) stays
 * with the gateway; nothing here knows other bots.
 */
import { mkdir, rmdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { BOT_LIMITS, BOT_THINKING_LEVELS, type BotMemoryStatus } from "../../shared/bots.ts";
import { parseCallRecord } from "../../shared/calls.ts";
import { durableBotConversations } from "../bot-conversations.ts";
import { BotMemoryUnavailableError, optChatBotMemory, type BotMemorySettings } from "../bot-memory.ts";
import type { DurableHost } from "../runtimes/durable-host.ts";
import { durableConversationId } from "../runtimes/durable.ts";
import { resolveWorkingDirectory } from "../working-directories.ts";
import { isRecord, type Frame, type Peer } from "./protocol.ts";

/** What `hello` lists when the host can run bots, so a gateway tells an older host from this one. */
export const BOTS_FEATURE = "bots";
/** The frame a watched memory's status arrives in. */
export const BOT_MEMORY_STATUS_FRAME = "bot.memory.status";

const ID = /^[A-Za-z0-9_-]{1,100}$/u;
const MODEL = /^[^/\s]+\/\S+$/u;
const LEVELS: ReadonlySet<string> = new Set(BOT_THINKING_LEVELS);
/** References one watch may name; a gateway watches the bots it lists. */
const MAX_WATCHED = 1_000;

export type HostBotsOptions = {
  durable: DurableHost;
  /** The remote user's home, for `~/` directories. */
  home: string;
  /** Where private bot folders go: `<data dir>/bots/<bot id>`. */
  botsDir: string;
};

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

/** A memory read's answer: the text, or why this store cannot read the memory (the gateway answers 503 with it). */
type MemoryText = { text: string } | { unavailable: string };

function botId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error("A bot id is required.");
  return value;
}

/** A Durable resume reference of this store (`durable:N`). */
function reference(value: unknown): string {
  if (typeof value !== "string" || durableConversationId(value) === undefined) throw new Error("A bot's conversation reference is required.");
  return value;
}

function optionalText(value: unknown, maximum: number, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${what} must be text of at most ${maximum} characters.`);
  return value || undefined;
}

function optionalModel(value: unknown, what: string): string | undefined {
  const model = optionalText(value, 200, what);
  if (model !== undefined && !MODEL.test(model)) throw new Error(`${what} must use provider/id format.`);
  return model;
}

function optionalLevel(value: unknown, what: string): string | undefined {
  const level = optionalText(value, 16, what);
  if (level !== undefined && !LEVELS.has(level)) throw new Error(`${what} must be one of: ${BOT_THINKING_LEVELS.join(", ")}.`);
  return level;
}

function memorySettings(value: unknown): BotMemorySettings {
  if (!isRecord(value)) throw new Error("The bot's memory settings are required.");
  const name = optionalText(value["name"], BOT_LIMITS.name, "The bot's name");
  if (!name) throw new Error("The bot's name is required.");
  const model = optionalModel(value["model"], "The utility model");
  const thinking = optionalLevel(value["thinking"], "The memory thinking level");
  return { name, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

/** The bots a gateway runs on this host: request handlers for each connected gateway, and the memories it watches. */
export function hostBots(options: HostBotsOptions) {
  const memory = optChatBotMemory(options.durable);
  const conversations = durableBotConversations(options.durable, memory);
  /** Each gateway's watched memories, so their status reaches it as it changes. */
  const watches = new Map<Peer, Map<string, () => void>>();

  /** A directory here: `~/` is the remote user's home; it must exist. */
  const directory = async (value: unknown): Promise<string> => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error("A directory on the worker is required.");
    const given = value.trim();
    if (!given.startsWith("/") && given !== "~" && !given.startsWith("~/")) throw new Error("A directory on a worker must be absolute or start with ~/.");
    const path = resolveWorkingDirectory(given, options.home);
    if (!isAbsolute(path)) throw new Error("A directory on a worker must be absolute or start with ~/.");
    const info = await stat(path).catch(() => undefined);
    if (!info) throw new Error(`No such directory on the remote: ${path}`);
    if (!info.isDirectory()) throw new Error(`Not a directory on the remote: ${path}`);
    return path;
  };

  /** A memory read, with OptChat's own refusal (no memory for that chat here) as an answer instead of a failure. */
  const memoryText = async (read: () => Promise<string>): Promise<MemoryText> => {
    try {
      return { text: await read() };
    } catch (error) {
      if (error instanceof BotMemoryUnavailableError) return { unavailable: error.message };
      throw error;
    }
  };

  const detach = (peer: Peer) => {
    const watched = watches.get(peer);
    watches.delete(peer);
    for (const stop of watched?.values() ?? []) stop();
  };

  /** The handlers for one gateway's connection. */
  function handlers(peer: Peer): Record<string, Handler> {
    return {
      /** Creates the bot's conversation in one commit, in the given directory or a private folder made for it. */
      "bot.create": async (params) => {
        const id = botId(params["botId"]);
        const settings = memorySettings(params["memory"]);
        const model = optionalModel(params["model"], "The bot's model");
        const thinking = optionalLevel(params["thinking"], "The thinking level");
        const instructions = optionalText(params["instructions"], BOT_LIMITS.instructions, "The bot's instructions");
        let created: string | undefined;
        let cwd: string;
        if (params["cwd"] !== undefined) cwd = await directory(params["cwd"]);
        else {
          created = join(options.botsDir, id);
          await mkdir(created, { recursive: true, mode: 0o700 });
          cwd = created;
        }
        try {
          const reference = await conversations.create({
            botId: id, cwd,
            ...(model ? { model } : {}),
            ...(thinking ? { thinking } : {}),
            ...(instructions ? { instructions } : {}),
            memory: settings,
          });
          return { reference, cwd };
        } catch (error) {
          // Only the empty folder this request made goes.
          if (created) await rmdir(created).catch(() => {});
          throw error;
        }
      },
      "bot.directory": async (params) => ({ cwd: await directory(params["cwd"]) }),
      "bot.configure": async (params) => {
        const instructions = params["instructions"] === null ? null : optionalText(params["instructions"], BOT_LIMITS.instructions, "The bot's instructions");
        const cwd = params["cwd"] === undefined ? undefined : await directory(params["cwd"]);
        await conversations.configure(reference(params["reference"]), {
          ...(params["instructions"] !== undefined ? { instructions: instructions ?? null } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
        });
        return {};
      },
      "bot.last-message": async (params) => {
        const message = await conversations.lastMessage(reference(params["reference"]));
        return message ? { message } : {};
      },
      "bot.call-record": async (params) => {
        const record = parseCallRecord(params["record"]);
        if (!record) throw new Error("The call's record is not valid.");
        await conversations.writeCallRecord(reference(params["reference"]), record);
        return {};
      },
      /** Only the folder this host made for the bot, and only while it is empty: the bot's files never go. */
      "bot.remove-folder": async (params) => {
        const removed = await rmdir(join(options.botsDir, botId(params["botId"]))).then(() => true, () => false);
        return { removed };
      },
      "bot.memory.configure": async (params) => {
        await memory.configure(reference(params["reference"]), memorySettings(params["settings"]));
        return {};
      },
      "bot.memory.status": async (params) => {
        const status = await memory.status(reference(params["reference"]));
        return status ? { status } : {};
      },
      // With the status after the view caught up, so the gateway's copy counts the messages the view shows.
      "bot.memory.view": async (params) => {
        const read = reference(params["reference"]);
        const answer = await memoryText(() => memory.view(read));
        const status = "text" in answer ? await memory.status(read) : undefined;
        return { ...answer, ...(status ? { status } : {}) };
      },
      "bot.memory.zoom": async (params) => {
        const at = Number(params["id"]);
        const n = Number(params["n"]);
        if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(n) || n < 1) throw new Error("Zoom needs a message id (0 or more) and a span n (1 or more).");
        return memoryText(() => memory.zoom(reference(params["reference"]), at, n));
      },
      "bot.memory.html": async (params) => memoryText(() => memory.html(reference(params["reference"]))),
      /** These memories' status goes to this gateway as it changes, the current one first, until it disconnects. */
      "bot.memory.watch": async (params) => {
        const references = (Array.isArray(params["references"]) ? params["references"] : []).slice(0, MAX_WATCHED).map(reference);
        let watched = watches.get(peer);
        if (!watched) {
          watched = new Map();
          watches.set(peer, watched);
          peer.onClose(() => detach(peer));
        }
        for (const watchedReference of references) {
          if (watched.has(watchedReference)) continue;
          watched.set(watchedReference, memory.subscribe(watchedReference, (status: BotMemoryStatus) => {
            peer.send({ t: BOT_MEMORY_STATUS_FRAME, reference: watchedReference, status } satisfies Frame);
          }));
        }
        return {};
      },
    };
  }

  return {
    handlers,
    /** Ends every watch, as the host stops. */
    close(): void {
      for (const peer of [...watches.keys()]) detach(peer);
    },
  };
}
