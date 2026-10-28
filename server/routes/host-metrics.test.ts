import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { HostMetrics, HostMetricsError } from "../api/host.ts";
import { expectSchema } from "../test-support/api-schema.ts";

test("the host metrics route samples this host and refuses anything but GET", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-host-metrics-routes-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  await mkdir(join(dir, "hui"), { recursive: true });
  const { middleware } = await import("../hui.ts");
  const { stopBackend } = await import("../backend.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/__hui/host-metrics`;
  t.onTestFinished(async () => {
    await stopBackend();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  const headers = { "x-hui": "1" };

  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  const metrics: unknown = await response.json();
  expectSchema(HostMetrics, metrics);
  assert.equal(metrics.host.platform, process.platform);
  assert.ok(metrics.host.cores > 0);
  assert.ok(metrics.cpu.percent >= 0 && metrics.cpu.percent <= 100);
  assert.equal(metrics.cpu.load.length, 3);
  assert.ok(metrics.memory.usedBytes > 0 && metrics.memory.usedBytes <= metrics.memory.totalBytes);
  assert.equal(metrics.disk?.path, join(dir, "hui"));
  assert.ok(metrics.disk.usedBytes > 0 && metrics.disk.usedBytes <= metrics.disk.totalBytes);
  assert.ok(metrics.gateway.rssBytes > 0);
  if (process.platform === "darwin") assert.ok(metrics.network, "netstat reports this Mac's interfaces");

  const again = await fetch(url, { headers });
  assert.deepEqual(await again.json(), metrics, "a second read within two seconds is the same sample");

  const refused = await fetch(url, { method: "POST", headers });
  assert.equal(refused.status, 405);
  expectSchema(HostMetricsError, await refused.json());
});
