/** `GET /__hui/host-metrics`: the gateway host's resource use from `host-metrics.ts`. `hui.ts` applies the `x-hui`
 * guard before dispatching here. */
import { HostMetrics, HostMetricsError } from "../api/host.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export { routeSchemas } from "../api/host.ts";

const HOST_METRICS_ROUTE = "/__hui/host-metrics";

export function createHostMetricsRoutes(deps: { hostMetrics: () => Promise<HostMetrics> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== HOST_METRICS_ROUTE) return undefined;
    if (request.method !== "GET") return reply(HostMetricsError, { error: "method not allowed" }, 405);
    return reply(HostMetrics, await deps.hostMetrics());
  }

  return { handle };
}
