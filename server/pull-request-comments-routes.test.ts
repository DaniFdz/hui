import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { MyPullRequests } from "../shared/pull-requests.ts";

test("review comments are validated, counted per session and persisted only on delivery", { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-review-comments-routes-"));
  const gh = join(dir, "gh");
  const repo = join(dir, "repo");
  await mkdir(join(dir, "hui"), { recursive: true });
  await mkdir(gh);
  execFileSync("git", ["init", "-q", "-b", "feat/x", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/acme/web.git"]);
  const now = "2026-09-30T00:00:00.000Z";
  const session = (id: string, patch = {}) => ({ id, title: id, group: "", cwd: repo, tool: "pi", createdAt: now, updatedAt: now, ...patch });
  const sessions = [
    session("fresh"),
    session("sent", { pullRequestComments: [{ url: "https://github.com/acme/web/pull/1", sentAt: "2026-09-30T09:00:00Z" }] }),
  ];
  await writeFile(join(dir, "hui/sessions.json"), JSON.stringify({ version: 2, groups: [], sessions }));
  const comment = (login: string, createdAt: string) => ({ author: { login }, body: `${login} at ${createdAt}`, createdAt, url: `https://github.com/acme/web/pull/1#discussion_${login}` });
  const node = (number: number, repository: string, patch = {}) => ({
    number, url: `https://github.com/${repository}/pull/${number}`, title: `PR ${number}`, isDraft: false, updatedAt: now,
    headRefName: "feat/x", baseRefName: "main", reviewDecision: null, repository: { nameWithOwner: repository },
    headRepository: { nameWithOwner: repository }, author: { login: "me" }, commits: { nodes: [] },
    reviewThreads: { nodes: [{ isResolved: false, isOutdated: false, path: "a.ts", line: 1, comments: { nodes: [comment("lana", "2026-09-30T08:00:00Z"), comment("omar", "2026-09-30T10:00:00Z")] } }] },
    reviews: { nodes: [] },
    ...patch,
  });
  await writeFile(join(gh, "search-created.json"), JSON.stringify([node(1, "acme/web"), node(2, "acme/api")]));
  await writeFile(join(gh, "account"), "me\n");

  process.env["XDG_CONFIG_HOME"] = dir;
  process.env["HUI_GITHUB_CLI"] = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));
  process.env["HUI_FAKE_GH_DIR"] = gh;
  // A runtime that cannot start: every delivery fails.
  process.env["HUI_PI_BACKEND"] = "cli";
  process.env["HUI_PI_CLI"] = join(dir, "missing-pi");
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
  const origin = `http://127.0.0.1:${address.port}`;
  const send = async (body: unknown, method = "POST") => {
    const response = await fetch(`${origin}/__hui/pull-requests/review-comments`, {
      method, headers: { "x-hui": "1", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  };

  const page = await (await fetch(`${origin}/__hui/pull-requests`, { headers: { "x-hui": "1" } })).json() as MyPullRequests;
  const [web, api] = page.created;
  assert.equal(web?.newComments, 2);
  assert.equal(web?.localCheckout, true);
  assert.deepEqual(web?.sessions.map((item) => [item.id, item.newComments]).toSorted(), [["fresh", 2], ["sent", 1]]);
  assert.equal(api?.localCheckout, false);
  assert.equal(JSON.stringify(page).includes("reviewComments"), false, "comment bodies stay on the server");

  assert.equal((await send(undefined, "GET")).status, 405);
  assert.equal((await send({ url: "https://example.com/acme/web/pull/1", sessionId: "fresh" })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1/files", sessionId: "fresh" })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1", sessionId: 7 })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/99", sessionId: "fresh" })).status, 404, "only the current Created list");
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1", sessionId: "missing" })).status, 404);
  const noCheckout = await send({ url: "https://github.com/acme/api/pull/2" });
  assert.equal(noCheckout.status, 409);
  assert.match(noCheckout.body.error ?? "", /No local checkout of acme\/api/);

  // Nothing newer than the last send, read from GitHub again rather than the cache.
  await writeFile(join(gh, "search-created.json"), JSON.stringify([node(1, "acme/web", { reviewThreads: { nodes: [] } })]));
  const nothing = await send({ url: "https://github.com/acme/web/pull/1", sessionId: "sent" });
  assert.equal(nothing.status, 409);
  assert.match(nothing.body.error ?? "", /No new review comments/);

  await writeFile(join(gh, "search-created.json"), JSON.stringify([node(1, "acme/web")]));
  const before = await readFile(join(dir, "hui/sessions.json"), "utf8");
  const failed = await send({ url: "https://github.com/acme/web/pull/1", sessionId: "fresh" });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error ?? "", /runtime|start/i);
  const after = JSON.parse(await readFile(join(dir, "hui/sessions.json"), "utf8")) as { sessions: { id: string; pullRequestComments?: unknown }[] };
  assert.equal(after.sessions.find((item) => item.id === "fresh")?.pullRequestComments, undefined, "a failed delivery persists nothing");
  assert.deepEqual(after.sessions.find((item) => item.id === "sent")?.pullRequestComments, JSON.parse(before).sessions[1].pullRequestComments);
});
