import assert from "node:assert/strict";
import test from "node:test";

import { assertFailing, fetchPullRequestCi, fixCiMessage, NoFailingChecksError, parseFailingChecks, type PullRequestCi } from "./pull-request-ci.ts";
import { parsePullRequestSearch, searchQuery } from "./my-pull-requests.ts";

const run = (name: string, conclusion: string | null, detailsUrl = `https://github.com/acme/web/actions/runs/1/job/${name}`) => ({ __typename: "CheckRun", name, conclusion, detailsUrl });
const status = (context: string, state: string, targetUrl = `https://ci.example.com/${context}`) => ({ __typename: "StatusContext", context, state, targetUrl });

test("failing checks are check runs by conclusion and statuses by state, bounded", () => {
  assert.deepEqual(parseFailingChecks({ state: "FAILURE", contexts: { nodes: [
    run("lint", "SUCCESS"),
    run("unit", "FAILURE"),
    run("e2e", "TIMED_OUT", "javascript:alert(1)"),
    run("build", null),
    status("gitlab/test", "ERROR"),
    status("gitlab/deploy", "PENDING"),
    status("", "FAILURE"),
  ] } }), [
    { name: "unit", state: "failure", url: "https://github.com/acme/web/actions/runs/1/job/unit" },
    { name: "e2e", state: "timed_out" },
    { name: "gitlab/test", state: "error", url: "https://ci.example.com/gitlab/test" },
  ]);
  assert.equal(parseFailingChecks({ contexts: { nodes: Array.from({ length: 60 }, (_, index) => run(`job-${index}`, "FAILURE")) } }).length, 30);
  assert.deepEqual(parseFailingChecks(null), []);
});

test("the Created search selects the head and failing checks; Review requested only the head", () => {
  assert.match(searchQuery(true), /headRefOid[\s\S]*statusCheckRollup \{ state\s+contexts\(first: 100\)/u);
  assert.doesNotMatch(searchQuery(false), /contexts/u);
  const [pr] = parsePullRequestSearch({ data: { search: { nodes: [{
    number: 3, url: "https://github.com/acme/web/pull/3", title: "t", isDraft: false, updatedAt: "2026-09-30T10:00:00Z",
    headRefName: "feat/x", headRefOid: "a".repeat(40), baseRefName: "main", repository: { nameWithOwner: "acme/web" },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [run("unit", "FAILURE")] } } } }] },
  }] } } });
  assert.equal(pr?.headRefOid, "a".repeat(40));
  assert.equal(pr?.checks, "failure");
  assert.deepEqual(pr?.failingChecks, [{ name: "unit", state: "failure", url: "https://github.com/acme/web/actions/runs/1/job/unit" }]);
});

test("reads one pull request's checks again", async () => {
  const calls: (readonly string[])[] = [];
  const ci = await fetchPullRequestCi(async (args) => {
    calls.push(args);
    return { data: { repository: { pullRequest: { headRefOid: "b".repeat(40), headRefName: "feat/x", commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR", contexts: { nodes: [status("ci", "FAILURE")] } } } }] } } } } };
  }, { repository: "acme/web", number: 3 });
  assert.deepEqual(ci, { headRefOid: "b".repeat(40), headRefName: "feat/x", state: "error", failing: [{ name: "ci", state: "failure", url: "https://ci.example.com/ci" }] });
  assert.deepEqual(calls[0]?.filter((arg) => !arg.startsWith("query=")), ["api", "graphql", "-f", "-f", "owner=acme", "-f", "name=web", "-F", "number=3"]);
  await assert.rejects(fetchPullRequestCi(async () => ({ data: { repository: { pullRequest: null } } }), { repository: "acme/web", number: 3 }), /unavailable/);
});

const pr = { repository: "acme/web", number: 3, url: "https://github.com/acme/web/pull/3", title: "Fix checkout" };
const ci = (failing: PullRequestCi["failing"], state = "failure"): PullRequestCi => ({ headRefOid: "c".repeat(40), headRefName: "feat/x", state, failing });

test("Fix CI requires failing checks now", () => {
  assert.throws(() => assertFailing(ci([], "success")), NoFailingChecksError);
  assert.throws(() => assertFailing(ci([], "pending")), NoFailingChecksError);
  assertFailing(ci([], "failure"));
  assertFailing(ci([{ name: "unit", state: "failure" }], "pending"));
});

test("the Fix CI message lists each failing check with its link, head and branch, bounded", () => {
  const message = fixCiMessage(pr, ci([
    { name: "unit", state: "failure", url: "https://github.com/acme/web/actions/runs/9/job/1" },
    { name: "gitlab/e2e", state: "timed_out" },
  ]));
  assert.equal(message.included, 2);
  assert.equal(message.omitted, 0);
  assert.match(message.text, /^CI is failing on acme\/web#3 \(Fix checkout\): https:\/\/github\.com\/acme\/web\/pull\/3\n/u);
  assert.match(message.text, new RegExp(`Head commit ${"c".repeat(40)} on branch feat/x\\.`, "u"));
  assert.match(message.text, /1\. unit \(failure\): https:\/\/github\.com\/acme\/web\/actions\/runs\/9\/job\/1\n2\. gitlab\/e2e \(timed out\)\n/u);
  assert.match(message.text, /gh pr checks 3 -R acme\/web/u);
  assert.match(message.text, /--log-failed/u);
  assert.match(message.text, /re-run the ones that look flaky/u);
  assert.match(message.text, /push, and report/u);

  const many = Array.from({ length: 30 }, (_, index) => ({ name: `job-${index}-${"x".repeat(280)}`, state: "failure", url: `https://ci.example.com/${"y".repeat(480)}` }));
  const bounded = fixCiMessage(pr, ci(many), 8_000);
  assert.ok(Buffer.byteLength(bounded.text) <= 8_000);
  assert.ok(bounded.included > 0 && bounded.omitted > 0);
  assert.equal(bounded.included + bounded.omitted, 30);
  assert.match(bounded.text, new RegExp(`${bounded.omitted} more failing checks are not listed`, "u"));
  assert.ok(Buffer.byteLength(fixCiMessage(pr, ci(many)).text) <= 20_000);

  assert.match(fixCiMessage(pr, ci([])).text, /did not name them/u);
});
