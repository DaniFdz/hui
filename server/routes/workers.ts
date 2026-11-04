/**
 * `/__hui/workers` routes.
 *
 *   GET    /__hui/workers                       list with live state
 *   GET    /__hui/workers/metrics               each worker's own resources
 *   GET    /__hui/workers/metrics/history       their samples for the Dashboard's chart
 *   POST   /__hui/workers                       add { name, command, extraPaths? }
 *   PATCH  /__hui/workers/:id                   edit
 *   DELETE /__hui/workers/:id                   remove (no sessions may use it)
 *   POST   /__hui/workers/:id/connect           connect in the background
 *   POST   /__hui/workers/:id/sync              re-sync in the background
 *   POST   /__hui/workers/:id/disconnect
 */
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { WorkersResponse, WorkerResponse, WorkerActionResponse, WorkerError, WorkerMetricsResponse, WorkerMetricsHistoryResponse } from "../api/workers.ts";
export { routeSchemas } from "../api/workers.ts";
import type { SessionRecord } from "../sessions/sessions.ts";
import { WorkerInputError, WorkerNotFoundError, type WorkerService } from "../workers.ts";

export const WORKERS_ROUTE = "/__hui/workers";
const METRICS_ROUTE = `${WORKERS_ROUTE}/metrics`;
const METRICS_HISTORY_ROUTE = `${METRICS_ROUTE}/history`;
/** What the Dashboard's chart offers, and the most a worker's host keeps. */
const WINDOWS = [5, 15, 30];
const ROUTE = /^\/__hui\/workers(?:\/([0-9a-f-]{36})(?:\/(connect|sync|disconnect))?)?$/u;

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

  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method } = request;
    if (request.path === METRICS_ROUTE || request.path === METRICS_HISTORY_ROUTE) {
      if (method !== "GET") return reply(WorkerError, { error: "method not allowed" }, 405);
      const minutes = Number(request.query.get("minutes") ?? WINDOWS[0]);
      if (request.path === METRICS_HISTORY_ROUTE) {
        if (!WINDOWS.includes(minutes)) return reply(WorkerError, { error: `minutes must be one of ${WINDOWS.join(", ")}.` }, 400);
        const ids = request.query.get("ids")?.split(",").filter(Boolean);
        return reply(WorkerMetricsHistoryResponse, { workers: await service.metricsHistory(minutes, ids) });
      }
      return reply(WorkerMetricsResponse, { workers: await service.metrics() });
    }
    const match = ROUTE.exec(request.path);
    if (!match) return undefined;
    const [, id, action] = match;
    try {
      if (!id) {
        if (method === "GET") return reply(WorkersResponse, { workers: await service.list() });
        if (method === "POST") return reply(WorkerResponse, { worker: await service.create(await request.json() as never) }, 201);
        return reply(WorkerError, { error: "method not allowed" }, 405);
      }
      if (!action) {
        if (method === "PATCH") return reply(WorkerResponse, { worker: await service.update(id, await request.json() as never) });
        if (method === "DELETE") {
          const used = (await deps.readRegistry()).filter((record) => record.worker === id).length;
          if (used) return reply(WorkerError, { error: `${used} session${used === 1 ? "" : "s"} still run${used === 1 ? "s" : ""} on this worker. Delete them first.` }, 409);
          await service.remove(id);
          return reply(WorkerActionResponse, { ok: true });
        }
        return reply(WorkerError, { error: "method not allowed" }, 405);
      }
      if (method !== "POST") return reply(WorkerError, { error: "method not allowed" }, 405);
      await service.get(id);
      if (action === "disconnect") service.disconnect(id, true);
      else connectInBackground(id, action === "sync");
      return reply(WorkerActionResponse, { ok: true }, action === "disconnect" ? 200 : 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worker request failed.";
      const status = error instanceof WorkerNotFoundError ? 404 : error instanceof WorkerInputError || error instanceof SyntaxError ? 400 : 502;
      return reply(WorkerError, { error: message }, status);
    }
  }

  return { handle };
}
