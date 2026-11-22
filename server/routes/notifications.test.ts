import { createECDH, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import { expectSchema } from "../test-support/api-schema.ts";
import {
  NotificationTestResponse,
  PushStatusResponse,
  PushSubscribeResponse,
  PushTestResponse,
  PushUnsubscribeResponse,
} from "../api/notifications.ts";
import { addPushSubscription, listPushSubscriptions, pushSubscriptionId, removePushSubscription, vapidKeys } from "../notifications/push-store.ts";
import { createNotificationRoutes } from "./notifications.ts";

/** A push service's endpoint is a capability URL: its marker must never come back in any answer. */
const ENDPOINT = "https://push.example.com/send/capability-secret-token";
const KEYS = {
  p256dh: (() => { const pair = createECDH("prime256v1"); pair.generateKeys(); return pair.getPublicKey().toString("base64url"); })(),
  auth: randomBytes(16).toString("base64url"),
};

function request(method: string, path = "/__hui/notifications/test", body: unknown = {}): RouteRequest {
  return {
    method, path, query: new URLSearchParams(), headers: {}, signal: new AbortController().signal,
    json: async () => body, bytes: async () => Buffer.alloc(0), stream: () => (async function* () {})(),
  };
}

/** A request whose body is not JSON at all, the way a truncated or non-HTTP client sends it. */
function unparseable(method: string, path: string): RouteRequest {
  return { ...request(method, path), json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); } };
}

type NotificationRouteDeps = Parameters<typeof createNotificationRoutes>[0];

/** The real push store and the real VAPID keys, in a temporary config directory: nothing here is mocked. */
async function deps(directory: string, overrides: Partial<NotificationRouteDeps> = {}): Promise<NotificationRouteDeps> {
  return {
    sendTest: async () => undefined,
    pushStatus: async () => ({
      publicKey: (await vapidKeys(directory)).publicKey,
      devices: (await listPushSubscriptions(directory)).map(({ id, createdAt, device }) => ({ id, createdAt, ...(device ? { device } : {}) })),
    }),
    subscribe: async (subscription) => (await addPushSubscription(subscription, directory)).id,
    unsubscribe: async (endpoint) => {
      if (!(await listPushSubscriptions(directory)).some((subscription) => subscription.endpoint === endpoint)) return false;
      await removePushSubscription(endpoint, directory);
      return true;
    },
    sendTestPush: async () => ({ sent: 1, devices: 1 }),
    ...overrides,
  };
}

/** Every answer is checked as it is produced: an endpoint, a subscription key and the signing key never come back. */
async function reached(routes: ReturnType<typeof createNotificationRoutes>, request: RouteRequest) {
  const answered = await routes.handle(request);
  const body = JSON.stringify(answered?.body ?? null);
  for (const secret of [ENDPOINT, "capability-secret-token", KEYS.p256dh, KEYS.auth]) {
    assert.equal(body.includes(secret), false, `an answer repeated ${secret === ENDPOINT ? "the endpoint" : "a subscription key"}: ${body}`);
  }
  return answered;
}

test("the test route publishes one message and reports the relay's own refusal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-push-routes-"));
  const routes = createNotificationRoutes(await deps(directory));
  assert.equal(await routes.handle(request("GET", "/__hui/elsewhere")), undefined, "another route is not this one");

  const answered = await reached(routes, request("POST"));
  assert.equal(answered?.status, 200);
  expectSchema(NotificationTestResponse, answered?.body);
  assert.equal((await reached(routes, request("GET")))?.status, 405);

  const refused = createNotificationRoutes(await deps(directory, { sendTest: async () => { throw new Error("ntfy answered HTTP 403 for the configured topic."); } }));
  const failure = await reached(refused, request("POST"));
  assert.equal(failure?.status, 400);
  assert.deepEqual(failure?.body, { error: "ntfy answered HTTP 403 for the configured topic." });
  await rm(directory, { recursive: true, force: true });
});

test("a browser subscribes, is listed by its own digest, and is forgotten again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-push-routes-"));
  const routes = createNotificationRoutes(await deps(directory));

  const empty = await reached(routes, request("GET", "/__hui/notifications/push"));
  assert.equal(empty?.status, 200);
  expectSchema(PushStatusResponse, empty?.body);
  const { publicKey, devices } = empty?.body as PushStatusResponse;
  assert.deepEqual(devices, [], "nothing subscribed yet");
  assert.equal(Buffer.from(publicKey, "base64url").length, 65, "the uncompressed P-256 point a browser subscribes with");
  assert.equal(publicKey, (await vapidKeys(directory)).publicKey);
  assert.equal(JSON.stringify(empty?.body).includes((await vapidKeys(directory)).privateKey), false, "the signing key never leaves the config directory");

  const subscribed = await reached(routes, request("POST", "/__hui/notifications/push/subscribe", { endpoint: ENDPOINT, keys: KEYS, device: "Pixel" }));
  assert.equal(subscribed?.status, 200);
  expectSchema(PushSubscribeResponse, subscribed?.body);
  assert.deepEqual(subscribed?.body, { subscribed: true, id: pushSubscriptionId(ENDPOINT) });

  const listed = await reached(routes, request("GET", "/__hui/notifications/push"));
  expectSchema(PushStatusResponse, listed?.body);
  assert.deepEqual((listed?.body as PushStatusResponse).devices.map(({ id, device }) => ({ id, device })), [
    { id: pushSubscriptionId(ENDPOINT), device: "Pixel" },
  ]);
  assert.deepEqual((await listPushSubscriptions(directory)).map((subscription) => subscription.endpoint), [ENDPOINT], "the store holds the real record");

  const removed = await reached(routes, request("POST", "/__hui/notifications/push/unsubscribe", { endpoint: ENDPOINT }));
  assert.equal(removed?.status, 200);
  expectSchema(PushUnsubscribeResponse, removed?.body);
  assert.deepEqual(removed?.body, { removed: true });
  assert.deepEqual((await reached(routes, request("POST", "/__hui/notifications/push/unsubscribe", { endpoint: ENDPOINT })))?.body, { removed: false }, "forgetting an unknown device is not a failure");
  assert.deepEqual(await listPushSubscriptions(directory), []);

  for (const [path, method] of [
    ["/__hui/notifications/push", "POST"],
    ["/__hui/notifications/push/subscribe", "GET"],
    ["/__hui/notifications/push/unsubscribe", "GET"],
    ["/__hui/notifications/push/test", "GET"],
  ] as const) {
    assert.equal((await reached(routes, request(method, path)))?.status, 405, `${method} ${path}`);
  }
  await rm(directory, { recursive: true, force: true });
});

test("the test push answers how many services accepted, and a refusal says what to switch on", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-push-routes-"));
  const routes = createNotificationRoutes(await deps(directory, { sendTestPush: async () => ({ sent: 1, devices: 2 }) }));
  const answered = await reached(routes, request("POST", "/__hui/notifications/push/test"));
  assert.equal(answered?.status, 200);
  expectSchema(PushTestResponse, answered?.body);
  assert.deepEqual(answered?.body, { sent: 1, devices: 2 });

  const switchedOff = createNotificationRoutes(await deps(directory, { sendTestPush: async () => { throw new Error("Turn on Web Push in Settings → Notifications → This device, then send the test again."); } }));
  const refused = await reached(switchedOff, request("POST", "/__hui/notifications/push/test"));
  assert.equal(refused?.status, 400);
  assert.deepEqual(refused?.body, { error: "Turn on Web Push in Settings → Notifications → This device, then send the test again." });
  await rm(directory, { recursive: true, force: true });
});

test("an endpoint that is not https, and a body that is not JSON, are refused without touching the store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-push-routes-"));
  const routes = createNotificationRoutes(await deps(directory));

  const insecure = await reached(routes, request("POST", "/__hui/notifications/push/subscribe", { endpoint: "http://push.example.com/send/capability-secret-token", keys: KEYS }));
  assert.equal(insecure?.status, 400);
  assert.deepEqual(insecure?.body, { error: "A push subscription endpoint must be an https: URL." });
  assert.deepEqual(await listPushSubscriptions(directory), [], "a refused scheme subscribes nothing");

  for (const body of [{ endpoint: ENDPOINT }, { endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh } }, null, "text", [ENDPOINT]]) {
    const refused = await reached(routes, request("POST", "/__hui/notifications/push/subscribe", body));
    assert.equal(refused?.status, 400, JSON.stringify(body));
    assert.equal(typeof (refused?.body as { error?: unknown }).error, "string");
  }
  assert.equal((await reached(routes, unparseable("POST", "/__hui/notifications/push/subscribe")))?.status, 400);
  assert.equal((await reached(routes, unparseable("POST", "/__hui/notifications/push/unsubscribe")))?.status, 400);
  assert.deepEqual(await listPushSubscriptions(directory), []);
  await rm(directory, { recursive: true, force: true });
});

/** A push service on this machine has no certificate: the route accepts the same loopback `http:` address the store and
 * the publisher do, and keeps refusing every other plain-http endpoint. */
test("a loopback http endpoint is accepted and every other http one is still refused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-push-routes-"));
  const routes = createNotificationRoutes(await deps(directory));
  const loopbacks = ["http://127.0.0.1:4711/push/loopback-token", "http://[::1]:4711/push/loopback-token"];

  for (const endpoint of loopbacks) {
    const subscribed = await reached(routes, request("POST", "/__hui/notifications/push/subscribe", { endpoint, keys: KEYS, device: "e2e" }));
    assert.equal(subscribed?.status, 200, endpoint);
    expectSchema(PushSubscribeResponse, subscribed?.body);
    assert.deepEqual(subscribed?.body, { subscribed: true, id: pushSubscriptionId(endpoint) });
  }
  assert.deepEqual((await listPushSubscriptions(directory)).map((subscription) => subscription.endpoint), loopbacks, "both loopback services are in the store");

  const publicHost = "http://push.example.net/send/capability-secret-token";
  const refused = await reached(routes, request("POST", "/__hui/notifications/push/subscribe", { endpoint: publicHost, keys: KEYS }));
  assert.equal(refused?.status, 400);
  assert.deepEqual(refused?.body, { error: "A push subscription endpoint must be an https: URL." });
  assert.equal((await listPushSubscriptions(directory)).some((subscription) => subscription.endpoint === publicHost), false, "a refused address subscribes nothing");
  await rm(directory, { recursive: true, force: true });
});
