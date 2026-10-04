/**
 * `/__hui/workers` routes.
 *
 *   GET    /__hui/workers                       list with live state
 *   POST   /__hui/workers                       add { name, command, extraPaths? }
 *   PATCH  /__hui/workers/:id                   edit
 *   DELETE /__hui/workers/:id                   remove (no sessions may use it)
 *   POST   /__hui/workers/:id/connect           connect in the background
 *   POST   /__hui/workers/:id/sync              re-sync in the background
 *   POST   /__hui/workers/:id/disconnect
 */
import type { SessionRecord } from "./sessions.ts";
import { WorkerInputError, WorkerNotFoundError, type WorkerService } from "./workers.ts";

export const WORKERS_ROUTE = "/__hui/workers";
const ROUTE = /^\/__hui\/workers(?:\/([0-9a-f-]{36})(?:\/(connect|sync|disconnect))?)?$/u;

export type RouteResult = { status: number; body: unknown };

type Deps = {
  service: WorkerService;
  readRegistry(): Promise<SessionRecord[]>;
};

export function createWorkerRoutes(deps: Deps) {
  const { service } = deps;

  /** Background connect; the browser follows progress through the list. */
  const connectInBackground = (id: string, sync = false) => {
    void (sync ? service.sync(id) : service.connect(id)).catch(() => undefined);
  };

  async function handle(method: string, path: string, body: () => Promise<unknown>): Promise<RouteResult | undefined> {
    const match = ROUTE.exec(path);
    if (!match) return undefined;
    const [, id, action] = match;
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
      if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      await service.get(id);
      if (action === "disconnect") service.disconnect(id);
      else connectInBackground(id, action === "sync");
      return { status: action === "disconnect" ? 200 : 202, body: { ok: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worker request failed.";
      const status = error instanceof WorkerNotFoundError ? 404 : error instanceof WorkerInputError || error instanceof SyntaxError ? 400 : 502;
      return { status, body: { error: message } };
    }
  }

  return { handle };
}
