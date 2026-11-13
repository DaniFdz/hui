/**
 * `POST /__hui/notifications/test`: publishes one message to the ntfy topic Settings → Notifications saves, so a phone
 * that subscribed can prove it hears this gateway. `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import { NotificationTestError, NotificationTestResponse, routeSchemas } from "../api/notifications.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export { routeSchemas };

const TEST_ROUTE = "/__hui/notifications/test";

export function createNotificationRoutes(deps: { sendTest(): Promise<void> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path !== TEST_ROUTE) return undefined;
    if (request.method !== "POST") return reply(NotificationTestError, { error: "method not allowed" }, 405);
    try {
      await deps.sendTest();
      return reply(NotificationTestResponse, { sent: true });
    } catch (error) {
      return reply(NotificationTestError, { error: error instanceof Error ? error.message : "The test notification failed." }, 400);
    }
  }

  return { handle };
}
