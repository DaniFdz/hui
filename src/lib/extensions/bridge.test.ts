import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionRouteInfo } from "../../api/schema/extensions.ts";
import {
  BRIDGE_CHANNEL, BRIDGE_MAX_REQUEST_BYTES, callIsAllowed, jsonBytes, normalizeCallPath, parseBridgeCall,
} from "./bridge.ts";

const ROUTES: ExtensionRouteInfo[] = [
  { method: "GET", path: "hello", description: "" },
  { method: "POST", path: "echo/nested", description: "" },
];

test("a call path stays inside the extension and keeps its query", () => {
  assert.deepEqual(normalizeCallPath("hello?name=Ada"), { path: "hello?name=Ada", route: "hello" });
  assert.deepEqual(normalizeCallPath("echo/nested"), { path: "echo/nested", route: "echo/nested" });
  for (const bad of ["", "/hello", "..", "../other", "a//b", "a/./b", "a%2Fb", "a b", "a/b/c/d/e", "x".repeat(513)]) {
    assert.equal(normalizeCallPath(bad), undefined, bad);
  }
});

test("a route is allowed only for the method the extension declared", () => {
  assert.equal(callIsAllowed(ROUTES, "GET", "hello"), true);
  assert.equal(callIsAllowed(ROUTES, "POST", "hello"), false);
  assert.equal(callIsAllowed(ROUTES, "POST", "echo/nested"), true);
  assert.equal(callIsAllowed(ROUTES, "GET", "echo"), false);
});

test("a bridge call is validated before it reaches the gateway", () => {
  const good = { channel: BRIDGE_CHANNEL, type: "call", callId: 7, method: "GET", path: "hello?name=Ada" };
  const parsed = parseBridgeCall(good, ROUTES);
  assert.ok("call" in parsed);
  if ("call" in parsed) assert.deepEqual(parsed.call, { callId: 7, method: "GET", path: "hello?name=Ada", route: "hello", body: undefined });

  const bad: [unknown, RegExp][] = [
    [{ ...good, channel: "other" }, /not a call/],
    [{ ...good, callId: 0 }, /bad call id/],
    [{ ...good, method: "HEAD" }, /method not allowed/],
    [{ ...good, path: "missing" }, /route not allowed/],
    [{ ...good, path: "../hello" }, /path not allowed/],
    [{ ...good, body: { text: "x".repeat(BRIDGE_MAX_REQUEST_BYTES) } }, /request too large/],
  ];
  for (const [raw, pattern] of bad) {
    const result = parseBridgeCall(raw, ROUTES);
    assert.ok("error" in result, JSON.stringify(raw).slice(0, 80));
    if ("error" in result) assert.match(result.error, pattern);
  }
});

test("body bytes are counted as UTF-8", () => {
  assert.equal(jsonBytes(undefined), 0);
  assert.equal(jsonBytes({ a: 1 }), 7);
  assert.equal(jsonBytes({ text: "ñ" }), 13);
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  assert.equal(jsonBytes(cyclic), undefined);
});
