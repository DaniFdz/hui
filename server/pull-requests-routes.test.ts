import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { MyPullRequests } from "../shared/pull-requests.ts";

test("lists and refreshes the operator's pull requests with linked sessions", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-pull-requests-routes-"));
  const gh = join(dir, "gh");
  const repo = join(dir, "repo");
  await mkdir(join(dir, "hui"), { recursive: true });
  await mkdir(gh);
  // No static server imports: the gateway reads XDG_CONFIG_HOME when it loads.
  execFileSync("git", ["init", "-q", "-b", "feat/x", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/acme/web.git"]);
  const now = "2026-09-30T00:00:00.000Z";
  await writeFile(join(dir, "hui/sessions.json"), JSON.stringify({
    version: 2,
    groups: [],
    sessions: [{ id: "on-branch", title: "On branch", group: "", cwd: repo, tool: "pi", createdAt: now, updatedAt: now }],
  }));
  const node = (number: number, headRefName: string) => ({
    number, url: `https://github.com/acme/web/pull/${number}`, title: `PR ${number}`, isDraft: false, updatedAt: now,
    headRefName, baseRefName: "main", reviewDecision: null, repository: { nameWithOwner: "acme/web" },
    headRepository: { nameWithOwner: "acme/web" }, author: { login: "me" }, commits: { nodes: [] },
  });
  await writeFile(join(gh, "search-created.json"), JSON.stringify([node(1, "feat/x"), node(2, "feat/y")]));
  await writeFile(join(gh, "search-review-requested.json"), JSON.stringify([node(3, "feat/x")]));

  process.env["XDG_CONFIG_HOME"] = dir;
  process.env["HUI_GITHUB_CLI"] = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));
  process.env["HUI_FAKE_GH_DIR"] = gh;
  const { middleware, stopBackend } = await import("./hui.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    stopBackend();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  const route = async (path: string, method = "GET") => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { "x-hui": "1" } });
    return { status: response.status, body: await response.json() as MyPullRequests };
  };

  const signedOut = await route("/__hui/pull-requests");
  assert.equal(signedOut.status, 200);
  assert.deepEqual(signedOut.body, { created: [], reviewRequested: [], pending: false, error: "signed_out" });

  await writeFile(join(gh, "account"), "me\n");
  const refreshed = await route("/__hui/pull-requests/refresh", "POST");
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.error, undefined);
  assert.ok(refreshed.body.fetchedAt);
  const linked = (list: MyPullRequests["created"]) => list.map((pr) => [pr.number, pr.sessions.map((session) => session.id)]);
  assert.deepEqual(linked(refreshed.body.created), [[1, ["on-branch"]], [2, []]]);
  assert.deepEqual(linked(refreshed.body.reviewRequested), [[3, ["on-branch"]]]);

  assert.equal((await route("/__hui/pull-requests/refresh")).status, 405);
  assert.equal((await route("/__hui/pull-requests", "POST")).status, 405);
});
