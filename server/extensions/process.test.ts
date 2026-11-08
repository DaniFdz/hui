import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";

import type { RouteRequest } from "../http/route.ts";
import { waitFor } from "../test-support/wait-for.ts";
import { createExtensionsService } from "./service.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hui-process-extension-"));
  t.onTestFinished(async () => {
    await service?.stop();
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, "extensions", "hello");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify({ apiVersion: 1, name: "Hello", description: "", main: "index.mjs", mode: "process" }));
  await writeFile(join(directory, "index.mjs"), `
export const routes = [
  { method: "GET", path: "ping", handle: async () => ({ body: { ok: true } }) },
  { method: "GET", path: "crash", handle: async () => { process.exit(1); } },
  { method: "GET", path: "stream", stream: true, handle: async () => ({ events: (async function* () { yield { n: 0 }; })() }) },
];
`);
  const service = createExtensionsService({ dir: join(root, "extensions"), file: join(root, "extensions.json") });
  return { root, service };
}

let service: ReturnType<typeof createExtensionsService> | undefined;

function request(): RouteRequest {
  return {
    method: "GET", path: "/__hui/ext/hello/ping", query: new URLSearchParams(), headers: {},
    json: async () => undefined, bytes: async () => Buffer.alloc(0), stream: async function* () { yield Buffer.alloc(0); },
    signal: new AbortController().signal,
  };
}

test("a process-mode extension answers through its host, restarts after a crash and stops with the gateway", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  service = f.service;
  const enabled = await service.setEnabled("hello", true);
  assert.equal(enabled.mode, "process");
  assert.deepEqual(enabled.routes.map((route) => [route.method, route.path, route.stream]), [
    ["GET", "ping", false],
    ["GET", "crash", false],
    ["GET", "stream", true],
  ]);
  assert.deepEqual(await service.invoke({ id: "hello", method: "GET", subpath: "ping", request: request() }), { status: 200, body: { ok: true } });

  const crashed = await service.invoke({ id: "hello", method: "GET", subpath: "crash", request: request() });
  assert.equal(crashed.status, 503, "the call loses its host");
  const restarting = await service.invoke({ id: "hello", method: "GET", subpath: "ping", request: request() });
  assert.deepEqual(restarting, { status: 503, body: { error: "extension process is restarting" } });

  await waitFor("the host to restart", async () => (await service!.list()).extensions[0]?.restarts === 1, { timeoutMs: 5_000 });
  await waitFor("the host to answer again", async () => (await service!.invoke({ id: "hello", method: "GET", subpath: "ping", request: request() })).status === 200, { timeoutMs: 5_000 });
  await service.stop();
  assert.equal((await service.invoke({ id: "hello", method: "GET", subpath: "ping", request: request() })).status, 404);
});

test("a process-mode extension may not declare tools", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hui-process-tools-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "extensions", "hello");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify({
    apiVersion: 1, name: "Hello", description: "", main: "index.mjs", mode: "process",
    tools: [{ name: "greet", description: "Greets", parameters: { type: "object" } }],
  }));
  await writeFile(join(directory, "index.mjs"), "export const routes = [{ method: \"GET\", path: \"ping\", handle: async () => ({ body: {} }) }];\n");
  const service = createExtensionsService({ dir: join(root, "extensions"), file: join(root, "extensions.json") });
  await service.setEnabled("hello", true);
  const status = (await service.list()).extensions[0];
  assert.equal(status?.state, "failed");
  assert.match(status?.error ?? "", /tools require in-process mode/u);
});
