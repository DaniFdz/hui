/** Browser client for GitHub chat previews (`GET /__hui/github/previews`): one request for a message's references. */
import type { GitHubPreviewResult } from "./schema/github.ts";
import type { GitHubRef } from "../lib/github-links.ts";
import { fetchJson } from "./request.ts";

export async function fetchGitHubPreviews(refs: readonly GitHubRef[]): Promise<GitHubPreviewResult[]> {
  const query = refs.map((ref) => `url=${encodeURIComponent(ref.url)}`).join("&");
  return (await fetchJson<{ previews: GitHubPreviewResult[] }>(`/__hui/github/previews?${query}`, { signal: AbortSignal.timeout(40_000) })).previews;
}
