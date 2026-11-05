import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";

const root = await mkdtemp(join(tmpdir(), "hui-ext-assets-"));
process.env["HUI_CONFIG_DIR"] = join(root, "config");
const extension = join(root, "config", "extensions", "hello");
await mkdir(join(root, "config", "extensions"), { recursive: true });
await cp(fileURLToPath(new URL("../../e2e/fixtures/extensions/hello", import.meta.url)), extension, { recursive: true });
await writeFile(join(extension, "ui", "notes.txt"), "not served");
await writeFile(join(extension, "ui", "big.js"), "x".repeat(10 * 1024 * 1024 + 1));
const outside = join(root, "outside.js");
await writeFile(outside, "alert(1)");
await symlink(outside, join(extension, "ui", "leak.js"));

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

async function call(method: string, path: string, headers: Record<string, string> = { "x-hui": "1" }): Promise<Response> {
  return await fetch(`${base}${path}`, { method, headers });
}

async function setEnabled(enabled: boolean): Promise<void> {
  const response = await fetch(`${base}/__hui/ext/hello`, {
    method: "PUT", headers: { "x-hui": "1", "content-type": "application/json" }, body: JSON.stringify({ enabled }),
  });
  assert.equal(response.status, 200);
}

test("a panel's files are served before the gate, sandboxed, contained and typed", async () => {
  const off = await call("GET", "/__hui/ext-ui/hello/index.html", {});
  assert.equal(off.status, 404, "a disabled extension serves no panel");

  await setEnabled(true);
  const index = await call("GET", "/__hui/ext-ui/hello/index.html", {});
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(index.headers.get("x-content-type-options"), "nosniff");
  assert.equal(index.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(index.headers.get("referrer-policy"), "no-referrer");
  assert.match(index.headers.get("permissions-policy") ?? "", /camera=\(\)/u);
  const csp = index.headers.get("content-security-policy") ?? "";
  assert.match(csp, /sandbox allow-scripts allow-forms/u);
  assert.match(csp, /connect-src 'none'/u);
  assert.match(csp, new RegExp(`script-src ${base}/__hui/ext-ui/hello/ 'unsafe-inline'`, "u"));
  assert.match(csp, /frame-ancestors 'self'/u);
  assert.match(await index.text(), /Hello panel/u, "the page loads without x-hui");

  const script = await call("GET", "/__hui/ext-ui/hello/panel.js");
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await script.text(), /hui-extension/u);

  const head = await call("HEAD", "/__hui/ext-ui/hello/index.html");
  assert.equal(head.status, 200);
  assert.equal((await head.text()).length, 0);

  const wrongMethod = await call("POST", "/__hui/ext-ui/hello/index.html");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");

  assert.equal((await call("GET", "/__hui/ext-ui/ghost/index.html")).status, 404, "unknown extension");
  assert.equal((await call("GET", "/__hui/ext-ui/hello/..%2fextension.json")).status, 404, "encoded traversal");
  assert.equal((await call("GET", "/__hui/ext-ui/hello/notes.txt")).status, 404, "type not allowed");
  assert.equal((await call("GET", "/__hui/ext-ui/hello/leak.js")).status, 404, "symlink escape");
  assert.equal((await call("GET", "/__hui/ext-ui/hello/big.js")).status, 413, "size cap");

  await setEnabled(false);
  const disabled = await call("GET", "/__hui/ext-ui/hello/index.html", {});
  assert.equal(disabled.status, 404, "disabling withdraws the panel's files");
});
