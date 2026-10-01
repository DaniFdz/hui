/**
 * `/__hui/workers` routes and the bot ↔ session bookkeeping around them.
 *
 *   GET    /__hui/workers                       list with live state
 *   POST   /__hui/workers                       add { name, command, extraPaths? }
 *   PATCH  /__hui/workers/:id                   edit
 *   DELETE /__hui/workers/:id                   remove (no sessions may use it)
 *   POST   /__hui/workers/:id/connect           connect in the background
 *   POST   /__hui/workers/:id/sync              re-sync in the background
 *   POST   /__hui/workers/:id/disconnect
 *   POST   /__hui/workers/:id/bots              create a bot and its session
 *   PATCH  /__hui/workers/:id/bots/:key         edit a bot
 *   DELETE /__hui/workers/:id/bots/:key         delete a bot and its session
 *   POST   /__hui/workers/:id/bots/:key/run     run a bot now
 *
 * A bot's HUI session id is its key on the host. The host owns the schedule
 * and transcript; HUI owns the sidebar row.
 */
import { randomUUID } from "node:crypto";
import type { SessionRecord } from "./sessions.ts";
import type { updateRegistry as UpdateRegistry } from "./sessions.ts";
import { WorkerInputError, WorkerNotFoundError, type WorkerService } from "./workers.ts";
import type { BotInput, WorkerBot } from "../shared/workers.ts";

export const WORKERS_ROUTE = "/__hui/workers";
export const BOTS_GROUP = "Bots";
const ROUTE = /^\/__hui\/workers(?:\/([0-9a-f-]{36})(?:\/(connect|sync|disconnect|bots)(?:\/([A-Za-z0-9_-]{1,80})(?:\/(run))?)?)?)?$/u;

export type RouteResult = { status: number; body: unknown };

type Deps = {
  service: WorkerService;
  readRegistry(): Promise<SessionRecord[]>;
  updateRegistry: typeof UpdateRegistry;
  sessions: { accept(id: string): void; ensure(record: SessionRecord): unknown; isLive(id: string): boolean };
  /** Removes a HUI session and its subagents (the ordinary delete path). */
  deleteSession(id: string): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function botInput(value: unknown): BotInput {
  if (!isRecord(value)) throw new WorkerInputError("A bot is required.");
  return value as BotInput;
}

function botRecord(workerId: string, bot: Pick<WorkerBot, "key" | "name" | "cwd" | "model" | "thinking">, now = new Date().toISOString()): SessionRecord {
  return {
    id: bot.key, title: bot.name, group: BOTS_GROUP, cwd: bot.cwd, worker: workerId, bot: true, tool: "pi",
    ...(bot.model ? { model: bot.model } : {}), ...(bot.thinking ? { thinking: bot.thinking } : {}),
    createdAt: now, updatedAt: now, source: "hui",
  };
}

export function createWorkerRoutes(deps: Deps) {
  const { service } = deps;

  /** Background connect; the browser follows progress through the list. */
  const connectInBackground = (id: string, sync = false) => {
    void (sync ? service.sync(id) : service.connect(id)).catch(() => undefined);
  };

  async function handle(method: string, path: string, body: () => Promise<unknown>): Promise<RouteResult | undefined> {
    const match = ROUTE.exec(path);
    if (!match) return undefined;
    const [, id, action, key, run] = match;
    try {
      if (!id) {
        if (method === "GET") return { status: 200, body: { workers: await service.list() } };
        if (method === "POST") return { status: 201, body: { worker: await service.create(await body() as never) } };
        return { status: 405, body: { error: "method not allowed" } };
      }
      if (!action) {
        if (method === "PATCH") return { status: 200, body: { worker: await service.update(id, await body() as never) } };
        if (method === "DELETE") {
          const used = (await deps.readRegistry()).filter((record) => record.worker === id).length;
          if (used) return { status: 409, body: { error: `${used} session${used === 1 ? "" : "s"} still run${used === 1 ? "s" : ""} on this worker. Delete them first.` } };
          await service.remove(id);
          return { status: 200, body: { ok: true } };
        }
        return { status: 405, body: { error: "method not allowed" } };
      }
      if (method !== "POST" && !(action === "bots" && key && !run && (method === "PATCH" || method === "DELETE"))) {
        return { status: 405, body: { error: "method not allowed" } };
      }
      if (action === "connect") { await service.get(id); connectInBackground(id); return { status: 202, body: { ok: true } }; }
      if (action === "sync") { await service.get(id); connectInBackground(id, true); return { status: 202, body: { ok: true } }; }
      if (action === "disconnect") { await service.get(id); service.disconnect(id); return { status: 200, body: { ok: true } }; }
      if (!key) {
        const input = botInput(await body());
        const botKey = randomUUID();
        const bot = await service.saveBot(id, botKey, input);
        try {
          // The host's bot list may have announced (and registered) it already.
          await deps.updateRegistry((records) => records.some((record) => record.id === botKey) ? records : [...records, botRecord(id, bot)]);
        } catch (error) {
          await service.deleteBot(id, botKey).catch(() => undefined);
          throw error;
        }
        deps.sessions.accept(botKey);
        return { status: 201, body: { bot } };
      }
      if (run) return { status: 202, body: { runId: await service.runBot(id, key) } };
      if (method === "PATCH") {
        const bot = await service.saveBot(id, key, botInput(await body()));
        return { status: 200, body: { bot } };
      }
      await service.deleteBot(id, key);
      if ((await deps.readRegistry()).some((record) => record.id === key)) await deps.deleteSession(key);
      return { status: 200, body: { ok: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worker request failed.";
      const status = error instanceof WorkerNotFoundError ? 404 : error instanceof WorkerInputError || error instanceof SyntaxError ? 400 : 502;
      return { status, body: { error: message } };
    }
  }

  /** Every bot gets a session row; a bot that starts running is attached so
   * its activity and unread state show in the sidebar. */
  async function onBots(workerId: string, bots: readonly WorkerBot[]): Promise<void> {
    const known = new Set((await deps.readRegistry()).map((record) => record.id));
    const missing = bots.filter((bot) => !known.has(bot.key));
    if (missing.length) {
      await deps.updateRegistry((records) => {
        const ids = new Set(records.map((record) => record.id));
        return [...records, ...missing.filter((bot) => !ids.has(bot.key)).map((bot) => botRecord(workerId, bot))];
      });
      for (const bot of missing) deps.sessions.accept(bot.key);
    }
    const running = bots.filter((bot) => bot.runs[0]?.status === "running" && !deps.sessions.isLive(bot.key));
    if (!running.length) return;
    const records = await deps.readRegistry();
    for (const bot of running) {
      const record = records.find((item) => item.id === bot.key && item.worker === workerId);
      if (record && !record.archived) deps.sessions.ensure(record);
    }
  }

  /** Deleting a bot's session also deletes the bot, so nothing keeps running
   * unseen. The worker must be reachable for that. */
  async function beforeSessionDelete(record: SessionRecord): Promise<void> {
    if (!record.bot || !record.worker) return;
    try {
      await service.deleteBot(record.worker, record.id);
    } catch (error) {
      if (error instanceof WorkerNotFoundError) return;
      throw new WorkerInputError(`Connect to the worker to delete this bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { handle, onBots, beforeSessionDelete };
}
