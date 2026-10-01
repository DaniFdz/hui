import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { MyPullRequests } from "../shared/pull-requests.ts";

test("risk reviews: assess, approve with the exact gh argv, dismiss, keep and stale cleanup", { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-pr-review-routes-"));
  const gh = join(dir, "gh");
  const reviews = join(dir, "hui", "pr-reviews");
  const transcripts = join(dir, "pi-sessions");
  await mkdir(gh);
  await mkdir(transcripts);
  await mkdir(join(reviews, "unrelated"), { recursive: true });
  await writeFile(join(transcripts, "unrelated.jsonl"), "{}\n");
  const now = new Date().toISOString();
  /** A temporary review with a transcript and a scratch directory on disk. */
  const review = async (id: string, number: number, createdAt = now) => {
    const scratchDir = join(reviews, id);
    await mkdir(scratchDir);
    await writeFile(join(scratchDir, "notes.txt"), "scratch\n");
    await writeFile(join(transcripts, `${id}.jsonl`), "{}\n");
    return {
      id, title: `Risk review ${number}`, group: "", cwd: scratchDir, tool: "pi", createdAt, updatedAt: createdAt,
      piSessionFile: join(transcripts, `${id}.jsonl`),
      temporary: { kind: "pr-review", pullRequestUrl: `https://github.com/acme/web/pull/${number}`, scratchDir },
    };
  };
  const sessions = [
    await review("review-3", 3),
    await review("review-4", 4),
    await review("review-5", 5),
    await review("stale", 8, new Date(Date.now() - 25 * 60 * 60_000).toISOString()),
    { id: "normal", title: "Normal", group: "", cwd: dir, tool: "pi", createdAt: now, updatedAt: now },
  ];
  await writeFile(join(dir, "hui", "sessions.json"), JSON.stringify({ version: 2, groups: [], sessions }));
  const node = (number: number) => ({
    number, url: `https://github.com/acme/web/pull/${number}`, title: `PR ${number}`, isDraft: false, updatedAt: now,
    headRefName: `feat/${number}`, baseRefName: "main", reviewDecision: "REVIEW_REQUIRED", repository: { nameWithOwner: "acme/web" },
    headRepository: { nameWithOwner: "acme/web" }, author: { login: "lana" }, commits: { nodes: [] },
  });
  await writeFile(join(gh, "search-review-requested.json"), JSON.stringify([3, 4, 5, 6].map(node)));
  await writeFile(join(gh, "account"), "me\n");

  process.env["XDG_CONFIG_HOME"] = dir;
  process.env["HUI_GITHUB_CLI"] = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));
  process.env["HUI_FAKE_GH_DIR"] = gh;
  // A runtime that cannot start: an assessment's first prompt is never accepted.
  process.env["HUI_PI_BACKEND"] = "cli";
  process.env["HUI_PI_CLI"] = join(dir, "missing-pi");
  const { middleware, startBackend, stopBackend } = await import("./hui.ts");
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
  const post = async (action: string, body: unknown, method = "POST") => {
    const response = await fetch(`${origin}/__hui/pull-requests/${action}`, {
      method, headers: { "x-hui": "1", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as MyPullRequests & { error?: string; sessionId?: string } };
  };
  const registry = async () => (JSON.parse(await readFile(join(dir, "hui", "sessions.json"), "utf8")) as { sessions: { id: string; temporary?: unknown }[] }).sessions;
  const url = (number: number) => `https://github.com/acme/web/pull/${number}`;

  // Gateway start deletes temporary reviews older than a day, like a dismissal.
  await startBackend();
  assert.equal((await registry()).some((item) => item.id === "stale"), false);
  assert.equal(existsSync(join(reviews, "stale")), false);
  assert.equal(existsSync(join(transcripts, "stale.jsonl")), false);

  const page = await (await fetch(`${origin}/__hui/pull-requests`, { headers: { "x-hui": "1" } })).json() as MyPullRequests;
  const byNumber = new Map(page.reviewRequested.map((pr) => [pr.number, pr]));
  assert.deepEqual(byNumber.get(3)?.assessment, { sessionId: "review-3", state: "no_verdict" }, "settled without report_pr_risk");
  assert.equal(byNumber.get(6)?.assessment, undefined);
  assert.ok(page.reviewRequested.every((pr) => pr.sessions.every((session) => !session.id.startsWith("review-"))), "temporary reviews are not linked sessions");

  assert.equal((await post("approve", undefined, "GET")).status, 405);
  assert.equal((await post("assess", { url: "https://example.com/acme/web/pull/6" })).status, 400);
  assert.equal((await post("assess", { url: url(99) })).status, 404, "only the current Review requested list");
  assert.equal((await post("approve", { url: url(6) })).status, 404, "no review to approve on");
  assert.equal((await post("assess", { url: url(3) })).status, 409, "one assessment per pull request");

  const failedStart = await post("assess", { url: url(6) });
  assert.equal(failedStart.status, 500);
  assert.equal((await registry()).some((item) => item.temporary && JSON.stringify(item.temporary).includes("/pull/6")), false, "a failed start leaves no row");
  assert.deepEqual((await readdir(reviews)).toSorted(), ["review-3", "review-4", "review-5", "unrelated"], "nor a scratch directory");

  await writeFile(join(gh, "review-fail"), "GraphQL: Can not approve your own pull request (addPullRequestReview)\n");
  const refused = await post("approve", { url: url(3) });
  assert.equal(refused.status, 502);
  assert.match(refused.body.error ?? "", /Can not approve your own pull request/u);
  assert.ok((await registry()).some((item) => item.id === "review-3"), "a failed approval keeps the review");
  assert.ok(existsSync(join(reviews, "review-3")));
  await rm(join(gh, "review-fail"));

  const approved = await post("approve", { url: url(3) });
  assert.equal(approved.status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(gh, "pr-review-args"), "utf8")), ["pr", "review", "3", "-R", "acme/web", "--approve"]);
  assert.equal(approved.body.reviewRequested.some((pr) => pr.number === 3), false, "the row refreshes");
  assert.equal((await registry()).some((item) => item.id === "review-3"), false);
  assert.equal(existsSync(join(reviews, "review-3")), false);
  assert.equal(existsSync(join(transcripts, "review-3.jsonl")), false);
  await rm(join(gh, "pr-review-args"));

  const dismissed = await post("dismiss", { url: url(4) });
  assert.equal(dismissed.status, 200);
  assert.equal(existsSync(join(gh, "pr-review-args")), false, "dismiss never reviews");
  assert.equal(dismissed.body.reviewRequested.find((pr) => pr.number === 4)?.assessment, undefined);
  assert.equal(existsSync(join(reviews, "review-4")), false);
  assert.equal(existsSync(join(transcripts, "review-4.jsonl")), false);

  const kept = await post("keep", { url: url(5) });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.reviewRequested.find((pr) => pr.number === 5)?.assessment, undefined);
  const keptRecord = (await registry()).find((item) => item.id === "review-5");
  assert.ok(keptRecord && !keptRecord.temporary, "keep converts it into a normal session");
  assert.ok(existsSync(join(reviews, "review-5", "notes.txt")), "and deletes nothing");
  assert.ok(existsSync(join(transcripts, "review-5.jsonl")));

  // Nothing else was touched.
  assert.deepEqual((await readdir(reviews)).toSorted(), ["review-5", "unrelated"]);
  assert.deepEqual((await readdir(transcripts)).toSorted(), ["review-5.jsonl", "unrelated.jsonl"]);
  assert.ok((await registry()).some((item) => item.id === "normal"));
});
