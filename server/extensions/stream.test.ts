import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import { waitFor } from "../test-support/wait-for.ts";

const root = await mkdtemp(join(tmpdir(), "hui-ext-stream-"));
process.env["HUI_CONFIG_DIR"] = join(root, "config");
const marker = join(root, "marker.log");
process.env["HUI_STREAM_MARKER"] = marker;
const directory = join(root, "config", "extensions", "hello");
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "extension.json"), JSON.stringify({ apiVersion: 1, name: "Stream", description: "Fixture.", main: "index.mjs" }));
await writeFile(join(directory, "index.mjs"), `
import { appendFileSync } from "node:fs";
export const routes = [
  { method: "GET", path: "events", stream: true, handle: async ({ signal }) => ({ events: (async function* () {
    try {
      for (let index = 0; index < 10; index += 1) {
        if (signal.aborted) return;
        yield { n: index };
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      appendFileSync(process.env.HUI_STREAM_MARKER, "closed\\n");
    }
  })() }) },
  { method: "GET", path: "bad-stream", stream: true, handle: async () => ({ body: { ok: true } }) },
  { method: "GET", path: "bad-json", handle: async () => ({ events: (async function* () { yield { n: 0 }; })() }) },
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
const headers = { "x-hui": "1" };

afterAll(async () => {
  await stopBackend();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

test("a streaming route sends events, stops on a client that leaves, and refuses the wrong shapes", async () => {
  const enabled = await fetch(`${base}/__hui/ext/hello`, {
    method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enabled.status, 200);
  const status = (await (await fetch(`${base}/__hui/ext`, { headers })).json()) as { extensions: { id: string; routes: { path: string; stream?: boolean }[] }[] };
  assert.deepEqual(status.extensions[0]?.routes.find((route) => route.path === "events"), { method: "GET", path: "events", description: "", stream: true });

  const response = await fetch(`${base}/__hui/ext/hello/events`, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  await waitFor("the first two events", async () => {
    const { value, done } = await reader.read();
    if (done) return true;
    text += decoder.decode(value, { stream: true });
    return text.includes('data: {"n":1}');
  });
  assert.match(text, /data: \{"n":0\}/u);
  await reader.cancel();
  await waitFor("the handler's generator to close", async () => {
    try {
      return (await readFile(marker, "utf8")).includes("closed");
    } catch {
      return false;
    }
  });

  for (const path of ["bad-stream", "bad-json"]) {
    const bad = await fetch(`${base}/__hui/ext/hello/${path}`, { headers });
    assert.equal(bad.status, 500, path);
    assert.deepEqual(await bad.json(), { error: "extension failed" }, path);
  }
});
