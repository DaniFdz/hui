/**
 * `GET/POST /__hui/update` (the installed release's status, and installing the stable version an update check
 * returned) and `GET/POST /__hui/update/check`, over `updates.ts`. `hui.ts` applies the `x-hui` guard before
 * dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { updates, UpdateConflict } from "../updates.ts";

const UPDATE_ROUTE = "/__hui/update";
const UPDATE_CHECK_ROUTE = "/__hui/update/check";

export function createUpdateRoutes() {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path !== UPDATE_ROUTE && path !== UPDATE_CHECK_ROUTE) return undefined;
    try {
      if (method === "GET" && path === UPDATE_ROUTE) return { status: 200, body: await updates.status() };
      if ((method === "GET" || method === "POST") && path === UPDATE_CHECK_ROUTE) return { status: 200, body: await updates.check(method === "GET") };
      if (method !== "POST" || path !== UPDATE_ROUTE) return { status: 405, body: { error: "method not allowed" } };
      let body: { version?: unknown } | null;
      try { body = await request.json() as { version?: unknown } | null; }
      catch { return { status: 400, body: { error: "Invalid update request body." } }; }
      if (!body || typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(body.version) || Object.keys(body).some((key) => key !== "version")) {
        return { status: 400, body: { error: "Provide only the stable version returned by the update check." } };
      }
      return { status: 202, body: await updates.start(body.version) };
    } catch (error) {
      return { status: error instanceof UpdateConflict ? 409 : 500, body: { error: error instanceof UpdateConflict ? error.message : "Update request failed. Check the gateway log and retry." } };
    }
  }

  return { handle };
}
