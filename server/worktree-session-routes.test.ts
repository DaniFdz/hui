import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("a failed worktree launch stays listed with its prompt until dismissed", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-worktree-routes-"));
  const notRepository = await mkdtemp(join(tmpdir(), "hui-not-a-repo-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  const { middleware, stopBackend } = await import("./hui.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    stopBackend();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
    await rm(notRepository, { recursive: true, force: true });
  });

  type View = { id: string; title: string; status: string; creating?: unknown; creationError?: string; initialPrompt?: string };
  const route = async (path: string, method = "GET", payload?: unknown) => {
    const response = await fetch(origin + path, {
      method,
      headers: { "x-hui": "1", "content-type": "application/json" },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    return { status: response.status, body: await response.json() as { session?: View; groups?: { sessions: View[] }[]; error?: string } };
  };
  const listed = async () => (await route("/__hui/sessions")).body.groups?.flatMap(({ sessions }) => sessions) ?? [];

  const started = await route("/__hui/sessions", "POST", {
    cwd: notRepository, title: "Doomed", initialPrompt: "keep this prompt", worktree: true,
  });
  assert.equal(started.status, 200);
  const id = started.body.session?.id ?? "";
  assert.equal(started.body.session?.status, "starting");
  assert.ok(started.body.session?.creating);

  let failed: View | undefined;
  while (!failed) {
    failed = (await listed()).find((session) => session.id === id && session.status === "error");
    if (!failed) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(failed.creating, undefined);
  assert.match(failed.creationError ?? "", /requires a Git repository/);
  assert.equal(failed.initialPrompt, "keep this prompt");
  const opened = await route(`/__hui/sessions/${id}/open`, "POST", {});
  assert.equal(opened.status, 409);
  assert.match(opened.body.error ?? "", /Git/);

  assert.equal((await route(`/__hui/sessions/${id}`, "DELETE")).status, 200);
  assert.deepEqual(await listed(), []);
});
