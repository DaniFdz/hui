import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";

import type { RouteRequest } from "../http/route.ts";
import { createExtensionsService } from "./service.ts";

const HELLO = `
export const routes = [
  { method: "GET", path: "hello", description: "Greets a name.",
    handle: async ({ query }) => ({ body: { greeting: "hello, " + (query.get("name") ?? "world") } }) },
  { method: "POST", path: "echo", description: "Echoes the JSON body.",
    handle: async ({ body }) => ({ status: 201, body: { echo: body } }) },
  { method: "GET", path: "boom", description: "Throws.",
    handle: async () => { throw new Error("fixture failure"); } },
  { method: "GET", path: "shape", description: "Returns a non-object.",
    handle: async () => ({ body: [] }) },
  { method: "GET", path: "range", description: "Returns an impossible status.",
    handle: async () => ({ status: 700, body: { ok: true } }) },
  { method: "GET", path: "cyclic", description: "Returns a value JSON cannot hold.",
    handle: async () => { const body = {}; body.self = body; return { body }; } },
];
export const tools = { greet: async ({ name }) => "hello, " + name };
`;

const MARKER = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.HUI_EXTENSION_MARKER, "imported\\n");
export const routes = [{ method: "GET", path: "m", handle: async () => ({ body: { ok: true } }) }];
`;

const MANIFEST = { apiVersion: 1, name: "Hello", description: "Fixture.", main: "index.mjs" };

async function temp(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hui-ext-service-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function installed(root: string, id: string, manifest: Record<string, unknown>, source: string): Promise<void> {
  const directory = join(root, "extensions", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "index.mjs"), source);
}

function serviceAt(root: string, events: unknown[] = []) {
  return createExtensionsService({
    dir: join(root, "extensions"),
    file: join(root, "extensions.json"),
    record: (event) => { events.push(event); },
  });
}

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    method: "GET", path: "/__hui/ext/hello/hello", query: new URLSearchParams(), headers: {},
    json: async () => undefined, bytes: async () => Buffer.alloc(0),
    stream: async function* () { yield Buffer.alloc(0); }, signal: new AbortController().signal,
    ...overrides,
  };
}

test("an installed extension lists as disabled and is never imported", async (t) => {
  const root = await temp(t);
  const marker = join(root, "marker.log");
  process.env["HUI_EXTENSION_MARKER"] = marker;
  await installed(root, "marked", MANIFEST, MARKER);
  const service = serviceAt(root);

  const listed = await service.list();
  assert.deepEqual(listed.extensions.map(({ id, enabled, state }) => ({ id, enabled, state })), [
    { id: "marked", enabled: false, state: "disabled" },
  ]);
  assert.equal(listed.storeError, undefined);
  await assert.rejects(access(marker), /ENOENT/);
  const answer = await service.invoke({ id: "marked", method: "GET", subpath: "m", request: request() });
  assert.equal(answer.status, 404);
});

test("enabling imports once, persists the choice and answers its routes", async (t) => {
  const root = await temp(t);
  await installed(root, "hello", MANIFEST, HELLO);
  const service = serviceAt(root);

  const status = await service.setEnabled("hello", true);
  assert.equal(status.state, "loaded");
  assert.equal(status.enabled, true);
  assert.deepEqual(status.routes, [
    { method: "GET", path: "hello", description: "Greets a name." },
    { method: "POST", path: "echo", description: "Echoes the JSON body." },
    { method: "GET", path: "boom", description: "Throws." },
    { method: "GET", path: "shape", description: "Returns a non-object." },
    { method: "GET", path: "range", description: "Returns an impossible status." },
    { method: "GET", path: "cyclic", description: "Returns a value JSON cannot hold." },
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(root, "extensions.json"), "utf8")), { version: 1, enabled: ["hello"] });

  const greeting = await service.invoke({
    id: "hello", method: "GET", subpath: "hello",
    request: request({ query: new URLSearchParams("name=Ada") }),
  });
  assert.deepEqual(greeting, { status: 200, body: { greeting: "hello, Ada" } });

  const echoed = await service.invoke({
    id: "hello", method: "POST", subpath: "echo",
    request: request({ method: "POST", json: async () => ({ ok: true }) }),
  });
  assert.deepEqual(echoed, { status: 201, body: { echo: { ok: true } } });

  assert.deepEqual(await service.invoke({ id: "hello", method: "PUT", subpath: "hello", request: request() }), {
    status: 405, body: { error: "method not allowed" },
  });
  assert.deepEqual(await service.invoke({ id: "hello", method: "GET", subpath: "missing", request: request() }), {
    status: 404, body: { error: "unknown extension route: missing" },
  });
  assert.deepEqual(await service.invoke({ id: "ghost", method: "GET", subpath: "hello", request: request() }), {
    status: 404, body: { error: "unknown extension: ghost" },
  });
});

test("a panel's title and entry are listed, and its root follows the enable switch", async (t) => {
  const root = await temp(t);
  await installed(root, "hello", { ...MANIFEST, ui: { title: "Hello panel" } }, HELLO);
  const service = serviceAt(root);

  const disabled = (await service.list()).extensions.find((extension) => extension.id === "hello");
  assert.deepEqual(disabled?.panel, { title: "Hello panel", entry: "index.html" });
  assert.equal(await service.panelRoot("hello"), undefined, "a disabled panel has no asset root");

  await service.setEnabled("hello", true);
  assert.equal(await service.panelRoot("hello"), join(root, "extensions", "hello", "ui"));
  await service.setEnabled("hello", false);
  assert.equal(await service.panelRoot("hello"), undefined);
});

test("prompt sections and tools load with their handlers and reach the settings payload", async (t) => {
  const root = await temp(t);
  await installed(root, "hello", {
    ...MANIFEST,
    prompt: [{ id: "greeting", title: "Greeting", text: "PROMPT_MARKER greet by name." }],
    tools: [{
      name: "greet", description: "Greets a person.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      promptSnippet: "Greets", promptGuidelines: ["Use it."],
    }],
  }, HELLO);
  const service = serviceAt(root);

  assert.equal(service.promptText(), undefined);
  assert.deepEqual(service.agentTools(), [], "nothing is offered while the extension is off");
  await service.setEnabled("hello", true);
  assert.match(service.promptText() ?? "", /PROMPT_MARKER/);
  const tools = service.agentTools();
  assert.deepEqual(tools.map((entry) => [entry.extensionId, entry.name]), [["hello", "ext_hello_greet"]]);
  assert.deepEqual(service.contributions()["ext_hello_greet"], { snippet: "Greets", guidelines: ["Use it."] });
  const handler = service.toolFor("hello", "greet")?.handle;
  assert.equal(await handler?.({ name: "Ada" }, { conversationId: "7", signal: new AbortController().signal }), "hello, Ada");
  assert.equal(service.toolFor("hello", "missing"), undefined);
  assert.equal(service.toolFor("other", "greet"), undefined);

  const status = (await service.list()).extensions[0];
  assert.deepEqual(status?.prompt, [{ id: "greeting", title: "Greeting", text: "PROMPT_MARKER greet by name." }]);
  assert.deepEqual(status?.tools, [{ name: "greet", runtimeName: "ext_hello_greet", description: "Greets a person." }]);
  await service.setEnabled("hello", false);
  assert.equal(service.promptText(), undefined);
});

test("a declared tool without an exported handler fails the extension", async (t) => {
  const root = await temp(t);
  await installed(root, "hello", {
    ...MANIFEST,
    tools: [{ name: "greet", description: "Greets a person.", parameters: { type: "object" } }],
  }, HELLO.replace('export const tools = { greet: async ({ name }) => "hello, " + name };', "export const tools = {};"));
  const service = serviceAt(root);
  await service.setEnabled("hello", true);
  const status = (await service.list()).extensions[0];
  assert.equal(status?.state, "failed");
  assert.match(status?.error ?? "", /tools\.greet has no handler/u);
});

test("a failed import is reported without touching the extensions that loaded", async (t) => {
  const root = await temp(t);
  const events: { action?: string; summary?: string }[] = [];
  await installed(root, "broken", { ...MANIFEST, name: "Broken" }, 'throw new Error("fixture boom");');
  await installed(root, "hello", MANIFEST, HELLO);
  await writeFile(join(root, "extensions.json"), JSON.stringify({ version: 1, enabled: ["broken", "hello"] }));
  const service = serviceAt(root, events);

  await service.reconcile();
  const listed = await service.list();
  assert.deepEqual(listed.extensions.map(({ id, state }) => ({ id, state })), [
    { id: "broken", state: "failed" },
    { id: "hello", state: "loaded" },
  ]);
  const broken = listed.extensions.find((extension) => extension.id === "broken");
  assert.match(broken?.error ?? "", /fixture boom/);
  assert.ok(events.some((event) => event.action === "extension_load_failed" && /broken/.test(event.summary ?? "")));
  const greeting = await service.invoke({ id: "hello", method: "GET", subpath: "hello", request: request() });
  assert.equal(greeting.status, 200);
});

test("an unsupported apiVersion or an escaping main stays failed and unimported", async (t) => {
  const root = await temp(t);
  const marker = join(root, "marker.log");
  process.env["HUI_EXTENSION_MARKER"] = marker;
  await installed(root, "future", { ...MANIFEST, apiVersion: 2 }, MARKER);
  await installed(root, "escape", { ...MANIFEST, main: "../future/index.mjs" }, "export const routes = [];");
  await writeFile(join(root, "extensions.json"), JSON.stringify({ version: 1, enabled: ["future", "escape"] }));
  const service = serviceAt(root);

  await service.reconcile();
  const listed = await service.list();
  const future = listed.extensions.find((extension) => extension.id === "future");
  const escape = listed.extensions.find((extension) => extension.id === "escape");
  assert.equal(future?.state, "failed");
  assert.match(future?.error ?? "", /unsupported apiVersion: 2/);
  assert.equal(escape?.state, "failed");
  assert.match(escape?.error ?? "", /stay inside/);
  await assert.rejects(access(marker), /ENOENT/);
});

test("an entry symlink that leaves the extension directory is refused", async (t) => {
  const root = await temp(t);
  const outside = join(root, "outside.mjs");
  await writeFile(outside, 'export const routes = [{ method: "GET", path: "x", handle: async () => ({ body: { ok: true } }) }];\n');
  const directory = join(root, "extensions", "linked");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify({ ...MANIFEST, name: "Linked" }));
  await symlink(outside, join(directory, "index.mjs"));
  await writeFile(join(root, "extensions.json"), JSON.stringify({ version: 1, enabled: ["linked"] }));
  const events: { action?: string; summary?: string }[] = [];
  const service = serviceAt(root, events);

  await service.reconcile();
  const status = (await service.list()).extensions.find((extension) => extension.id === "linked");
  assert.equal(status?.state, "failed");
  assert.match(status?.error ?? "", /stay inside/);
  assert.ok(events.some((event) => event.action === "extension_load_failed"));
});

test("an enabled id without a directory is missing, not fatal", async (t) => {
  const root = await temp(t);
  await writeFile(join(root, "extensions.json"), JSON.stringify({ version: 1, enabled: ["ghost"] }));
  const service = serviceAt(root);
  await service.reconcile();
  const listed = await service.list();
  assert.deepEqual(listed.extensions.map(({ id, enabled, state, error }) => ({ id, enabled, state, error })), [
    { id: "ghost", enabled: true, state: "missing", error: "no extension directory" },
  ]);
});

test("disabling removes the routes at once and re-enabling does not re-import", async (t) => {
  const root = await temp(t);
  const marker = join(root, "marker.log");
  process.env["HUI_EXTENSION_MARKER"] = marker;
  await installed(root, "marked", MANIFEST, MARKER);
  const service = serviceAt(root);

  await service.setEnabled("marked", true);
  assert.equal((await service.invoke({ id: "marked", method: "GET", subpath: "m", request: request() })).status, 200);
  assert.equal(await readFile(marker, "utf8"), "imported\n");

  const disabled = await service.setEnabled("marked", false);
  assert.equal(disabled.state, "disabled");
  assert.equal((await service.invoke({ id: "marked", method: "GET", subpath: "m", request: request() })).status, 404);
  assert.deepEqual(JSON.parse(await readFile(join(root, "extensions.json"), "utf8")), { version: 1, enabled: [] });

  await service.setEnabled("marked", true);
  assert.equal((await service.invoke({ id: "marked", method: "GET", subpath: "m", request: request() })).status, 200);
  assert.equal(await readFile(marker, "utf8"), "imported\n");
});

test("a failing handler is contained, mapped and recorded", async (t) => {
  const root = await temp(t);
  const events: { action?: string; detail?: string }[] = [];
  await installed(root, "hello", MANIFEST, HELLO);
  const service = serviceAt(root, events);
  await service.setEnabled("hello", true);

  for (const subpath of ["boom", "shape", "range", "cyclic"]) {
    const answer = await service.invoke({ id: "hello", method: "GET", subpath, request: request() });
    assert.deepEqual(answer, { status: 500, body: { error: "extension failed" } }, subpath);
  }
  assert.equal(events.filter((event) => event.action === "extension_failed").length, 4);

  const invalid = await service.invoke({
    id: "hello", method: "POST", subpath: "echo",
    request: request({ method: "POST", json: async () => { throw new SyntaxError("bad json"); } }),
  });
  assert.deepEqual(invalid, { status: 400, body: { error: "body must be JSON" } });

  const oversized = await service.invoke({
    id: "hello", method: "POST", subpath: "echo",
    request: request({ method: "POST", json: async () => { throw new Error("request body too large"); } }),
  });
  assert.deepEqual(oversized, { status: 413, body: { error: "request body too large" } });
});

test("a corrupt store reads as empty, reports it, and a toggle repairs it", async (t) => {
  const root = await temp(t);
  await installed(root, "hello", MANIFEST, HELLO);
  await writeFile(join(root, "extensions.json"), "{");
  const service = serviceAt(root);

  const corrupt = await service.list();
  assert.deepEqual(corrupt.extensions.map(({ id, state }) => ({ id, state })), [{ id: "hello", state: "disabled" }]);
  assert.match(corrupt.storeError ?? "", /not valid JSON/);

  const events: { action?: string }[] = [];
  await serviceAt(root, events).reconcile();
  assert.ok(events.some((event) => event.action === "extensions_store_failed"));

  await service.setEnabled("hello", true);
  const repaired = await service.list();
  assert.equal(repaired.storeError, undefined);
  assert.equal(repaired.extensions[0]?.state, "loaded");
  assert.deepEqual(JSON.parse(await readFile(join(root, "extensions.json"), "utf8")), { version: 1, enabled: ["hello"] });
});
