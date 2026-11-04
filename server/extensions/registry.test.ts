import assert from "node:assert/strict";
import { test } from "vitest";

import {
  checkedResult, entryPath, extensionId, parseManifest, parseRoutes, routeInfo, routeKey,
} from "./registry.ts";

const MANIFEST = { apiVersion: 1, name: "Hello", description: "One sentence.", main: "index.mjs" };

test("an extension id is a short lowercase directory name", () => {
  for (const id of ["a", "hello", "hello-world", "a1", "x".repeat(32)]) assert.equal(extensionId(id), id);
  for (const id of ["", "Hello", "1hello", "hello_world", "hello world", "-hello", "x".repeat(33), "../hello", "hello/world"]) {
    assert.equal(extensionId(id), undefined, id);
  }
});

test("the manifest needs apiVersion 1, a name and a contained entry module", () => {
  const parsed = parseManifest(MANIFEST);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value : undefined, MANIFEST);

  const cases: [unknown, RegExp][] = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ ...MANIFEST, apiVersion: 2 }, /unsupported apiVersion: 2/],
    [{ ...MANIFEST, apiVersion: undefined }, /unsupported apiVersion: missing/],
    [{ ...MANIFEST, name: "" }, /name must be/],
    [{ ...MANIFEST, name: "x".repeat(81) }, /name must be/],
    [{ ...MANIFEST, name: "bad\u0007name" }, /name must be/],
    [{ ...MANIFEST, description: "x".repeat(241) }, /description must be/],
    [{ ...MANIFEST, main: "index.ts" }, /\.mjs or \.js/],
    [{ ...MANIFEST, main: "/etc/index.mjs" }, /relative/],
    [{ ...MANIFEST, main: "../other/index.mjs" }, /stay inside/],
    [{ ...MANIFEST, main: "./index.mjs" }, /stay inside/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parseManifest(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    if (!result.ok) assert.match(result.error, pattern);
  }
});

test("the entry path resolves inside the extension directory", () => {
  assert.equal(entryPath("/tmp/hello", "index.mjs"), "/tmp/hello/index.mjs");
  assert.equal(entryPath("/tmp/hello", "lib/main.js"), "/tmp/hello/lib/main.js");
  assert.equal(entryPath("/tmp/hello", "../hello/index.mjs"), "/tmp/hello/index.mjs");
  assert.equal(entryPath("/tmp/hello", "../escape/index.mjs"), undefined);
});

test("routes need a method, a short clean path and a handler", () => {
  const handler = async () => ({ body: {} });
  const parsed = parseRoutes([{ method: "GET", path: "hello", description: "Greets.", handle: handler }]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(routeInfo(parsed.value), [{ method: "GET", path: "hello", description: "Greets." }]);

  const cases: [unknown, RegExp][] = [
    [undefined, /non-empty array/],
    [[], /non-empty array/],
    [Array.from({ length: 33 }, (_, index) => ({ method: "GET", path: `path${index}`, handle: handler })), /at most 32/],
    [[{ method: "get", path: "hello", handle: handler }], /method must be/],
    [[{ method: "HEAD", path: "hello", handle: handler }], /method must be/],
    [[{ method: "GET", path: "", handle: handler }], /path must be/],
    [[{ method: "GET", path: "a/b/c/d/e", handle: handler }], /path must be/],
    [[{ method: "GET", path: "a//b", handle: handler }], /path must be/],
    [[{ method: "GET", path: "..", handle: handler }], /path must be/],
    [[{ method: "GET", path: "a b", handle: handler }], /path must be/],
    [[{ method: "GET", path: "hello", description: "x".repeat(241), handle: handler }], /description/],
    [[{ method: "GET", path: "hello" }], /handle must be/],
    [[{ method: "GET", path: "hello", handle: handler }, { method: "GET", path: "hello", handle: handler }], /repeats/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parseRoutes(raw);
    assert.equal(result.ok, false, JSON.stringify(raw)?.slice(0, 120));
    if (!result.ok) assert.match(result.error, pattern);
  }
});

test("a handler result is a usable status and a bounded JSON object", () => {
  assert.deepEqual(checkedResult({ body: { ok: true } }), { ok: true, value: { status: 200, body: { ok: true } } });
  assert.deepEqual(checkedResult({ status: 201, body: {} }), { ok: true, value: { status: 201, body: {} } });

  const cases: [unknown, RegExp][] = [
    [undefined, /handle must return/],
    [[], /handle must return/],
    [{ body: {}, status: 99 }, /status must be/],
    [{ body: {}, status: 600 }, /status must be/],
    [{ body: {}, status: 200.5 }, /status must be/],
    [{ body: {}, status: "200" }, /status must be/],
    [{ body: [] }, /JSON object/],
    [{ body: null }, /JSON object/],
  ];
  for (const [raw, pattern] of cases) {
    const result = checkedResult(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    if (!result.ok) assert.match(result.error, pattern);
  }
  const big = checkedResult({ body: { text: "x".repeat(300 * 1024) } });
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.error, /at most/);
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  const looped = checkedResult({ body: cyclic });
  assert.equal(looped.ok, false);
  if (!looped.ok) assert.match(looped.error, /JSON-serializable/);
});

test("route keys and published route info keep the declared order", () => {
  assert.equal(routeKey("GET", "hello"), "GET hello");
  const handler = async () => ({ body: {} });
  assert.deepEqual(routeInfo([
    { method: "GET", path: "a", description: "A", handle: handler },
    { method: "POST", path: "b/c", description: "", handle: handler },
  ]), [
    { method: "GET", path: "a", description: "A" },
    { method: "POST", path: "b/c", description: "" },
  ]);
});
