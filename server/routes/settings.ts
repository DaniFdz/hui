/**
 * `GET/PUT /__hui/settings`: the gateway's HUI settings. Saving goes through `hui.ts`'s `writeSettings`, which also
 * applies the changed settings to the running services. `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { readHuiSettings } from "../hui-settings.ts";

const SETTINGS_ROUTE = "/__hui/settings";

export function createSettingsRoutes(deps: { writeSettings(raw: unknown): Promise<unknown> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== SETTINGS_ROUTE) return undefined;
    if (request.method === "GET") return { status: 200, body: await readHuiSettings() };
    if (request.method === "PUT") return { status: 200, body: await deps.writeSettings(await request.json()) };
    return { status: 405, body: { error: "method not allowed" } };
  }

  return { handle };
}
