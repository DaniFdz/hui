/**
 * `/__hui/notifications/…`: the ntfy test route, plus Web Push — the gateway's VAPID public key with the devices that
 * subscribed, subscribing this browser, forgetting one, and one test push. A subscription's endpoint is a capability
 * URL and its keys are secrets, so no refusal here repeats what the body carried. `hui.ts` applies the `x-hui` guard
 * before dispatching here.
 */
import type { Static, TSchema } from "typebox";
import Value from "typebox/value";
import {
  NotificationTestError,
  NotificationTestResponse,
  PushError,
  PushStatusResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushTestResponse,
  PushUnsubscribeRequest,
  PushUnsubscribeResponse,
  routeSchemas,
} from "../api/notifications.ts";
import { isLoopbackEndpointHost, type PushSubscriptionRecord } from "../notifications/push.ts";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";

export { routeSchemas };

const TEST_ROUTE = "/__hui/notifications/test";
const PUSH_ROUTE = "/__hui/notifications/push";
const PUSH_SUBSCRIBE_ROUTE = "/__hui/notifications/push/subscribe";
const PUSH_UNSUBSCRIBE_ROUTE = "/__hui/notifications/push/unsubscribe";
const PUSH_TEST_ROUTE = "/__hui/notifications/push/test";

/**
 * What a push endpoint must be: `https:` with a host, and no credentials hidden in it. The one other address accepted is
 * a loopback `http:` one, the same predicate the store and `publishPush` use, so HUI's own tests can stand a push
 * service up on this machine; every other `http:` address is refused, which is the sentence this route answers with.
 */
function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (!url.hostname || url.username || url.password) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackEndpointHost(url.hostname));
  } catch {
    return false;
  }
}

/** A body that is JSON and matches the route's schema, or nothing when it is neither. */
async function readBody<S extends TSchema>(request: RouteRequest, schema: S): Promise<Static<S> | undefined> {
  try {
    return Value.Parse(schema, await request.json());
  } catch {
    return undefined;
  }
}

export function createNotificationRoutes(deps: {
  sendTest(): Promise<void>;
  /** The public key a browser subscribes with and the subscribed devices, never their endpoints. */
  pushStatus(): Promise<PushStatusResponse>;
  /** Registers one browser and answers the device id its endpoint digests to. */
  subscribe(subscription: PushSubscriptionRecord & { device?: string }): Promise<string>;
  /** Forgets one browser, and says whether it was subscribed at all. */
  unsubscribe(endpoint: string): Promise<boolean>;
  /** Publishes one test push to every subscribed device. */
  sendTestPush(): Promise<PushTestResponse>;
}) {
  /** Answers the push paths this module owns, and nothing for any other path. */
  async function push(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path === PUSH_ROUTE) {
      if (request.method !== "GET") return reply(PushError, { error: "method not allowed" }, 405);
      return reply(PushStatusResponse, await deps.pushStatus());
    }
    if (request.path === PUSH_TEST_ROUTE) {
      if (request.method !== "POST") return reply(PushError, { error: "method not allowed" }, 405);
      try {
        return reply(PushTestResponse, await deps.sendTestPush());
      } catch (error) {
        return reply(PushError, { error: error instanceof Error ? error.message : "The test push failed." }, 400);
      }
    }
    if (request.path === PUSH_SUBSCRIBE_ROUTE) {
      if (request.method !== "POST") return reply(PushError, { error: "method not allowed" }, 405);
      const body = await readBody(request, PushSubscribeRequest);
      if (!body) return reply(PushError, { error: "body must be { \"endpoint\": string, \"keys\": { \"p256dh\": string, \"auth\": string } }" }, 400);
      if (!isPushEndpoint(body.endpoint)) return reply(PushError, { error: "A push subscription endpoint must be an https: URL." }, 400);
      const device = body.device?.trim();
      const id = await deps.subscribe({ endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, ...(device ? { device } : {}) });
      return reply(PushSubscribeResponse, { subscribed: true, id });
    }
    if (request.path !== PUSH_UNSUBSCRIBE_ROUTE) return undefined;
    if (request.method !== "POST") return reply(PushError, { error: "method not allowed" }, 405);
    const body = await readBody(request, PushUnsubscribeRequest);
    if (!body) return reply(PushError, { error: "body must be { \"endpoint\": string }" }, 400);
    return reply(PushUnsubscribeResponse, { removed: await deps.unsubscribe(body.endpoint) });
  }

  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path === PUSH_ROUTE || request.path.startsWith(`${PUSH_ROUTE}/`)) {
      const answered = await push(request);
      if (answered) return answered;
    }
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
