/** Browser half of GitHub chat embeds: one request per message for its (at
 * most three) references, remembered per URL for the page lifetime so
 * re-renders and streaming updates do not refetch. */
import type { GitHubPreviewResult, GitHubRef } from "../../shared/github-links.ts";
import { MAX_GITHUB_EMBEDS } from "../../shared/github-links.ts";
import { fetchJson } from "./settings-store.ts";

const PREVIEWS_URL = "/__hui/github/previews";
/** Page-lifetime cache: settled results stay; failures retry after this long. */
const FAILURE_RETRY_MS = 30_000;
const SUCCESS_TTL_MS = 60_000;

type Entry = { at: number; result: Promise<GitHubPreviewResult> };
const cache = new Map<string, Entry>();

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  return Boolean(entry) && now - entry!.at < SUCCESS_TTL_MS;
}

/** Previews in the order of `refs`. Never rejects: a failed request becomes `unavailable`. */
export function loadGitHubPreviews(refs: readonly GitHubRef[], now = Date.now(), fetcher = fetchJson): Promise<GitHubPreviewResult[]> {
  const wanted = refs.slice(0, MAX_GITHUB_EMBEDS);
  const missing = wanted.filter((ref) => !fresh(cache.get(ref.url.toLowerCase()), now));
  if (missing.length) {
    const query = missing.map((ref) => `url=${encodeURIComponent(ref.url)}`).join("&");
    const batch = fetcher<{ previews: GitHubPreviewResult[] }>(`${PREVIEWS_URL}?${query}`, { signal: AbortSignal.timeout(40_000) })
      .then((body) => body.previews)
      .catch((): GitHubPreviewResult[] => missing.map((ref) => ({ url: ref.url, error: "unavailable" })));
    missing.forEach((ref, index) => {
      const key = ref.url.toLowerCase();
      const entry: Entry = {
        at: now,
        result: batch.then((results) => results[index] ?? { url: ref.url, error: "unavailable" }),
      };
      cache.set(key, entry);
      // Failures age out sooner so a later render retries once the cause is fixed.
      void entry.result.then((result) => { if (result.error && cache.get(key) === entry) entry.at = now - SUCCESS_TTL_MS + FAILURE_RETRY_MS; });
    });
  }
  return Promise.all(wanted.map((ref) => cache.get(ref.url.toLowerCase())!.result));
}

/** Test helper. */
export function clearGitHubPreviewCache(): void {
  cache.clear();
}

export function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/u, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
}

export function previewErrorLabel(error: GitHubPreviewResult["error"]): string {
  switch (error) {
    case "not_found": return "Not found, or your GitHub account cannot see it.";
    case "signed_out": return "Connect GitHub in Settings → Integrations to preview it.";
    case "cli_missing": return "GitHub CLI (gh) is required for previews.";
    default: return "GitHub preview unavailable.";
  }
}
