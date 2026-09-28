import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGitHubUrl, type GitHubPreviewResult } from "../../shared/github-links.ts";
import { clearGitHubPreviewCache, compactCount, loadGitHubPreviews, previewErrorLabel } from "./github-previews.ts";

const ref = (url: string) => parseGitHubUrl(url)!;

test("batches one request per message and reuses results across renders", async () => {
  clearGitHubPreviewCache();
  const requests: string[] = [];
  const fetcher = async <T>(url: string): Promise<T> => {
    requests.push(url);
    const urls = new URL(url, "http://hui").searchParams.getAll("url");
    return { previews: urls.map((item): GitHubPreviewResult => ({ url: item, error: "not_found" })) } as T;
  };
  const refs = [ref("https://github.com/a/b"), ref("https://github.com/a/b/pull/2"), ref("https://github.com/a/c"), ref("https://github.com/a/d")];
  const first = await loadGitHubPreviews(refs, 0, fetcher);
  assert.equal(first.length, 3, "at most three embeds");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]!, "http://hui").searchParams.getAll("url").length, 3);
  await loadGitHubPreviews(refs, 1_000, fetcher);
  assert.equal(requests.length, 1, "fresh results are not refetched");
  await loadGitHubPreviews(refs, 31_000, fetcher);
  assert.equal(requests.length, 2, "failures retry after 30 seconds");
});

test("a failed request becomes unavailable instead of rejecting", async () => {
  clearGitHubPreviewCache();
  const results = await loadGitHubPreviews([ref("https://github.com/a/b")], 0, async () => { throw new Error("offline"); });
  assert.deepEqual(results, [{ url: "https://github.com/a/b", error: "unavailable" }]);
});

test("formats counts and error reasons", () => {
  assert.deepEqual([compactCount(999), compactCount(1_200), compactCount(46_408), compactCount(2_300_000)], ["999", "1.2k", "46k", "2.3M"]);
  assert.match(previewErrorLabel("signed_out"), /Settings → Integrations/u);
  assert.match(previewErrorLabel("cli_missing"), /gh/u);
});
