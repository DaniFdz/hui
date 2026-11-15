import assert from "node:assert/strict";
import { test } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import { expectSchema } from "../test-support/api-schema.ts";
import { NotificationTestResponse } from "../api/notifications.ts";
import { createNotificationRoutes } from "./notifications.ts";

function request(method: string, path = "/__hui/notifications/test"): RouteRequest {
  return {
    method, path, query: new URLSearchParams(), headers: {}, signal: new AbortController().signal,
    json: async () => ({}), bytes: async () => Buffer.alloc(0), stream: () => (async function* () {})(),
  };
}

test("the test route publishes one message and reports the relay's own refusal", async () => {
  let sent = 0;
  const routes = createNotificationRoutes({ sendTest: async () => { sent += 1; } });
  assert.equal(await routes.handle(request("GET", "/__hui/elsewhere")), undefined, "another route is not this one");

  const answered = await routes.handle(request("POST"));
  assert.equal(answered?.status, 200);
  expectSchema(NotificationTestResponse, answered?.body);
  assert.equal(sent, 1);

  assert.equal((await routes.handle(request("GET")))?.status, 405);
  assert.equal(sent, 1, "only a POST publishes");

  const refused = createNotificationRoutes({ sendTest: async () => { throw new Error("ntfy answered HTTP 403 for the configured topic."); } });
  const failure = await refused.handle(request("POST"));
  assert.equal(failure?.status, 400);
  assert.deepEqual(failure?.body, { error: "ntfy answered HTTP 403 for the configured topic." });
});
