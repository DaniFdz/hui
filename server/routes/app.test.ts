import assert from "node:assert/strict";
import { test } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import { createAppRoutes } from "./app.ts";

const request = (method: string, path: string, body: unknown): RouteRequest => ({
  method,
  path,
  query: new URLSearchParams(),
  headers: {},
  json: async () => body,
  bytes: async () => Buffer.alloc(0),
  signal: new AbortController().signal,
});

test("a chat path opens the installed app and answers when the app refused", async () => {
  const opened: string[] = [];
  const routes = createAppRoutes({ openChatInApp: async (path) => { opened.push(path); } });
  assert.deepEqual(await routes.handle(request("POST", "/__hui/app/open", { path: "/sessions/4f0c2d9e" })), { status: 200, body: { opened: true } });
  assert.deepEqual(await routes.handle(request("POST", "/__hui/app/open", { path: "/bots/scout" })), { status: 200, body: { opened: true } });
  assert.deepEqual(opened, ["/sessions/4f0c2d9e", "/bots/scout"]);

  const missing = createAppRoutes({ openChatInApp: async () => { throw new Error("The HUI desktop app is not installed on this machine."); } });
  assert.deepEqual(await missing.handle(request("POST", "/__hui/app/open", { path: "/sessions/a" })),
    { status: 503, body: { error: "The HUI desktop app is not installed on this machine." } });
});

test("only a chat this gateway serves is opened, and only by POST", async () => {
  const routes = createAppRoutes({ openChatInApp: async () => { throw new Error("should not open"); } });
  for (const body of [{}, { path: "" }, { path: "/" }, { path: "/settings/appearance" }, { path: "/sessions" }, { path: "/sessions/a/b" }, { path: "/sessions/a b" }, { path: 42 }]) {
    const result = await routes.handle(request("POST", "/__hui/app/open", body));
    assert.equal(result?.status, 400, JSON.stringify(body));
  }
  assert.equal((await routes.handle(request("GET", "/__hui/app/open", {})))?.status, 405);
  assert.equal(await routes.handle(request("POST", "/__hui/sessions/a/open", {})), undefined);
});
