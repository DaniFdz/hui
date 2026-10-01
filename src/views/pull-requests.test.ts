import assert from "node:assert/strict";
import test from "node:test";

import type { MyPullRequest } from "../../shared/pull-requests.ts";
import { matchingPullRequests } from "./pull-requests.ts";

function pr(number: number, patch: Partial<MyPullRequest> = {}): MyPullRequest {
  return {
    repository: "acme/web", number, url: `https://github.com/acme/web/pull/${number}`, title: `PR ${number}`, state: "open",
    headRefName: "main", baseRefName: "main", updatedAt: "2026-09-30T00:00:00Z", sessions: [], ...patch,
  };
}

test("pull request filter matches repository, number, title and branch", () => {
  const rows = [pr(12, { title: "Fix drawer" }), pr(7, { repository: "acme/api", headRefName: "feat/login" })];
  assert.deepEqual(matchingPullRequests(rows, "").map((row) => row.number), [12, 7]);
  assert.deepEqual(matchingPullRequests(rows, "DRAWER").map((row) => row.number), [12]);
  assert.deepEqual(matchingPullRequests(rows, "acme/api").map((row) => row.number), [7]);
  assert.deepEqual(matchingPullRequests(rows, "#12").map((row) => row.number), [12]);
  assert.deepEqual(matchingPullRequests(rows, "web#7").map((row) => row.number), []);
  assert.deepEqual(matchingPullRequests(rows, "feat/login").map((row) => row.number), [7]);
});
