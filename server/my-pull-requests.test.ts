import assert from "node:assert/strict";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitHubApiError } from "./github-previews.ts";
import {
  correlateSessions,
  CREATED_SEARCH,
  fetchMyPullRequests,
  MyPullRequestsCache,
  parseGitHubRemotes,
  parsePullRequestSearch,
  readCheckouts,
  REVIEW_REQUESTED_SEARCH,
  type Checkout,
  type CorrelationSession,
  type FoundPullRequest,
  type PullRequestLists,
} from "./my-pull-requests.ts";
import { runCommand } from "./worktree-inventory.ts";

function node(number: number, patch: Record<string, unknown> = {}) {
  return {
    number,
    url: `https://github.com/acme/web/pull/${number}`,
    title: ` PR ${number} `,
    isDraft: false,
    updatedAt: "2026-09-30T10:00:00Z",
    headRefName: `feat/${number}`,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    repository: { nameWithOwner: "acme/web" },
    headRepository: { nameWithOwner: "fork/web" },
    author: { login: "octo" },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
    ...patch,
  };
}

const search = (...nodes: unknown[]) => ({ data: { search: { nodes } } });

test("parses search nodes and drops malformed ones", () => {
  const parsed = parsePullRequestSearch(search(
    node(1),
    node(2, { isDraft: true, reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, headRepository: null, author: null }),
    {},
    node(3, { url: "https://example.com/acme/web/pull/3" }),
    node(4, { number: 5 }),
  ));
  assert.deepEqual(parsed, [
    {
      repository: "acme/web", number: 1, url: "https://github.com/acme/web/pull/1", title: "PR 1", state: "open",
      headRefName: "feat/1", headRepository: "fork/web", baseRefName: "main", author: "octo",
      updatedAt: "2026-09-30T10:00:00Z", reviewDecision: "review_required", checks: "failure",
    },
    {
      repository: "acme/web", number: 2, url: "https://github.com/acme/web/pull/2", title: "PR 2", state: "draft",
      headRefName: "feat/2", baseRefName: "main", updatedAt: "2026-09-30T10:00:00Z",
    },
  ]);
  assert.throws(() => parsePullRequestSearch({ errors: [{ message: "bad" }] }), GitHubApiError);
});

test("fetches both searches with one graphql call each", async () => {
  const calls: string[] = [];
  const lists = await fetchMyPullRequests(async (args) => {
    assert.deepEqual(args.slice(0, 3), ["api", "graphql", "-f"]);
    const q = args.at(-1)!.replace(/^q=/u, "");
    calls.push(q);
    return search(node(q === CREATED_SEARCH ? 1 : 2));
  });
  assert.deepEqual(calls.toSorted(), [CREATED_SEARCH, REVIEW_REQUESTED_SEARCH].toSorted());
  assert.deepEqual([lists.created[0]?.number, lists.reviewRequested[0]?.number], [1, 2]);
});

test("parses github.com remotes in https, scp and ssh forms", () => {
  assert.deepEqual(parseGitHubRemotes([
    "origin\tgit@github.com:acme/web.git (fetch)",
    "origin\tgit@github.com:acme/web.git (push)",
    "fork\thttps://github.com/me/web (fetch)",
    "alt\tssh://git@github.com/acme/docs.site.git (fetch)",
    "other\thttps://gitlab.com/acme/web.git (fetch)",
  ].join("\n")), ["acme/web", "me/web", "acme/docs.site"]);
});

const pr: Pick<FoundPullRequest, "url" | "repository" | "headRepository" | "headRefName"> = {
  url: "https://github.com/acme/web/pull/7", repository: "acme/web", headRefName: "feat/x",
};

function session(id: string, patch: Partial<CorrelationSession> = {}): CorrelationSession {
  return { id, title: id, archived: false, cwd: `/w/${id}`, updatedAt: "2026-09-30T00:00:00Z", createdPullRequests: [], ...patch };
}

test("links creators and head-branch checkouts, newest first and archived last", () => {
  const checkouts = new Map<string, Checkout>([
    ["/w/branch", { branch: "feat/x", repositories: ["ACME/web"] }],
    ["/w/other-branch", { branch: "main", repositories: ["acme/web"] }],
    ["/w/other-repo", { branch: "feat/x", repositories: ["acme/api"] }],
    ["/w/old", { branch: "feat/x", repositories: ["acme/web"] }],
    ["/w/archived", { branch: "feat/x", repositories: ["acme/web"] }],
  ]);
  const sessions = [
    session("archived", { archived: true, updatedAt: "2026-09-30T09:00:00Z" }),
    session("old", { updatedAt: "2026-09-29T00:00:00Z" }),
    session("creator", { cwd: "/elsewhere", updatedAt: "2026-09-30T05:00:00Z", createdPullRequests: ["https://github.com/Acme/Web/pull/7"] }),
    session("branch", { updatedAt: "2026-09-30T06:00:00Z" }),
    session("other-branch"),
    session("other-repo"),
    session("unrelated", { createdPullRequests: ["https://github.com/acme/web/pull/70"] }),
  ];
  assert.deepEqual(correlateSessions(pr, sessions, checkouts).map((s) => s.id), ["branch", "creator", "old", "archived"]);
  assert.deepEqual(correlateSessions({ ...pr, repository: "up/web", headRepository: "acme/web" }, [session("branch")], checkouts).map((s) => s.id), ["branch"]);
  assert.deepEqual(correlateSessions({ ...pr, headRefName: "" }, [session("branch")], new Map([["/w/branch", { branch: "", repositories: ["acme/web"] }]])), []);
});

test("reads checkouts through symlinked directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-my-prs-"));
  const repo = join(root, "repo");
  const git = async (...args: string[]) => assert.equal((await runCommand("git", args)).code, 0);
  await git("init", "-q", "-b", "feat/x", repo);
  await git("-C", repo, "remote", "add", "origin", "git@github.com:acme/web.git");
  const alias = join(root, "alias");
  await symlink(repo, alias);
  const calls: string[][] = [];
  const checkouts = await readCheckouts([repo, alias, join(root, "missing")], (file, args, options) => {
    calls.push([...args]);
    return runCommand(file, args, options);
  });
  assert.deepEqual(checkouts.get(alias), { branch: "feat/x", repositories: ["acme/web"] });
  assert.deepEqual(checkouts.get(repo), checkouts.get(alias));
  assert.equal(checkouts.has(join(root, "missing")), false);
  assert.equal(calls.length, 2, "aliases of one checkout share one read");
});

test("serves cached lists while revalidating and keeps them on failure", async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  let release!: () => void;
  let gate: Promise<void> | undefined;
  const lists = (n: number): PullRequestLists => ({ created: parsePullRequestSearch(search(node(n))), reviewRequested: [] });
  const cache = new MyPullRequestsCache(async () => {
    calls += 1;
    if (gate) await gate;
    if (fail) throw new GitHubApiError("signed_out");
    return lists(calls);
  }, { now: () => now, ttlMs: 60_000 });

  const first = await cache.view();
  assert.equal(first.created[0]?.number, 1, "the first load waits");
  assert.equal(first.pending, false);
  assert.equal(first.fetchedAt, new Date(0).toISOString());

  now = 30_000;
  assert.equal((await cache.view()).created[0]?.number, 1);
  assert.equal(calls, 1, "fresh data is not refetched");

  now = 61_000;
  gate = new Promise((resolve) => { release = resolve; });
  const stale = await cache.view();
  assert.equal(stale.created[0]?.number, 1, "stale data is served without waiting");
  assert.equal(stale.pending, true);
  release();
  gate = undefined;
  const refreshed = await cache.refresh();
  assert.equal(refreshed.created[0]?.number, 2);
  assert.equal(calls, 2, "refresh joins the running fetch");

  fail = true;
  const failed = await cache.refresh();
  assert.equal(failed.error, "signed_out");
  assert.equal(failed.created[0]?.number, 2, "last confirmed lists are kept");
  assert.equal(failed.fetchedAt, new Date(61_000).toISOString());

  fail = false;
  const recovered = await cache.refresh();
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.created[0]?.number, 4);
});

test("a first-load failure is reported with empty lists", async () => {
  const cache = new MyPullRequestsCache(async () => { throw new GitHubApiError("cli_missing"); });
  assert.deepEqual(await cache.view(), { created: [], reviewRequested: [], pending: false, error: "cli_missing" });
  const other = new MyPullRequestsCache(async () => { throw new GitHubApiError("not_found"); });
  assert.equal((await other.view()).error, "unavailable");
});
