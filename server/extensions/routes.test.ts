import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import { ExtensionStatus, ExtensionsResponse, PluginError, PluginPayload } from "../api/extensions.ts";
import { expectSchema } from "../test-support/api-schema.ts";

const root = await mkdtemp(join(tmpdir(), "hui-ext-routes-"));
process.env["HUI_CONFIG_DIR"] = join(root, "config");
const extensionDirectory = join(root, "config", "extensions", "hello");
await mkdir(extensionDirectory, { recursive: true });
await writeFile(join(extensionDirectory, "extension.json"), JSON.stringify({
  apiVersion: 1, name: "Hello", description: "Route fixture.", main: "index.mjs",
}));
await writeFile(join(extensionDirectory, "index.mjs"), `
export const routes = [
  { method: "GET", path: "hello", description: "Greets a name.",
    handle: async ({ query }) => ({ body: { greeting: "hello, " + (query.get("name") ?? "world") } }) },
  { method: "POST", path: "echo", description: "Echoes the JSON body.",
    handle: async ({ body }) => ({ status: 201, body: { echo: body } }) },
  { method: "GET", path: "boom", description: "Throws.",
    handle: async () => { throw new Error("fixture failure"); } },
];
`);

const { middleware } = await import("../hui.ts");
const { stopBackend } = await import("../backend.ts");

const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;

afterAll(async () => {
  await stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

type Answer = { status: number; body: unknown };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-hui": "1" }): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

test("the extension surface is gated, lists, toggles and answers without a restart", async () => {
  const anonymous = await call("GET", "/__hui/ext", undefined, {});
  assert.equal(anonymous.status, 403);

  const empty = await call("GET", "/__hui/ext");
  assert.equal(empty.status, 200);
  expectSchema(ExtensionsResponse, empty.body);
  assert.deepEqual(empty.body.extensions.map(({ id, enabled, state }) => ({ id, enabled, state })), [
    { id: "hello", enabled: false, state: "disabled" },
  ]);

  const inert = await call("GET", "/__hui/ext/hello/hello");
  assert.equal(inert.status, 404);
  expectSchema(PluginError, inert.body);

  const badBody = await call("PUT", "/__hui/ext/hello", {});
  assert.equal(badBody.status, 400);
  expectSchema(PluginError, badBody.body);

  const enabled = await call("PUT", "/__hui/ext/hello", { enabled: true });
  assert.equal(enabled.status, 200);
  expectSchema(ExtensionStatus, enabled.body);
  assert.equal((enabled.body as { state: string }).state, "loaded");

  const greeting = await call("GET", "/__hui/ext/hello/hello?name=Ada");
  assert.equal(greeting.status, 200);
  expectSchema(PluginPayload, greeting.body);
  assert.deepEqual(greeting.body, { greeting: "hello, Ada" });

  const echoed = await call("POST", "/__hui/ext/hello/echo", { ok: true });
  assert.equal(echoed.status, 201);
  assert.deepEqual(echoed.body, { echo: { ok: true } });

  const wrongMethod = await call("PUT", "/__hui/ext/hello/hello", {});
  assert.equal(wrongMethod.status, 405);

  const unknownRoute = await call("GET", "/__hui/ext/hello/nope");
  assert.equal(unknownRoute.status, 404);

  const unknownId = await call("PUT", "/__hui/ext/ghost", { enabled: true });
  assert.equal(unknownId.status, 404);
  expectSchema(PluginError, unknownId.body);

  const tooLarge = await call("POST", "/__hui/ext/hello/echo", { text: "x".repeat(70 * 1024) });
  assert.equal(tooLarge.status, 413);

  const boom = await call("GET", "/__hui/ext/hello/boom");
  assert.equal(boom.status, 500);
  assert.deepEqual(boom.body, { error: "extension failed" });

  const stillThere = await call("GET", "/__hui/ext");
  assert.equal(stillThere.status, 200);

  const disabled = await call("PUT", "/__hui/ext/hello", { enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal((disabled.body as { state: string }).state, "disabled");
  const gone = await call("GET", "/__hui/ext/hello/hello");
  assert.equal(gone.status, 404);

  const diagnostics = await call("GET", "/__hui/diagnostics/export");
  assert.equal(diagnostics.status, 200);
  const activity = (diagnostics.body as { activity: { action: string; detail?: string }[] }).activity;
  assert.ok(activity.some((event) => event.action === "extension_failed" && /fixture failure/.test(event.detail ?? "")));
});
