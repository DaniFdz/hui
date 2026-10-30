/**
 * `POST /__hui/app/open`: brings the installed HUI desktop app forward on a chat, which is what a `?open=app` link
 * asks for, because a browser cannot start another program without a click. `hui.ts` applies the `x-hui` guard before
 * dispatching here.
 */
import { AppOpenError, AppOpenResponse, routeSchemas as appRouteSchemas } from "../api/app.ts";
import type { RouteSchema } from "../api/index.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export const routeSchemas: RouteSchema[] = appRouteSchemas;

const APP_OPEN_ROUTE = "/__hui/app/open";
/** A chat this gateway serves, and nothing else: the app turns it back into the `hui://` link it was given. */
const CHAT_PATH = /^\/(?:sessions|bots)\/[^\s/]{1,200}$/u;

export function createAppRoutes(deps: { openChatInApp: (path: string) => Promise<void> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== APP_OPEN_ROUTE) return undefined;
    if (request.method !== "POST") return reply(AppOpenError, { error: "method not allowed" }, 405);
    const body = await request.json();
    const path = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["path"] : undefined;
    if (typeof path !== "string" || !CHAT_PATH.test(path)) {
      return reply(AppOpenError, { error: "path must be a chat this gateway serves, such as /sessions/<id>" }, 400);
    }
    try {
      await deps.openChatInApp(path);
    } catch (error) {
      return reply(AppOpenError, { error: error instanceof Error ? error.message : String(error) }, 503);
    }
    return reply(AppOpenResponse, { opened: true });
  }

  return { handle };
}
