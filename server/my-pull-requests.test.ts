import assert from "node:assert/strict";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitHubApiError } from "./github-previews.ts";
import {
  correlateSessions,
  createdSearch,
  effectiveAccounts,
  fetchMyPullRequests,
  mergeAccountRows,
  MyPullRequestsCache,
  parseGitHubRemotes,
  parsePullRequestSearch,
  readCheckouts,
  repositoryCheckouts,
  reviewRequestedSearch,
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
      updatedAt: "2026-09-30T10:00:00Z", reviewDecision: "review_required", checks: "failure", accounts: [],
    },
    {
      repository: "acme/web", number: 2, url: "https://github.com/acme/web/pull/2", title: "PR 2", state: "draft",
      headRefName: "feat/2", baseRefName: "main", updatedAt: "2026-09-30T10:00:00Z", accounts: [],
    },
  ]);
  assert.throws(() => parsePullRequestSearch({ errors: [{ message: "bad" }] }), GitHubApiError);
});

test("searches are direct requests and authorship of one named account", () => {
  assert.equal(reviewRequestedSearch("work-account"), "is:pr is:open archived:false user-review-requested:work-account");
  assert.equal(createdSearch("personal-account"), "is:pr is:open archived:false author:personal-account");
});

test("the selected accounts that are still signed in, else the active one", () => {
  const signedIn = ["work-account", "personal-account"];
  assert.deepEqual(effectiveAccounts([], signedIn), ["work-account"]);
  assert.deepEqual(effectiveAccounts(["personal-account", "work-account"], signedIn), ["personal-account", "work-account"]);
  assert.deepEqual(effectiveAccounts(["gone", "PERSONAL-ACCOUNT"], signedIn), ["PERSONAL-ACCOUNT"]);
  assert.deepEqual(effectiveAccounts(["gone"], signedIn), ["work-account"]);
  assert.deepEqual(effectiveAccounts(["personal-account"], []), []);
});

test("rows found by several accounts are merged by URL and remember each account", () => {
  const [one, two] = parsePullRequestSearch(search(node(1), node(2)));
  const [twoAgain, three] = parsePullRequestSearch(search(node(2, { url: "https://github.com/ACME/web/pull/2", title: "stale copy" }), node(3)));
  const merged = mergeAccountRows([{ login: "a", rows: [one!, two!] }, { login: "b", rows: [twoAgain!, three!] }, { login: "a", rows: [one!] }]);
  assert.deepEqual(merged.map((row) => [row.number, row.accounts]), [[1, ["a"]], [2, ["a", "b"]], [3, ["b"]]]);
  assert.equal(merged[1]?.title, "PR 2", "the first account's copy wins");
  assert.deepEqual(two!.accounts, [], "inputs are not mutated");
});

test("fetches both searches per account, one graphql call each, each as that account", async () => {
  const calls: string[] = [];
  const lists = await fetchMyPullRequests(["me", "alt"], async (login) => async (args) => {
    assert.deepEqual(args.slice(0, 3), ["api", "graphql", "-f"]);
    const q = args.at(-1)!.replace(/^q=/u, "");
    calls.push(`${login}: ${q}`);
    const number = { [createdSearch("me")]: 1, [reviewRequestedSearch("me")]: 2, [createdSearch("alt")]: 3, [reviewRequestedSearch("alt")]: 2 }[q];
    return search(node(number ?? 99));
  }, ["me", "alt", "unused"]);
  assert.deepEqual(calls.toSorted(), [
    `alt: ${createdSearch("alt")}`, `alt: ${reviewRequestedSearch("alt")}`, `me: ${createdSearch("me")}`, `me: ${reviewRequestedSearch("me")}`,
  ]);
  assert.deepEqual(lists.created.map((row) => [row.number, row.accounts]), [[1, ["me"]], [3, ["alt"]]]);
  assert.deepEqual(lists.reviewRequested.map((row) => [row.number, row.accounts]), [[2, ["me", "alt"]]]);
  assert.deepEqual([lists.accounts, lists.selectedAccounts], [["me", "alt", "unused"], ["me", "alt"]]);
  await assert.rejects(fetchMyPullRequests([], async () => async () => search()), GitHubApiError, "no account is signed in");
});

test("the created search carries review comments by others; the review-requested one does not ask for them", async () => {
  const queries = new Map<string, string>();
  const lists = await fetchMyPullRequests(["octo", "octo-work"], async () => async (args) => {
    const q = args.at(-1)!.replace(/^q=/u, "");
    queries.set(q, args[3]!);
    return search(node(1, q === createdSearch("octo") ? {
      reviewThreads: { nodes: [{ isResolved: false, isOutdated: false, path: "a.ts", line: 3, comments: { nodes: [
        { author: { login: "octo" }, body: "own", createdAt: "2026-09-30T08:00:00Z", url: "u1" },
        { author: { login: "octo-work" }, body: "own, other account", createdAt: "2026-09-30T08:30:00Z", url: "u1b" },
        { author: { login: "lana" }, body: "Rename this", createdAt: "2026-09-30T09:00:00Z", url: "u2" },
      ] } }] },
      reviews: { nodes: [{ author: { login: "octo-work" }, body: "self review", state: "COMMENTED", submittedAt: "2026-09-30T09:30:00Z", url: "r1" }] },
    } : {}));
  });
  assert.match(queries.get(createdSearch("octo"))!, /reviewThreads/);
  assert.doesNotMatch(queries.get(reviewRequestedSearch("octo"))!, /reviewThreads/);
  assert.deepEqual(lists.created[0]?.reviewComments, [{ author: "lana", body: "Rename this", createdAt: "2026-09-30T09:00:00Z", url: "u2", path: "a.ts", line: 3 }], "no selected account's comments count");
  assert.equal(lists.reviewRequested[0]?.reviewComments, undefined);
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

test("known checkouts of a pull request's repository put the head branch first", () => {
  const checkouts = new Map<string, Checkout>([
    ["/w/main", { branch: "main", repositories: ["acme/web"] }],
    ["/w/api", { branch: "feat/x", repositories: ["acme/api"] }],
    ["/w/head", { branch: "feat/x", repositories: ["Acme/Web"] }],
  ]);
  assert.deepEqual(repositoryCheckouts(pr, checkouts), [{ cwd: "/w/head", onHeadBranch: true }, { cwd: "/w/main", onHeadBranch: false }]);
  assert.deepEqual(repositoryCheckouts({ ...pr, repository: "acme/none", headRepository: undefined }, checkouts), []);
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
  const lists = (n: number): PullRequestLists => ({ created: parsePullRequestSearch(search(node(n))), reviewRequested: [], accounts: ["me"], selectedAccounts: ["me"] });
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
  assert.deepEqual(await cache.view(), { created: [], reviewRequested: [], accounts: [], selectedAccounts: [], pending: false, error: "cli_missing" });
  const other = new MyPullRequestsCache(async () => { throw new GitHubApiError("not_found"); });
  assert.equal((await other.view()).error, "unavailable");
});
