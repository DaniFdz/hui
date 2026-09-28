import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveStatic } from "./static-files.ts";

test("static production server serves deep links/assets but not private files, symlinks or missing assets", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "hui-static-"));
  const root = join(temporary, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<hui-app></hui-app>");
  await writeFile(join(root, "assets", "app.js"), "export const app = true;");
  await writeFile(join(temporary, "secret.txt"), "not public");
  await symlink(join(temporary, "secret.txt"), join(root, "escape.txt"));
  const server = createServer((request, response) => { void serveStatic(root, request, response); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(temporary, { recursive: true, force: true }); });
  for (const path of ["/", "/settings/tools", "/sessions/fixture", "/skills", "/kanban", "/model-providers"]) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.match(await response.text(), /hui-app/u);
  }
  const script = await fetch(base + "/assets/app.js"); assert.match(script.headers.get("content-type")!, /javascript/u);
  assert.equal((await fetch(base + "/", { method: "HEAD" })).headers.get("x-content-type-options"), "nosniff");
  for (const path of ["/.env", "/escape.txt", "/assets/missing.js", "/%2e%2e/secret.txt", "/build/cli/main.js", "/%5csecret.txt"]) assert.equal((await fetch(base + path)).status, 404, path);
  assert.equal((await fetch(base + "/%zz")).status, 400);
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
});
