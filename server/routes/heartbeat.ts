/**
 * `POST /__hui/heartbeat`: run the gateway heartbeat now, for an operator who wants the watched sessions checked
 * without waiting for the 15-minute interval. It only prompts watched sessions; it starts no bot turn.
 */
import { HeartbeatRun, routeSchemas } from "../api/heartbeat.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export { routeSchemas };

export function createHeartbeatRoutes(deps: { heartbeat: { scan(): Promise<{ continued: string[] }> } }) {
  return async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== "/__hui/heartbeat") return undefined;
    if (request.method !== "POST") return reply(HeartbeatRun, { continued: [] }, 405);
    return reply(HeartbeatRun, await deps.heartbeat.scan());
  };
}
