import assert from "node:assert/strict";
import test from "node:test";

import type { MyPullRequest } from "../../shared/pull-requests.ts";
import { approveConfirmation, matchingPullRequests, reviewCommentsAction } from "./pull-requests.ts";

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

test("the review-comments action targets the picked session, else starts one where a checkout is known", () => {
  const sessions = [{ id: "a", title: "A", archived: false, newComments: 2 }, { id: "b", title: "B", archived: false, newComments: 0 }];
  assert.deepEqual(reviewCommentsAction(pr(1, { sessions, newComments: 3 }), undefined), { kind: "send", target: sessions[0], count: 2 });
  assert.deepEqual(reviewCommentsAction(pr(1, { sessions, newComments: 3 }), "b"), {
    kind: "send", target: sessions[1], count: 0, disabled: "No new review comments since the last send to B.",
  });
  assert.equal(reviewCommentsAction(pr(1, { sessions }), "gone").target?.id, "a", "a stale pick falls back to the default");
  assert.deepEqual(reviewCommentsAction(pr(1, { newComments: 3, localCheckout: true }), undefined), { kind: "start", count: 3 });
  assert.match(reviewCommentsAction(pr(1, { newComments: 3, localCheckout: false }), undefined).disabled ?? "", /No local checkout of acme\/web/);
  assert.match(reviewCommentsAction(pr(1, { newComments: 0, localCheckout: true }), undefined).disabled ?? "", /No open review comments/);
});

test("the approval dialog names the pull request and the verdict it rests on", () => {
  const verdict = { risk: "high" as const, summary: "Rewrites auth.", reasons: [] };
  const copy = approveConfirmation(pr(3, { title: "Token refresh", assessment: { sessionId: "s", state: "verdict", verdict } }));
  assert.equal(copy.title, "Approve acme/web#3?");
  assert.match(copy.detail, /“Token refresh”/u);
  assert.match(copy.detail, /rated it high risk: Rewrites auth\./u);
});
