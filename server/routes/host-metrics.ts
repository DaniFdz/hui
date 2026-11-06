/** `GET /__hui/host-metrics` for this machine's resource use, and `GET /__hui/host-metrics/history?minutes=` for the
 * samples its chart draws, both from `host-metrics.ts`. `hui.ts` applies the `x-hui` guard before dispatching here. */
import { HostMetrics, HostMetricsError, HostMetricsHistory } from "../api/host.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export { routeSchemas } from "../api/host.ts";

const METRICS_ROUTE = "/__hui/host-metrics";
const HISTORY_ROUTE = `${METRICS_ROUTE}/history`;
/** What the chart offers, and the most the sampler keeps. */
const WINDOWS = [5, 15, 30];

export function createHostMetricsRoutes(deps: { hostMetrics: () => Promise<HostMetrics>; history: (minutes: number) => HostMetrics[] }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path === HISTORY_ROUTE) {
      if (request.method !== "GET") return reply(HostMetricsError, { error: "method not allowed" }, 405);
      const minutes = Number(request.query.get("minutes") ?? WINDOWS[0]);
      if (!WINDOWS.includes(minutes)) return reply(HostMetricsError, { error: `minutes must be one of ${WINDOWS.join(", ")}.` }, 400);
      return reply(HostMetricsHistory, { history: deps.history(minutes) });
    }
    if (request.path !== METRICS_ROUTE) return undefined;
    if (request.method !== "GET") return reply(HostMetricsError, { error: "method not allowed" }, 405);
    return reply(HostMetrics, await deps.hostMetrics());
  }

  return { handle };
}
