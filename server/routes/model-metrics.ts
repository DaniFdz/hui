/**
 * `/__hui/model-metrics…`: HUI's persisted model-request measurements. A provider's window feeds the local-server
 * metrics dialog; a session's latest sample restores the composer after a reload. Measurements are HUI's own
 * observations (time to first token and completion), never model-server internals.
 */
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { ModelMetricError, ModelMetricSession, ModelMetricSummary } from "../api/model-metrics.ts";
import type { ModelMetricsStore } from "../model-metrics.ts";
export { routeSchemas } from "../api/model-metrics.ts";

const ROUTE = "/__hui/model-metrics";
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u;
const DEFAULT_MINUTES = 24 * 60;
const MAX_MINUTES = 7 * 24 * 60;

export function createModelMetricRoutes(deps: { store: ModelMetricsStore }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path, query } = request;
    if (path !== ROUTE && !path.startsWith(`${ROUTE}/`)) return undefined;
    try {
      const parts = path.slice(ROUTE.length).split("/").filter(Boolean);
      const [area, id] = parts;
      if (area === "providers" && id && parts.length === 2 && method === "GET") {
        if (!PROVIDER_ID.test(id)) return reply(ModelMetricError, { error: "Unknown provider." }, 400);
        const requested = Number(query.get("minutes") ?? DEFAULT_MINUTES);
        const minutes = Number.isFinite(requested) ? Math.min(MAX_MINUTES, Math.max(1, Math.round(requested))) : DEFAULT_MINUTES;
        const since = Date.now() - minutes * 60_000;
        return reply(ModelMetricSummary, await deps.store.summary(id, since));
      }
      if (area === "sessions" && id && parts.length === 2 && method === "GET") {
        if (!SESSION_ID.test(id)) return reply(ModelMetricError, { error: "Unknown session." }, 400);
        const metric = await deps.store.latestForSession(id);
        return reply(ModelMetricSession, metric ? { metric } : {});
      }
      return reply(ModelMetricError, { error: "method not allowed" }, 405);
    } catch {
      return reply(ModelMetricError, { error: "Model metrics are unavailable." }, 500);
    }
  }

  return { handle };
}
