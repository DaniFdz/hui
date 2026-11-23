import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createLocalProviderRoutes } from "./local-providers.ts";
import { LocalProviderService } from "../pi/local-providers.ts";
import { waitFor } from "../test-support/wait-for.ts";
import type { RouteRequest } from "../http/route.ts";
import type { LocalProviderSnapshot } from "../api/local-providers.ts";

function request(method: string, path: string, body?: unknown): RouteRequest {
  return {
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    json: async () => body,
    bytes: async () => Buffer.alloc(0),
    stream: async function* () {},
    signal: new AbortController().signal,
  };
}

test("the local-provider routes save, start, read and remove one custom provider", { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hui-local-routes-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "hui");
  const agent = join(root, "agent");
  await mkdir(dir, { recursive: true });
  await mkdir(agent, { recursive: true });
  let ready = false;
  const server = createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers: {
    studio: { name: "Studio", baseUrl: endpoint, models: [{ id: "fixture" }] },
  } }));
  const marker = join(root, "started");
  const service = new LocalProviderService({ dir, agentDir: agent });
  const { handle } = createLocalProviderRoutes({ service });

  const missing = await handle(request("GET", "/__hui/other"));
  assert.equal(missing, undefined);
  const snapshot = await handle(request("GET", "/__hui/local-providers"));
  assert.equal(snapshot?.status, 200);
  const before = snapshot?.body as LocalProviderSnapshot;
  assert.equal(before.providers[0]?.id, "studio");
  assert.equal(before.providers[0]?.status, "offline");

  const invalid = await handle(request("PUT", "/__hui/local-providers/studio", { startCommand: "" }));
  assert.equal(invalid?.status, 400);
  assert.match(String((invalid?.body as { error: string }).error), /Enter a start command/u);

  const saved = await handle(request("PUT", "/__hui/local-providers/studio", { startCommand: `touch '${marker}'`, readyTimeoutMs: 10_000 }));
  assert.equal(saved?.status, 200);
  assert.equal((saved?.body as { configured: boolean }).configured, true);

  const started = await handle(request("POST", "/__hui/local-providers/studio/start"));
  assert.equal(started?.status, 200);
  assert.equal((started?.body as { status: string }).status, "starting");
  await waitFor("the start command to run", () => existsSync(marker));
  ready = true;
  const online = await waitFor("the provider to be online", async () => {
    const result = await handle(request("GET", "/__hui/local-providers"));
    const view = (result?.body as LocalProviderSnapshot).providers[0];
    return view?.status === "online" ? view : undefined;
  });
  assert.equal(online.configured, true);

  const wrongMethod = await handle(request("POST", "/__hui/local-providers"));
  assert.equal(wrongMethod?.status, 405);
  const removed = await handle(request("DELETE", "/__hui/local-providers/studio"));
  assert.equal(removed?.status, 200);
  const after = (await handle(request("GET", "/__hui/local-providers")))?.body as LocalProviderSnapshot;
  assert.equal(after.providers[0]?.configured, false);
  const removeAgain = await handle(request("DELETE", "/__hui/local-providers/studio"));
  assert.equal(removeAgain?.status, 400);
});
