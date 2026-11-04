/**
 * `/__hui/ext`: the gateway extension surface. `GET` lists what is installed and enabled, `PUT` on one id records the
 * enable choice, and every deeper path belongs to that extension (`service.ts` answers it). The route module only
 * parses paths and bodies; the same `x-hui` gate and diagnostics hook that cover every other route cover these.
 */
import { ExtensionStatus, ExtensionsResponse, PluginError, routeSchemas as extensionRouteSchemas } from "../api/extensions.ts";
import { UnknownExtensionError, type ExtensionsService } from "../extensions/service.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export const routeSchemas = extensionRouteSchemas;

const STATUS_ROUTE = "/__hui/ext";
const EXTENSION_ROUTE = /^\/__hui\/ext\/([a-z][a-z0-9-]{0,31})(?:\/(.+))?$/u;

export function createExtensionRoutes(deps: { extensions: ExtensionsService }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path === STATUS_ROUTE) {
      if (request.method !== "GET") return reply(PluginError, { error: "method not allowed" }, 405);
      return reply(ExtensionsResponse, await deps.extensions.list());
    }
    const match = EXTENSION_ROUTE.exec(request.path);
    if (!match?.[1]) return undefined;
    const id = match[1];
    const subpath = match[2];
    if (subpath !== undefined) {
      return await deps.extensions.invoke({ id, method: request.method, subpath, request });
    }
    if (request.method !== "PUT") return reply(PluginError, { error: "method not allowed" }, 405);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply(PluginError, { error: "body must be JSON" }, 400);
    }
    const enabled = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)["enabled"]
      : undefined;
    if (typeof enabled !== "boolean") {
      return reply(PluginError, { error: "body must be { \"enabled\": boolean }" }, 400);
    }
    try {
      return reply(ExtensionStatus, await deps.extensions.setEnabled(id, enabled));
    } catch (error) {
      if (error instanceof UnknownExtensionError) return reply(PluginError, { error: error.message }, 404);
      throw error;
    }
  }

  return { handle };
}
