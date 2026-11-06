/**
 * The gateway's own diagnostics: `GET /__hui/health`, `POST /__hui/diagnostics/ui-errors` (the browser's error
 * reports, into `ui-errors.ts`), `GET /__hui/observability` and `GET /__hui/diagnostics/export` (the same snapshot
 * as a download), plus `GET /__hui/usage`, the Usage page's report over session histories (`usage.ts`) and
 * `POST /__hui/usage/investigate`, which starts a session that explains one expensive history
 * (`usage-investigation.ts`). `hui.ts` applies the `x-hui` guard before dispatching here and leaves these
 * routes' own successes out of the request diagnostics.
 */
import type { ServerResponse } from "node:http";
import { readGatewayHealth } from "../control-surfaces.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { DiagnosticsError, GatewayHealth, ObservabilitySnapshot, UiErrorReceipt, UsageInvestigation, UsageReport } from "../api/diagnostics.ts";
import type { UsageInvestigationRequest } from "../api/diagnostics.ts";
export { routeSchemas } from "../api/diagnostics.ts";
import { usageQuery, UsageQueryError, type UsageQuery } from "../usage.ts";
import { UsageInvestigationInputError, UsageInvestigationNotFoundError } from "../usage-investigation.ts";
import { parseUiErrorBatch, UI_ERROR_BODY_LIMIT, uiErrorLog } from "../ui-errors.ts";

export const HEALTH_ROUTE = "/__hui/health";
export const UI_ERRORS_ROUTE = "/__hui/diagnostics/ui-errors";
export const OBSERVABILITY_ROUTE = "/__hui/observability";
export const DIAGNOSTICS_EXPORT_ROUTE = "/__hui/diagnostics/export";
export const USAGE_ROUTE = "/__hui/usage";
export const USAGE_INVESTIGATE_ROUTE = "/__hui/usage/investigate";

export function createDiagnosticsRoutes(deps: {
  observability(): Promise<ObservabilitySnapshot>;
  usage(query: UsageQuery, refresh?: boolean): Promise<UsageReport>;
  investigate(request: UsageInvestigationRequest): Promise<UsageInvestigation>;
}) {
  async function handle(request: RouteRequest, response: ServerResponse): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path === HEALTH_ROUTE) {
      if (method === "GET") return reply(GatewayHealth, await readGatewayHealth());
      return reply(DiagnosticsError, { error: "method not allowed" }, 405);
    }
    if (path === UI_ERRORS_ROUTE) {
      if (method !== "POST") return reply(DiagnosticsError, { error: "method not allowed" }, 405);
      let batch: ReturnType<typeof parseUiErrorBatch>;
      try {
        batch = parseUiErrorBatch(await request.json(UI_ERROR_BODY_LIMIT));
      } catch (error) {
        return reply(DiagnosticsError, { error: error instanceof Error ? error.message : "Invalid UI error report." }, 400);
      }
      return reply(UiErrorReceipt, uiErrorLog.record(batch), 202);
    }
    if (path === OBSERVABILITY_ROUTE || path === DIAGNOSTICS_EXPORT_ROUTE) {
      if (method !== "GET") return reply(DiagnosticsError, { error: "method not allowed" }, 405);
      const snapshot = await deps.observability();
      if (path === DIAGNOSTICS_EXPORT_ROUTE) {
        response.setHeader("content-disposition", `attachment; filename="hui-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`);
      }
      return reply(ObservabilitySnapshot, snapshot);
    }
    if (path === USAGE_ROUTE) {
      if (method !== "GET") return reply(DiagnosticsError, { error: "method not allowed" }, 405);
      try {
        return reply(UsageReport, await deps.usage(usageQuery(request.query), request.query.get("refresh") === "1"));
      } catch (error) {
        if (!(error instanceof UsageQueryError)) throw error;
        return reply(DiagnosticsError, { error: error.message }, 400);
      }
    }
    if (path === USAGE_INVESTIGATE_ROUTE) {
      if (method !== "POST") return reply(DiagnosticsError, { error: "method not allowed" }, 405);
      const body = await request.json(8_192).catch(() => undefined);
      const parsed = parseInvestigation(body);
      if (typeof parsed === "string") return reply(DiagnosticsError, { error: parsed }, 400);
      try {
        const answered = await deps.investigate(parsed);
        return reply(UsageInvestigation, answered, answered.existing ? 200 : 201);
      } catch (error) {
        if (error instanceof UsageInvestigationNotFoundError) return reply(DiagnosticsError, { error: error.message }, 404);
        if (error instanceof UsageInvestigationInputError) return reply(DiagnosticsError, { error: error.message }, 400);
        throw error;
      }
    }
    return undefined;
  }

  return { handle };
}

/** Validates an investigation body without reading any history: the range is checked again by `usageQuery`. */
function parseInvestigation(body: unknown): UsageInvestigationRequest | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The investigation body must be an object.";
  const { target, range } = body as Record<string, unknown>;
  if (!target || typeof target !== "object" || Array.isArray(target)) return "target must name a session or a pull request.";
  const named = target as Record<string, unknown>;
  let checked: UsageInvestigationRequest["target"];
  if (named["kind"] === "session") {
    if (typeof named["id"] !== "string" || !named["id"].trim()) return "A session target needs its id.";
    checked = { kind: "session", id: named["id"].trim() };
  } else if (named["kind"] === "pullRequest") {
    const repository = named["repository"];
    const number = named["number"];
    if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) return "A pull request target needs a repository as owner/name.";
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return "A pull request target needs a positive number.";
    checked = { kind: "pullRequest", repository, number };
  } else {
    return "target.kind must be session or pullRequest.";
  }
  if (!range || typeof range !== "object" || Array.isArray(range)) return "range is required, with the time zone the report used.";
  const dates = range as Record<string, unknown>;
  if (typeof dates["timeZone"] !== "string" || !dates["timeZone"].trim()) return "range.timeZone is required.";
  for (const key of ["from", "to"] as const) {
    if (dates[key] !== undefined && typeof dates[key] !== "string") return `range.${key} must be a calendar day.`;
  }
  return {
    target: checked,
    range: {
      timeZone: dates["timeZone"].trim(),
      ...(typeof dates["from"] === "string" ? { from: dates["from"] } : {}),
      ...(typeof dates["to"] === "string" ? { to: dates["to"] } : {}),
    },
  };
}
