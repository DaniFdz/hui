import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { MyPullRequests } from "../shared/pull-requests.ts";

test("fix-ci is validated, re-reads the checks and records nothing on a failed delivery", { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-fix-ci-routes-"));
  const gh = join(dir, "gh");
  const repo = join(dir, "repo");
  await mkdir(join(dir, "hui"), { recursive: true });
  await mkdir(gh);
  execFileSync("git", ["init", "-q", "-b", "feat/x", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@work.github.com:acme/web.git"]);
  const now = "2026-09-30T00:00:00.000Z";
  const sessions = [{ id: "linked", title: "Linked", group: "", cwd: repo, tool: "pi", createdAt: now, updatedAt: now }];
  await writeFile(join(dir, "hui/sessions.json"), JSON.stringify({ version: 2, groups: [], sessions }));
  const rollup = (state: string, conclusion: string) => ({ state, contexts: { nodes: [{ __typename: "CheckRun", name: "unit", conclusion, detailsUrl: "https://github.com/acme/web/actions/runs/1/job/2" }] } });
  const node = (number: number, repository: string, state = "FAILURE", conclusion = "FAILURE") => ({
    number, url: `https://github.com/${repository}/pull/${number}`, title: `PR ${number}`, isDraft: false, updatedAt: now,
    headRefName: "feat/x", headRefOid: "f".repeat(40), baseRefName: "main", reviewDecision: null, repository: { nameWithOwner: repository },
    headRepository: { nameWithOwner: repository }, author: { login: "me" }, reviewThreads: { nodes: [] }, reviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: rollup(state, conclusion) } }] },
  });
  const created = (...nodes: unknown[]) => writeFile(join(gh, "search-created.json"), JSON.stringify(nodes));
  await created(node(1, "acme/web"), node(2, "acme/api"));
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
    const response = await fetch(`${origin}/__hui/pull-requests/fix-ci`, {
      method, headers: { "x-hui": "1", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  };
  const page = async () => (await (await fetch(`${origin}/__hui/pull-requests`, { headers: { "x-hui": "1" } })).json()) as MyPullRequests;

  const [web, api] = (await page()).created;
  assert.equal(web?.headRefOid, "f".repeat(40));
  assert.deepEqual(web?.failingChecks, [{ name: "unit", state: "failure", url: "https://github.com/acme/web/actions/runs/1/job/2" }]);
  assert.deepEqual(web?.sessions.map((session) => session.id), ["linked"], "linked through an SSH host alias remote");
  assert.equal(web?.sessions[0]?.ciFixSent, undefined);

  assert.equal((await send(undefined, "GET")).status, 405);
  assert.equal((await send({ url: "https://example.com/acme/web/pull/1" })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1/checks" })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1", sessionId: 1 })).status, 400);
  assert.equal((await send({ url: "https://github.com/acme/web/pull/99", sessionId: "linked" })).status, 404, "only the current Created list");
  assert.equal((await send({ url: "https://github.com/acme/web/pull/1", sessionId: "missing" })).status, 404);
  const noCheckout = await send({ url: api!.url });
  assert.equal(noCheckout.status, 409);
  assert.match(noCheckout.body.error ?? "", /No local checkout of acme\/api/u);

  // The checks passed since the list was fetched: read again, nothing is sent.
  await created(node(1, "acme/web", "SUCCESS", "SUCCESS"), node(2, "acme/api"));
  const green = await send({ url: web!.url, sessionId: "linked" });
  assert.equal(green.status, 409);
  assert.match(green.body.error ?? "", /No checks are failing/u);

  await created(node(1, "acme/web"), node(2, "acme/api"));
  const before = await readFile(join(dir, "hui/sessions.json"), "utf8");
  const failed = await send({ url: web!.url, sessionId: "linked" });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error ?? "", /runtime|start/iu);
  assert.equal((await page()).created[0]?.sessions[0]?.ciFixSent, undefined, "a failed delivery is not marked as sent");
  assert.equal(await readFile(join(dir, "hui/sessions.json"), "utf8"), before, "Fix CI persists nothing");
});
