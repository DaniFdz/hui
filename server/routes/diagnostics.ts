/**
 * The gateway's own diagnostics: `GET /__hui/health`, `POST /__hui/diagnostics/ui-errors` (the browser's error
 * reports, into `ui-errors.ts`), `GET /__hui/observability` and `GET /__hui/diagnostics/export` (the same snapshot
 * as a download). `hui.ts` applies the `x-hui` guard before dispatching here and leaves these routes' own
 * successes out of the request diagnostics.
 */
import type { ServerResponse } from "node:http";
import { readGatewayHealth } from "../control-surfaces.ts";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { parseUiErrorBatch, UI_ERROR_BODY_LIMIT, uiErrorLog } from "../ui-errors.ts";

export const HEALTH_ROUTE = "/__hui/health";
export const UI_ERRORS_ROUTE = "/__hui/diagnostics/ui-errors";
export const OBSERVABILITY_ROUTE = "/__hui/observability";
export const DIAGNOSTICS_EXPORT_ROUTE = "/__hui/diagnostics/export";

export function createDiagnosticsRoutes(deps: { observability(): Promise<unknown> }) {
  async function handle(request: RouteRequest, response: ServerResponse): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path === HEALTH_ROUTE) {
      if (method === "GET") return { status: 200, body: await readGatewayHealth() };
      return { status: 405, body: { error: "method not allowed" } };
    }
    if (path === UI_ERRORS_ROUTE) {
      if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      let batch: ReturnType<typeof parseUiErrorBatch>;
      try {
        batch = parseUiErrorBatch(await request.json(UI_ERROR_BODY_LIMIT));
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : "Invalid UI error report." } };
      }
      return { status: 202, body: uiErrorLog.record(batch) };
    }
    if (path === OBSERVABILITY_ROUTE || path === DIAGNOSTICS_EXPORT_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      const snapshot = await deps.observability();
      if (path === DIAGNOSTICS_EXPORT_ROUTE) {
        response.setHeader("content-disposition", `attachment; filename="hui-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`);
      }
      return { status: 200, body: snapshot };
    }
    return undefined;
  }

  return { handle };
}
