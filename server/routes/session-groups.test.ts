/** Creating a session group together with its New session defaults, over the route that owns the validation. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { RouteRequest } from "../http/route.ts";
import { SessionError, SessionList } from "../api/sessions.ts";
import { expectSchema } from "../test-support/api-schema.ts";

// The registry path is read once, at import time, so the throwaway home has to
// exist before the modules load.
const home = await mkdtemp(join(tmpdir(), "hui-session-group-routes-"));
process.env["HOME"] = home;
process.env["XDG_CONFIG_HOME"] = home;

const { createSessionRoutes } = await import("./sessions.ts");
const { readSessionGroups, writeRegistry } = await import("../sessions/sessions.ts");

const list: SessionList = { revision: 7, groups: [] };

const routes = createSessionRoutes({
  sessionList: { refresh: async () => list, snapshot: async () => list },
  // The group routes read the registry and the workers, never a runtime.
  lifecycle: {} as never,
  views: {} as never,
  bots: {} as never,
  workers: { list: async () => [{ id: "worker-1", name: "Worker one", command: "ssh box", extraPaths: [], state: "disconnected" }] },
});

function request(body: unknown): RouteRequest {
  return {
    method: "POST",
    path: "/__hui/session-groups",
    query: new URLSearchParams(),
    headers: {},
    json: async () => body,
    bytes: async () => Buffer.alloc(0),
    stream: () => (async function* () {})() as AsyncIterable<Buffer>,
    signal: new AbortController().signal,
  };
}

async function create(body: unknown) {
  return routes.handle(request(body));
}

test("a group is created with the New session defaults it was given", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hui-group-cwd-"));
  await writeRegistry([]);
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const created = await create({
    name: " Research ", cwd: directory, worker: "worker-1", workspaceMode: "worktree", baseRef: " release/1.0 ",
  });
  assert.equal(created?.status, 200);
  expectSchema(SessionList, created?.body);
  assert.deepEqual(created?.body, list, "the answer is the refreshed list");
  assert.deepEqual(await readSessionGroups(), [{
    label: "Research", cwd: directory, workspaceMode: "worktree", baseRef: "release/1.0", worker: "worker-1",
  }]);
});

test("a refused default, a reserved name or a missing one creates no group", async () => {
  await writeRegistry([]);
  const missing = join(home, "not-a-directory");
  const cases: [unknown, RegExp][] = [
    [{ name: "No directory", cwd: missing }, /No such directory/u],
    [{ name: "Unknown worker", worker: "ghost" }, /No worker named ghost/u],
    [{ name: "Bad environment", workspaceMode: "vm" }, /Environment must be branch or worktree/u],
    [{ name: "Relative remote", worker: "worker-1", cwd: "relative/checkout" }, /A remote directory must be absolute/u],
    [{ name: "Too long", baseRef: "x".repeat(201) }, /at most 200 characters/u],
    [{ name: "ungrouped" }, /"ungrouped" is reserved/u],
    [{}, /A group name is required/u],
  ];
  for (const [body, error] of cases) {
    const refused = await create(body);
    assert.equal(refused?.status, 400, JSON.stringify(body));
    expectSchema(SessionError, refused?.body);
    assert.match((refused?.body as { error: string }).error, error);
  }
  assert.deepEqual(await readSessionGroups(), []);
});

test("a second group cannot take a name that exists, and the first keeps its defaults", async () => {
  await writeRegistry([]);
  assert.equal((await create({ name: "One", baseRef: "main" }))?.status, 200);
  const duplicate = await create({ name: "One", baseRef: "other" });
  assert.equal(duplicate?.status, 400);
  assert.match(((await duplicate?.body) as { error: string }).error, /already exists/u);
  assert.deepEqual(await readSessionGroups(), [{ label: "One", baseRef: "main" }]);
});

test("empty New session defaults are stored as unset", async () => {
  await writeRegistry([]);
  const created = await create({ name: "Plain", cwd: "", worker: "", workspaceMode: "", baseRef: "" });
  assert.equal(created?.status, 200);
  assert.deepEqual(await readSessionGroups(), [{ label: "Plain" }]);
});
