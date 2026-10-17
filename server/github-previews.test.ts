import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  classifyGhFailure,
  ghGraphQL,
  GitHubApiError,
  GitHubPreviews,
  parseIssuePreview,
  parsePullPreview,
  parseRepoPreview,
  previewPullRequestFetcher,
  previewTtlMs,
  type GitHubGraphQL,
} from "./github-previews.ts";

const FIXTURE = fileURLToPath(new URL("../e2e/github-cli-fixture.mjs", import.meta.url));

const repo = { nameWithOwner: "cli/cli", description: "GitHub’s official command line tool", stargazerCount: 46408, forkCount: 9076, primaryLanguage: { name: "Go" }, isPrivate: false, isArchived: false };
const pull = (patch: Record<string, unknown> = {}) => ({
  __typename: "PullRequest", number: 14517, title: " Mention gh CLI in the README intro ", state: "OPEN", isDraft: false,
  author: { login: "BagToad" }, additions: 2, deletions: 2, changedFiles: 1, comments: { totalCount: 1 }, reviewThreads: { totalCount: 2 },
  body: "<!-- template -->\r\nShort description.", ...patch,
});
const issue = (patch: Record<string, unknown> = {}) => ({
  __typename: "Issue", number: 7, title: "Crash on start", issueState: "OPEN", stateReason: null, author: { login: "octocat" },
  comments: { totalCount: 3 }, labels: { nodes: [{ name: "bug" }, { name: "p1" }] }, body: "Steps", ...patch,
});

/** `gh api graphql` over `nodes` (keyed `owner/repo` or `owner/repo#N`), as GitHub answers HUI's aliased query. */
function graphql(nodes: Record<string, unknown>, queries: string[] = []): GitHubGraphQL {
  return async (query) => {
    queries.push(query);
    const data: Record<string, unknown> = {};
    const errors: { type: string; path: string[] }[] = [];
    for (const [, alias = "", owner, name, number] of query.matchAll(/(i\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{ (?:item: issueOrPullRequest\(number: (\d+)\))?/gu)) {
      const node = nodes[`${owner}/${name}${number ? `#${number}` : ""}`] ?? null;
      data[alias] = number ? { item: node } : node;
      if (!node) errors.push({ type: "NOT_FOUND", path: number ? [alias, "item"] : [alias] });
    }
    return { data, errors };
  };
}

const aliases = (query: string) => query.match(/\bi\d+: repository\(/gu)?.length ?? 0;

test("maps GitHub GraphQL nodes to bounded, credential-free previews", () => {
  assert.deepEqual(parseRepoPreview(repo), {
    kind: "repo", url: "https://github.com/cli/cli", fullName: "cli/cli", description: "GitHub’s official command line tool",
    stars: 46408, forks: 9076, language: "Go", private: false, archived: false,
  });
  assert.deepEqual(parsePullPreview(pull(), "cli/cli"), {
    kind: "pull", url: "https://github.com/cli/cli/pull/14517", repository: "cli/cli", number: 14517,
    title: "Mention gh CLI in the README intro", state: "open", author: "BagToad", additions: 2, deletions: 2,
    changedFiles: 1, comments: 3, body: "Short description.",
  });
  assert.equal((parsePullPreview(pull({ isDraft: true }), "a/b") as { state: string }).state, "draft");
  assert.equal((parsePullPreview(pull({ state: "MERGED" }), "a/b") as { state: string }).state, "merged");
  assert.equal((parsePullPreview(pull({ state: "CLOSED" }), "a/b") as { state: string }).state, "closed");
  assert.deepEqual(parseIssuePreview(issue({ issueState: "CLOSED", stateReason: "NOT_PLANNED" }), "acme/web"), {
    kind: "issue", url: "https://github.com/acme/web/issues/7", repository: "acme/web", number: 7, title: "Crash on start",
    state: "closed", stateReason: "not_planned", author: "octocat", comments: 3, labels: ["bug", "p1"], body: "Steps",
  });
  assert.equal(parseRepoPreview({ ...repo, primaryLanguage: null }).kind, "repo");
  assert.equal("author" in parseIssuePreview(issue({ author: null }), "a/b"), false, "a deleted account has no author");
  assert.throws(() => parseRepoPreview({}), GitHubApiError);
  assert.throws(() => parsePullPreview({ title: "x" }, "a/b"), GitHubApiError);
});

test("classifies gh failures without keeping its output", () => {
  assert.equal(classifyGhFailure({ code: "ENOENT" }), "cli_missing");
  assert.equal(classifyGhFailure({ code: 1, stderr: "gh: Not Found (HTTP 404)\n" }), "not_found");
  assert.equal(classifyGhFailure({ code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" }), "signed_out");
  assert.equal(classifyGhFailure({ code: 1, stderr: "HTTP 401: Bad credentials" }), "signed_out");
  assert.equal(classifyGhFailure({ code: 1, stderr: "Proxy Authentication Required" }), "unavailable");
});

test("lookups that arrive together share one gh call, and results are cached by state", async () => {
  let now = 0;
  const queries: string[] = [];
  const previews = new GitHubPreviews(graphql({
    "cli/cli": repo, "cli/cli#14517": pull(), "acme/web#7": issue(), "acme/web#8": issue({ number: 8, title: "Fixed", issueState: "CLOSED" }),
  }, queries), { now: () => now });
  const urls = [
    "https://github.com/cli/cli",
    "https://github.com/cli/cli/issues/14517",
    "https://github.com/cli/cli/pull/14517",
    "https://github.com/acme/web/pull/7",
    "https://github.com/acme/web/issues/8",
    "https://github.com/acme/missing",
    "https://github.com/acme/web/issues/99",
  ];
  const [repository, issueUrl, pullUrlOfPull, pullUrl, closed, missingRepo, missingItem] = await Promise.all(urls.map((url) => previews.lookup(url)));
  assert.equal(queries.length, 1, "one gh call for every lookup");
  assert.equal(aliases(queries[0]!), 6, "one alias per item, its two spellings shared");
  assert.equal(repository?.preview?.kind, "repo");
  assert.equal(issueUrl?.preview?.kind, "pull", "an issue URL of a pull request previews the pull request");
  assert.equal(issueUrl?.preview?.url, "https://github.com/cli/cli/pull/14517");
  assert.deepEqual(pullUrlOfPull, { ...issueUrl, url: "https://github.com/cli/cli/pull/14517" }, "each spelling gets its own url back");
  assert.equal(pullUrl?.preview?.url, "https://github.com/acme/web/issues/7", "a pull URL of an issue previews the issue");
  assert.equal(closed?.preview?.kind === "issue" && closed.preview.state, "closed");
  assert.deepEqual(missingRepo, { url: "https://github.com/acme/missing", error: "not_found" });
  assert.deepEqual(missingItem, { url: "https://github.com/acme/web/issues/99", error: "not_found" });
  assert.deepEqual(await previews.lookup("https://example.com/x"), { url: "https://example.com/x", error: "not_found" });
  assert.equal(queries.length, 1);

  await previews.lookup("https://github.com/cli/cli/issues/14517");
  assert.equal(queries.length, 1, "an open pull request is served from cache within a minute");
  now = 61_000;
  await Promise.all(urls.map((url) => previews.lookup(url)));
  assert.equal(queries.length, 2, "and refreshed after it");
  assert.equal(aliases(queries[1]!), 1, "with nothing that is still fresh");
});

test("a failed call fails its whole batch, sign-in clears failures, and badges reuse previews", async () => {
  assert.equal(previewTtlMs({ url: "u", error: "signed_out" }), 15_000);
  assert.equal(previewTtlMs({ url: "u", error: "not_found" }), 300_000);
  let signedIn = false;
  const merged = graphql({ "cli/cli#14517": pull({ state: "MERGED" }), "cli/cli": repo });
  const previews = new GitHubPreviews(async (query) => {
    if (!signedIn) throw new GitHubApiError("signed_out");
    return merged(query);
  });
  const url = "https://github.com/cli/cli/pull/14517";
  assert.deepEqual((await Promise.all([previews.lookup(url), previews.lookup("https://github.com/cli/cli")])).map((result) => result.error), ["signed_out", "signed_out"]);
  signedIn = true;
  assert.equal((await previews.lookup(url)).error, "signed_out", "cached failure");
  previews.clearFailures();
  await new Promise((resolve) => setImmediate(resolve));
  const fetcher = previewPullRequestFetcher(previews);
  assert.deepEqual(await fetcher(url), { state: "merged", title: "Mention gh CLI in the README intro", body: "Short description." });
  await assert.rejects(previewPullRequestFetcher(new GitHubPreviews(graphql({ "cli/cli": repo })))("https://github.com/cli/cli/pull/1"));
});

test("a burst goes out in batches of 25, at most two gh calls at once", async () => {
  let running = 0;
  let peak = 0;
  const sizes: number[] = [];
  const answer = graphql(Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`acme/r${index}`, { ...repo, nameWithOwner: `acme/r${index}` }])));
  const previews = new GitHubPreviews(async (query) => {
    sizes.push(aliases(query));
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return answer(query);
  });
  const results = await Promise.all(Array.from({ length: 60 }, (_, index) => previews.lookup(`https://github.com/acme/r${index}`)));
  assert.deepEqual(sizes, [25, 25, 10]);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.preview?.kind === "repo" && result.preview.fullName), Array.from({ length: 60 }, (_, index) => `acme/r${index}`));
});

test("gh's partial answer keeps the items it found; signed out and missing gh are reported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-gh-previews-"));
  try {
    await chmod(FIXTURE, 0o755);
    await writeFile(join(dir, "account"), "hui-e2e\n");
    const previews = new GitHubPreviews(ghGraphQL(FIXTURE, { ...process.env, HUI_FAKE_GH_DIR: dir }));
    const [found, merged, missing] = await Promise.all(["https://github.com/acme/web", "https://github.com/acme/web/pull/13", "https://github.com/acme/web/issues/404"]
      .map((url) => previews.lookup(url)));
    assert.equal(found?.preview?.kind === "repo" && found.preview.fullName, "acme/web");
    assert.equal(merged?.preview?.kind === "pull" && merged.preview.state, "merged");
    assert.deepEqual(missing, { url: "https://github.com/acme/web/issues/404", error: "not_found" });
    assert.equal((await readFile(join(dir, "preview-log"), "utf8")).trim(), "acme/web acme/web#13 acme/web#404", "one gh call");

    await rm(join(dir, "account"));
    const signedOut = new GitHubPreviews(ghGraphQL(FIXTURE, { ...process.env, HUI_FAKE_GH_DIR: dir }));
    assert.equal((await signedOut.lookup("https://github.com/acme/web")).error, "signed_out");
    const noCli = new GitHubPreviews(ghGraphQL(join(dir, "missing-gh")));
    assert.equal((await noCli.lookup("https://github.com/acme/web")).error, "cli_missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
