import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createTerminalRoutes } from "./terminals.ts";
import type { RouteRequest } from "../http/route.ts";
import { terminals } from "../terminals/terminals.ts";
import { WorkerNotFoundError } from "../workers.ts";
import type { SessionRecord } from "../sessions/sessions.ts";

function request(method: string, path: string, body?: unknown): RouteRequest {
  return {
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    json: async () => body,
    bytes: async () => Buffer.alloc(0),
    stream: async function* () { /* No body for a terminal request. */ },
    signal: new AbortController().signal,
  };
}

async function created(body: unknown) {
  assert(body && typeof body === "object" && "terminal" in body);
  return (body as { terminal: { id: string; cwd: string; status: string } }).terminal;
}

test("a conversation on a worker opens its shell through that worker's connect command", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "hui-worker-terminal-"));
  t.onTestFinished(async () => { terminals.dispose(); await rm(cwd, { recursive: true, force: true }); });
  const record = (id: string, cwd: string, worker?: string) => ({ id, title: id, group: "", cwd, tool: "pi", ...(worker ? { worker } : {}) });
  const sessions = [record("here", cwd), record("there", "/srv/remote-work", "w1"), record("orphan", cwd, "gone")];
  const workers = {
    get: async (id: string) => {
      if (id !== "w1") throw new WorkerNotFoundError("That worker no longer exists.");
      return { command: ["/bin/sh", "-i"] };
    },
  };
  const routes = createTerminalRoutes({ readRegistry: async () => sessions as SessionRecord[], workers });

  const remote = await routes.handle(request("POST", "/__hui/sessions/there/terminals", {}));
  assert(remote && "body" in remote && remote.status === 201, JSON.stringify(remote));
  const view = await created(remote.body);
  assert.equal(view.cwd, "/srv/remote-work", "the terminal names the directory on that machine");
  assert.equal(view.status, "running");
  assert.equal(terminals.list("there").length, 1);

  const orphan = await routes.handle(request("POST", "/__hui/sessions/orphan/terminals", {}));
  assert(orphan && "body" in orphan);
  assert.deepEqual([orphan.status, (orphan.body as { error: string }).error], [409, "That worker no longer exists. Its terminal cannot open."]);

  const local = await routes.handle(request("POST", "/__hui/sessions/here/terminals", {}));
  assert(local && "body" in local && local.status === 201, "a conversation here keeps its local shell");
  assert.equal((await created(local.body)).cwd, cwd);
});
