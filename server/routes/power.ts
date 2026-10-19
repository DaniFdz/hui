/**
 * `GET/PUT /__hui/power`: the Mac's sleep prevention status and its lid-awake switch, over `power.ts` (`null` and
 * 404 off macOS). `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import type { MacPower } from "../power.ts";

const POWER_ROUTE = "/__hui/power";

export function createPowerRoutes(deps: { macPower: MacPower | undefined }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== POWER_ROUTE) return undefined;
    const { macPower } = deps;
    if (request.method === "GET") return { status: 200, body: { power: macPower?.status() ?? null } };
    if (request.method === "PUT") {
      const body = await request.json();
      const lidAwake = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["lidAwake"] : undefined;
      if (typeof lidAwake !== "boolean") return { status: 400, body: { error: "lidAwake must be a boolean" } };
      if (!macPower) return { status: 404, body: { error: "sleep prevention is only available on macOS" } };
      // Not awaited: turning it on waits on a macOS password dialog.
      void macPower.setLidAwake(lidAwake);
      return { status: 200, body: { power: macPower.status() } };
    }
    return { status: 405, body: { error: "method not allowed" } };
  }

  return { handle };
}
