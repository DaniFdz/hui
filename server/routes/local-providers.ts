/**
 * `/__hui/local-providers…`: the custom providers from PI's models.json that HUI can start, their saved start command,
 * reachability and a manual start. `hui.ts` applies the `x-hui` guard before dispatching here. The command is local
 * configuration: it runs only when the operator presses Start, never from a model request.
 */
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { LocalProvider, LocalProviderError, LocalProviderOk, LocalProviderSnapshot } from "../api/local-providers.ts";
import { LocalProviderInputError, type LocalProviderService } from "../pi/local-providers.ts";
export { routeSchemas } from "../api/local-providers.ts";

const ROUTE = "/__hui/local-providers";
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;

export function createLocalProviderRoutes(deps: { service: LocalProviderService }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path !== ROUTE && !path.startsWith(`${ROUTE}/`)) return undefined;
    const { service } = deps;
    try {
      const parts = path.slice(ROUTE.length).split("/").filter(Boolean);
      const [id, action] = parts;
      if (!id && method === "GET") return reply(LocalProviderSnapshot, await service.snapshot());
      if (id && parts.length === 1 && method === "PUT") {
        if (!PROVIDER_ID.test(id)) throw new LocalProviderInputError("Unknown local provider.");
        const body = await request.json() as Record<string, unknown>;
        return reply(LocalProvider, await service.save(id, body));
      }
      if (id && parts.length === 1 && method === "DELETE") {
        if (!PROVIDER_ID.test(id)) throw new LocalProviderInputError("Unknown local provider.");
        await service.remove(id);
        return reply(LocalProviderOk, { ok: true });
      }
      if (id && action === "start" && parts.length === 2 && method === "POST") {
        if (!PROVIDER_ID.test(id)) throw new LocalProviderInputError("Unknown local provider.");
        return reply(LocalProvider, await service.start(id));
      }
      return reply(LocalProviderError, { error: "method not allowed" }, 405);
    } catch (error) {
      return reply(LocalProviderError,
        { error: error instanceof LocalProviderInputError ? error.message : "Local provider operation failed. Check the gateway and retry." },
        error instanceof LocalProviderInputError ? 400 : 500);
    }
  }

  return { handle };
}
