import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyGhFailure,
  GitHubApiError,
  GitHubPreviews,
  parseIssuePreview,
  parsePullPreview,
  parseRepoPreview,
  previewPullRequestFetcher,
  previewTtlMs,
  type GitHubApi,
} from "./github-previews.ts";

const repo = { full_name: "cli/cli", description: "GitHub’s official command line tool", stargazers_count: 46408, forks_count: 9076, language: "Go", private: false, archived: false };
const pull = (patch: Record<string, unknown> = {}) => ({
  number: 14517, title: " Mention gh CLI in the README intro ", state: "open", draft: false, merged: false,
  user: { login: "BagToad" }, additions: 2, deletions: 2, changed_files: 1, comments: 1, review_comments: 2,
  body: "<!-- template -->\r\nShort description.", ...patch,
});
const issue = (patch: Record<string, unknown> = {}) => ({
  number: 7, title: "Crash on start", state: "open", user: { login: "octocat" }, comments: 3,
  labels: [{ name: "bug" }, "p1"], body: "Steps", ...patch,
});

test("maps GitHub REST payloads to bounded, credential-free previews", () => {
  assert.deepEqual(parseRepoPreview(repo), {
    kind: "repo", url: "https://github.com/cli/cli", fullName: "cli/cli", description: "GitHub’s official command line tool",
    stars: 46408, forks: 9076, language: "Go", private: false, archived: false,
  });
  assert.deepEqual(parsePullPreview(pull(), "cli/cli"), {
    kind: "pull", url: "https://github.com/cli/cli/pull/14517", repository: "cli/cli", number: 14517,
    title: "Mention gh CLI in the README intro", state: "open", author: "BagToad", additions: 2, deletions: 2,
    changedFiles: 1, comments: 3, body: "Short description.",
  });
  assert.equal((parsePullPreview(pull({ draft: true }), "a/b") as { state: string }).state, "draft");
  assert.equal((parsePullPreview(pull({ state: "closed", merged: true }), "a/b") as { state: string }).state, "merged");
  assert.equal((parsePullPreview(pull({ state: "closed", merged_at: "2026-01-01" }), "a/b") as { state: string }).state, "merged");
  assert.equal((parsePullPreview(pull({ state: "closed" }), "a/b") as { state: string }).state, "closed");
  assert.deepEqual(parseIssuePreview(issue({ state: "closed", state_reason: "not_planned" }), "acme/web"), {
    kind: "issue", url: "https://github.com/acme/web/issues/7", repository: "acme/web", number: 7, title: "Crash on start",
    state: "closed", stateReason: "not_planned", author: "octocat", comments: 3, labels: ["bug", "p1"], body: "Steps",
  });
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

test("resolves issue shorthand to pull requests, shares in-flight calls and caches by state", async () => {
  let now = 0;
  const calls: string[] = [];
  const api: GitHubApi = async (path) => {
    calls.push(path);
    if (path === "repos/cli/cli") return repo;
    if (path === "repos/cli/cli/issues/14517") return { number: 14517, pull_request: { url: "…" } };
    if (path === "repos/cli/cli/pulls/14517") return pull();
    if (path === "repos/acme/web/issues/7") return issue();
    throw new GitHubApiError("not_found");
  };
  const previews = new GitHubPreviews(api, { now: () => now });
  const [a, b] = await Promise.all([
    previews.lookup("https://github.com/cli/cli/issues/14517"),
    previews.lookup("https://github.com/cli/cli/issues/14517"),
  ]);
  assert.equal(a, b);
  assert.equal(a.preview?.kind, "pull");
  assert.equal(a.preview?.url, "https://github.com/cli/cli/pull/14517");
  assert.deepEqual(calls, ["repos/cli/cli/issues/14517", "repos/cli/cli/pulls/14517"]);

  assert.equal((await previews.lookup("https://github.com/acme/web/issues/7")).preview?.kind, "issue");
  assert.deepEqual(await previews.lookup("https://github.com/acme/missing"), { url: "https://github.com/acme/missing", error: "not_found" });
  assert.deepEqual(await previews.lookup("https://example.com/x"), { url: "https://example.com/x", error: "not_found" });

  const before = calls.length;
  await previews.lookup("https://github.com/cli/cli/issues/14517");
  assert.equal(calls.length, before, "an open pull request is served from cache within a minute");
  now = 61_000;
  await previews.lookup("https://github.com/cli/cli/issues/14517");
  assert.equal(calls.length, before + 2, "and refreshed after it");
});

test("ttl follows state, failures are cleared after sign-in, and badges reuse previews", async () => {
  assert.equal(previewTtlMs({ url: "u", error: "signed_out" }), 15_000);
  assert.equal(previewTtlMs({ url: "u", error: "not_found" }), 300_000);
  let signedIn = false;
  const previews = new GitHubPreviews(async () => {
    if (!signedIn) throw new GitHubApiError("signed_out");
    return pull({ state: "closed", merged: true });
  });
  const url = "https://github.com/cli/cli/pull/14517";
  assert.equal((await previews.lookup(url)).error, "signed_out");
  signedIn = true;
  assert.equal((await previews.lookup(url)).error, "signed_out", "cached failure");
  previews.clearFailures();
  await new Promise((resolve) => setImmediate(resolve));
  const fetcher = previewPullRequestFetcher(previews);
  assert.deepEqual(await fetcher(url), { state: "merged", title: "Mention gh CLI in the README intro", body: "Short description." });
  await assert.rejects(previewPullRequestFetcher(new GitHubPreviews(async () => repo))("https://github.com/cli/cli/pull/1"));
});

test("limits concurrent gh calls", async () => {
  let running = 0;
  let peak = 0;
  const previews = new GitHubPreviews(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return repo;
  }, { concurrency: 2 });
  await Promise.all(Array.from({ length: 6 }, (_, index) => previews.lookup(`https://github.com/acme/r${index}`)));
  assert.equal(peak, 2);
});
