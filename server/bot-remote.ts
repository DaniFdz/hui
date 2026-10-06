/**
 * Bots on remote workers (HUI-18), the gateway's half. A bot whose record names
 * a worker keeps its conversation and OptChat memory in that worker's Durable
 * store, where its chat runs as a remote session; these ports reach them
 * through the worker's host (`worker/host-bots.ts`). Only over a live
 * connection: an offline worker fails at once, named, and nothing here ever
 * connects one. Each memory's status arrives by subscription and is kept here,
 * so a bot list never waits on a worker.
 */
import type { BotMemoryStatus } from "../shared/bots.ts";
import { BotMemoryUnavailableError, type BotMemory } from "./bot-memory.ts";
import type { BotStoredMessage, BotWorkers, RemoteBotConversations } from "./bot-service.ts";
import { BotConflictError, BotInputError, BotWorkerOfflineError } from "./bots.ts";
import { BOT_MEMORY_STATUS_FRAME, BOTS_FEATURE } from "./worker/host-bots.ts";
import { WorkerOfflineError, type WorkerService } from "./workers.ts";

/** What these ports need of the worker service. */
export type BotWorkerLink = Pick<WorkerService, "list" | "nameOf" | "connected" | "features" | "hostRequest" | "onHostFrame" | "onClosed" | "onConnected">;

/** Creating a conversation may open the worker's store and read its models first. */
const CREATE_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** A list's background read of a chat's newest message. */
const LAST_MESSAGE_TIMEOUT_MS = 10_000;
const REFERENCE = /^durable:\d+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const count = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A status as the worker reported it, or undefined when it is not one: the roster never shows half a status. */
export function reportedStatus(value: unknown): BotMemoryStatus | undefined {
  if (!isRecord(value) || !isRecord(value["usage"])) return undefined;
  const usage = value["usage"];
  const numbers = ["messages", "built", "pending", "viewBytes", "viewLines"].map((key) => count(value[key]));
  const spent = ["calls", "input", "output", "cacheRead", "cacheWrite", "cost"].map((key) => count(usage[key]));
  if ([...numbers, ...spent].some((entry) => entry === undefined)) return undefined;
  const [messages, built, pending, viewBytes, viewLines] = numbers as number[];
  const [calls, input, output, cacheRead, cacheWrite, cost] = spent as number[];
  const failing = isRecord(value["failing"]) && typeof value["failing"]["error"] === "string" ? value["failing"] : undefined;
  return {
    messages: messages!, built: built!, pending: pending!, viewBytes: viewBytes!, viewLines: viewLines!,
    ...(value["waiting"] === true ? { waiting: true } : {}),
    ...(failing ? { failing: { node: String(failing["node"] ?? ""), error: String(failing["error"]), since: String(failing["since"] ?? "") } } : {}),
    usage: { calls: calls!, input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, cost: cost! },
  };
}

function storedMessage(value: unknown): BotStoredMessage | undefined {
  if (!isRecord(value) || (value["role"] !== "user" && value["role"] !== "assistant") || typeof value["text"] !== "string") return undefined;
  return { role: value["role"], text: value["text"], ...(typeof value["at"] === "string" ? { at: value["at"] } : {}) };
}

/** What each connected worker last reported about its bots' memories, and which it was asked to report. */
type Reports = { statuses: Map<string, BotMemoryStatus>; watched: Set<string>; queued: Set<string> };

export function remoteBots(workers: BotWorkerLink): BotWorkers {
  const name = (id: string) => workers.nameOf(id) ?? "That worker";
  /** Per worker, for its current connection only: a new one starts over. */
  const reports = new Map<string, Reports>();
  /** Live views of one memory (`BotMemory.subscribe`), kept across reconnects. */
  const listeners = new Map<string, Map<string, Set<(status: BotMemoryStatus) => void>>>();

  const offline = (id: string, creating: boolean) => new BotWorkerOfflineError(creating
    ? `HUI is not connected to ${name(id)}. Connect it in Settings → Workers, then create the bot again.`
    : `${name(id)}, where this bot runs, is offline: HUI is not connected to it. Connect it in Settings → Workers, then try again.`);

  /** One request to the worker's host: refused at once while HUI is not connected, or when the host predates bots. */
  async function request<T>(id: string, op: string, params: Record<string, unknown>, options: { timeoutMs?: number; creating?: boolean } = {}): Promise<T> {
    const creating = options.creating === true;
    const features = workers.features(id);
    if (!features) throw offline(id, creating);
    if (!features.includes(BOTS_FEATURE)) {
      throw new BotConflictError(`${name(id)} runs an older HUI worker that cannot run bots. Disconnect it in Settings → Workers and connect it again once its sessions are idle, so it runs this HUI's worker.`);
    }
    try {
      return await workers.hostRequest<T>(id, op, params, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    } catch (error) {
      // The connection went while the request was out.
      if (error instanceof WorkerOfflineError || !workers.connected(id)) throw offline(id, creating);
      throw error;
    }
  }

  const reportsOf = (id: string): Reports => {
    let own = reports.get(id);
    if (!own) reports.set(id, own = { statuses: new Map(), watched: new Set(), queued: new Set() });
    return own;
  };

  const report = (id: string, reference: string, status: BotMemoryStatus) => {
    if (!workers.connected(id)) return;
    reportsOf(id).statuses.set(reference, status);
    for (const listener of [...listeners.get(id)?.get(reference) ?? []]) listener(status);
  };

  /** Asks the worker to report a memory's status as it changes; every memory a list asks about at once goes in one request. */
  const watch = (id: string, reference: string) => {
    if (!REFERENCE.test(reference) || !(workers.features(id) ?? []).includes(BOTS_FEATURE)) return;
    const own = reportsOf(id);
    if (own.watched.has(reference)) return;
    own.watched.add(reference);
    own.queued.add(reference);
    if (own.queued.size > 1) return;
    setTimeout(() => {
      const references = [...own.queued];
      own.queued.clear();
      // The connection went meanwhile: the next one starts over.
      if (reports.get(id) !== own) return;
      workers.hostRequest(id, "bot.memory.watch", { references }, REQUEST_TIMEOUT_MS).catch(() => {
        for (const reference of references) own.watched.delete(reference);
      });
    }, 0);
  };

  workers.onHostFrame((id, frame) => {
    if (frame.t !== BOT_MEMORY_STATUS_FRAME || typeof frame["reference"] !== "string") return;
    const status = reportedStatus(frame["status"]);
    if (status) report(id, frame["reference"], status);
  });
  // An offline worker reports nothing: its bots show no memory until it is back.
  workers.onClosed((id) => reports.delete(id));
  workers.onConnected((id) => { for (const reference of listeners.get(id)?.keys() ?? []) watch(id, reference); });

  /** A memory read; the worker's own refusal (no memory for that chat there) is the routes' 503. */
  async function text(id: string, op: string, params: { reference: string } & Record<string, unknown>): Promise<string> {
    const reply = await request<{ text?: unknown; unavailable?: unknown; status?: unknown }>(id, op, params);
    if (typeof reply.unavailable === "string") throw new BotMemoryUnavailableError(reply.unavailable);
    if (typeof reply.text !== "string") throw new Error(`${name(id)} sent no memory.`);
    const status = reportedStatus(reply.status);
    if (status) {
      report(id, params.reference, status);
      watch(id, params.reference);
    }
    return reply.text;
  }

  return {
    async find(target) {
      const value = target.trim();
      const list = await workers.list();
      const byId = list.find((worker) => worker.id === value);
      const named = byId ? [byId] : list.filter((worker) => worker.name === value);
      if (named.length === 1) return { id: named[0]!.id, name: named[0]!.name };
      throw new BotInputError(named.length
        ? `${named.length} workers are named ${value}. Use its id: hui workers list --json.`
        : `No worker named ${value}. See Settings → Workers.`);
    },

    nameOf: (id) => workers.nameOf(id),

    conversations(id): RemoteBotConversations {
      return {
        async create(input) {
          const reply = await request<{ reference?: unknown; cwd?: unknown }>(id, "bot.create", { ...input }, { timeoutMs: CREATE_TIMEOUT_MS, creating: true });
          if (typeof reply.reference !== "string" || !REFERENCE.test(reply.reference) || typeof reply.cwd !== "string" || !reply.cwd.startsWith("/")) {
            throw new Error(`${name(id)} did not create the bot's conversation.`);
          }
          return { reference: reply.reference, cwd: reply.cwd };
        },
        async directory(cwd) {
          const reply = await request<{ cwd?: unknown }>(id, "bot.directory", { cwd });
          if (typeof reply.cwd !== "string" || !reply.cwd.startsWith("/")) throw new Error(`${name(id)} did not check the directory.`);
          return reply.cwd;
        },
        async configure(reference, change) {
          await request(id, "bot.configure", { reference, ...change });
        },
        async lastMessage(reference) {
          return storedMessage((await request<{ message?: unknown }>(id, "bot.last-message", { reference }, { timeoutMs: LAST_MESSAGE_TIMEOUT_MS })).message);
        },
        async writeCallRecord(reference, record) {
          await request(id, "bot.call-record", { reference, record });
        },
        async removeFolder(botId) {
          await request(id, "bot.remove-folder", { botId });
        },
      };
    },

    memory(id): BotMemory {
      return {
        enable: async () => { throw new Error("A worker turns on a bot's memory itself, in the commit that creates its conversation."); },
        async configure(reference, settings) {
          await request(id, "bot.memory.configure", { reference, settings });
        },
        // What the worker last reported; the first ask starts its reports and answers nothing yet.
        async status(reference) {
          watch(id, reference);
          return reports.get(id)?.statuses.get(reference);
        },
        view: (reference) => text(id, "bot.memory.view", { reference }),
        zoom: (reference, at, n) => text(id, "bot.memory.zoom", { reference, id: at, n }),
        html: (reference) => text(id, "bot.memory.html", { reference }),
        subscribe(reference, listener) {
          let byReference = listeners.get(id);
          if (!byReference) listeners.set(id, byReference = new Map());
          let set = byReference.get(reference);
          if (!set) byReference.set(reference, set = new Set());
          const own = set;
          own.add(listener);
          watch(id, reference);
          const known = reports.get(id)?.statuses.get(reference);
          if (known) queueMicrotask(() => { if (own.has(listener)) listener(known); });
          return () => {
            own.delete(listener);
            if (!own.size) byReference!.delete(reference);
          };
        },
      };
    },

    onConnected: (listener) => workers.onConnected(listener),
  };
}
