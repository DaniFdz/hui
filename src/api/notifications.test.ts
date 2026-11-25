import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { fetchPushStatus, sendPushTest, sendTestNotification, subscribePushDevice, unsubscribePushDevice } from "./notifications.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** Every request this page makes, answered with the payload a route would return. */
function recording(answer: unknown = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    calls.push({
      url: new URL(input, "http://hui.test").pathname,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? init.body : "",
    });
    return Response.json(answer);
  });
  return calls;
}

test("each push request names its own route, method and body", async () => {
  const calls = recording({ publicKey: "k", devices: [] });
  await fetchPushStatus();
  await subscribePushDevice({ endpoint: "https://push.example.net/device", keys: { p256dh: "point", auth: "secret" }, device: "Pixel" });
  await unsubscribePushDevice("https://push.example.net/device");
  await sendPushTest();
  await sendTestNotification();
  assert.deepEqual(calls.map(({ url, method }) => [method, url]), [
    ["GET", "/__hui/notifications/push"],
    ["POST", "/__hui/notifications/push/subscribe"],
    ["POST", "/__hui/notifications/push/unsubscribe"],
    ["POST", "/__hui/notifications/push/test"],
    ["POST", "/__hui/notifications/test"],
  ]);
  assert.deepEqual(JSON.parse(calls[1]?.body ?? ""), { endpoint: "https://push.example.net/device", keys: { p256dh: "point", auth: "secret" }, device: "Pixel" });
  assert.deepEqual(JSON.parse(calls[2]?.body ?? ""), { endpoint: "https://push.example.net/device" });
  for (const call of calls.filter(({ method }) => method === "POST")) {
    assert.equal(call.headers["content-type"], "application/json", "a route reads its body as JSON");
    assert.equal(call.headers["x-hui"], "1", "every /__hui/ request carries the local-client header");
  }
});

test("no request body carries the VAPID private key", async () => {
  const calls = recording({ publicKey: "public-only", devices: [], subscribed: true, id: "abc", removed: true, sent: 1 });
  const status = await fetchPushStatus();
  assert.equal(status.publicKey, "public-only", "the gateway publishes only the key a browser subscribes with");
  await subscribePushDevice({ endpoint: "https://push.example.net/device", keys: { p256dh: "point", auth: "secret" } });
  await unsubscribePushDevice("https://push.example.net/device");
  await sendPushTest();
  for (const call of calls) {
    assert.doesNotMatch(call.body, /privateKey|private_key|"d"\s*:/u, "no body carries a private key field");
    const body: unknown = call.body ? JSON.parse(call.body) : {};
    assert.ok(body !== null && typeof body === "object");
    for (const key of Object.keys(body)) assert.ok(["endpoint", "keys", "device"].includes(key), `${key} is not a key a push route reads`);
  }
  assert.deepEqual(JSON.parse(calls[1]?.body ?? "").keys, { p256dh: "point", auth: "secret" }, "a subscription's whole body is its endpoint and two public-by-sealing keys");
});

test("a refused push route surfaces the gateway's own sentence", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ error: "A push subscription endpoint must be an https: URL." }, { status: 400 }));
  await assert.rejects(subscribePushDevice({ endpoint: "http://push.example.net/x", keys: { p256dh: "point", auth: "secret" } }),
    /A push subscription endpoint must be an https: URL\./u);
  vi.stubGlobal("fetch", async () => Response.json({ error: "The push service answered HTTP 410." }, { status: 400 }));
  await assert.rejects(sendPushTest(), /The push service answered HTTP 410\./u);
});
