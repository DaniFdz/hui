/** GitHub previews for chat embeds and pull request badges.
 *
 * Every lookup is one read-only `gh api` call made with the GitHub CLI login
 * that Settings → Integrations → GitHub establishes, so private repositories
 * the operator can read preview too. Results are cached in gateway memory with
 * state-dependent lifetimes; concurrent requests for one item share a call.
 * `gh` diagnostics never reach the browser: failures become a coarse reason.
 */
import { execFile } from "node:child_process";

import {
  parseGitHubUrl,
  type GitHubPreview,
  type GitHubPreviewError,
  type GitHubPreviewResult,
  type GitHubRef,
} from "../shared/github-links.ts";
import type { PullRequestState } from "../shared/pull-requests.ts";
import { pullRequestBodyPreview, type PullRequestFetcher } from "./pull-requests.ts";

const GH_ENV = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1" };
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 400;
const MAX_LABELS = 6;

/** Runs `gh api <path>` and resolves with parsed JSON; rejects with a classified reason. */
export type GitHubApi = (path: string) => Promise<unknown>;

export class GitHubApiError extends Error {
  readonly reason: GitHubPreviewError;
  constructor(reason: GitHubPreviewError) {
    super(`GitHub lookup failed: ${reason}`);
    this.name = "GitHubApiError";
    this.reason = reason;
  }
}

/** Maps a failed `gh api` run to a reason without keeping its output. */
export function classifyGhFailure(error: unknown): GitHubPreviewError {
  const failure = error as { stderr?: unknown; code?: unknown } | undefined;
  if (failure?.code === "ENOENT") return "cli_missing";
  const stderr = typeof failure?.stderr === "string" ? failure.stderr : "";
  if (/HTTP 404|Not Found/u.test(stderr)) return "not_found";
  if (failure?.code === 4 || /gh auth login|HTTP 401|Bad credentials|not logged in/iu.test(stderr)) return "signed_out";
  return "unavailable";
}

export function ghApi(command = "gh", env: NodeJS.ProcessEnv = process.env): GitHubApi {
  const childEnv = { ...env, ...GH_ENV };
  return (path) => new Promise((resolve, reject) => {
    execFile(command, ["api", path], { env: childEnv, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        // The callback form does not attach stderr to the error; classify with both.
        reject(new GitHubApiError(classifyGhFailure({ code: error.code, stderr })));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new GitHubApiError("unavailable")); }
    });
  });
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, limit = MAX_TITLE) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const login = (value: unknown) => str(record(value)["login"], 60) || undefined;
const optional = <K extends string>(key: K, value: string | undefined) => value ? { [key]: value } as Record<K, string> : {};

export function parseRepoPreview(raw: unknown): GitHubPreview {
  const data = record(raw);
  const fullName = str(data["full_name"], 200);
  if (!fullName) throw new GitHubApiError("unavailable");
  return {
    kind: "repo",
    url: `https://github.com/${fullName}`,
    fullName,
    ...optional("description", str(data["description"], MAX_DESCRIPTION)),
    stars: count(data["stargazers_count"]),
    forks: count(data["forks_count"]),
    ...optional("language", str(data["language"], 40)),
    private: data["private"] === true,
    archived: data["archived"] === true,
  };
}

export function parsePullPreview(raw: unknown, repository: string): GitHubPreview {
  const data = record(raw);
  const number = count(data["number"]);
  if (!number) throw new GitHubApiError("unavailable");
  const state: PullRequestState = data["merged"] === true || typeof data["merged_at"] === "string"
    ? "merged"
    : data["state"] === "closed" ? "closed" : data["draft"] === true ? "draft" : "open";
  const body = typeof data["body"] === "string" ? pullRequestBodyPreview(data["body"]) : "";
  return {
    kind: "pull",
    url: `https://github.com/${repository}/pull/${number}`,
    repository,
    number,
    title: str(data["title"]),
    state,
    ...optional("author", login(data["user"])),
    additions: count(data["additions"]),
    deletions: count(data["deletions"]),
    changedFiles: count(data["changed_files"]),
    comments: count(data["comments"]) + count(data["review_comments"]),
    ...optional("body", body),
  };
}

export function parseIssuePreview(raw: unknown, repository: string): GitHubPreview {
  const data = record(raw);
  const number = count(data["number"]);
  if (!number) throw new GitHubApiError("unavailable");
  const labels = Array.isArray(data["labels"])
    ? data["labels"].map((label) => str(typeof label === "string" ? label : record(label)["name"], 50)).filter(Boolean).slice(0, MAX_LABELS)
    : [];
  const body = typeof data["body"] === "string" ? pullRequestBodyPreview(data["body"]) : "";
  return {
    kind: "issue",
    url: `https://github.com/${repository}/issues/${number}`,
    repository,
    number,
    title: str(data["title"]),
    state: data["state"] === "closed" ? "closed" : "open",
    ...optional("stateReason", str(data["state_reason"], 30)),
    ...optional("author", login(data["user"])),
    comments: count(data["comments"]),
    labels,
    ...optional("body", body),
  };
}

export type GitHubPreviewOptions = {
  now?: () => number;
  concurrency?: number;
  maxEntries?: number;
};

type CacheEntry = { expires: number; result: Promise<GitHubPreviewResult> };

/** Lifetime of a result: live items refresh quickly, settled ones and failures slowly. */
export function previewTtlMs(result: GitHubPreviewResult): number {
  const preview = result.preview;
  if (!preview) {
    if (result.error === "not_found") return 5 * 60_000;
    if (result.error === "unavailable") return 60_000;
    return 15_000; // signed_out / cli_missing clear soon after the operator fixes them
  }
  if (preview.kind === "repo") return 10 * 60_000;
  if (preview.kind === "pull") return preview.state === "open" || preview.state === "draft" ? 60_000 : 15 * 60_000;
  return preview.state === "open" ? 2 * 60_000 : 15 * 60_000;
}

export class GitHubPreviews {
  readonly #api: GitHubApi;
  readonly #now: () => number;
  readonly #concurrency: number;
  readonly #maxEntries: number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #waiting: (() => void)[] = [];
  #running = 0;

  constructor(api: GitHubApi = ghApi(), options: GitHubPreviewOptions = {}) {
    this.#api = api;
    this.#now = options.now ?? Date.now;
    this.#concurrency = Math.max(1, options.concurrency ?? 4);
    this.#maxEntries = Math.max(1, options.maxEntries ?? 500);
  }

  /** Preview for a github.com URL. Never rejects; an unusable URL is `not_found`. */
  lookup(url: string): Promise<GitHubPreviewResult> {
    const ref = parseGitHubUrl(url);
    if (!ref) return Promise.resolve({ url, error: "not_found" });
    const key = ref.url.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached && cached.expires > this.#now()) return cached.result;
    const entry: CacheEntry = { expires: Number.POSITIVE_INFINITY, result: this.#fetch(ref) };
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    this.#evict();
    void entry.result.then((result) => { entry.expires = this.#now() + previewTtlMs(result); });
    return entry.result;
  }

  /** Forgets failures, e.g. after the operator signs in. */
  clearFailures(): void {
    for (const [key, entry] of this.#cache) {
      void entry.result.then((result) => { if (result.error && this.#cache.get(key) === entry) this.#cache.delete(key); });
    }
  }

  #evict(): void {
    for (const key of this.#cache.keys()) {
      if (this.#cache.size <= this.#maxEntries) return;
      this.#cache.delete(key);
    }
  }

  async #fetch(ref: GitHubRef): Promise<GitHubPreviewResult> {
    const repository = `${ref.owner}/${ref.repo}`;
    try {
      if (ref.kind === "repo") return { url: ref.url, preview: parseRepoPreview(await this.#call(`repos/${repository}`)) };
      if (ref.kind === "pull") return { url: ref.url, preview: parsePullPreview(await this.#call(`repos/${repository}/pulls/${ref.number}`), repository) };
      // The issues endpoint answers for pull requests too; ask the pulls endpoint for their full facts.
      const issue = await this.#call(`repos/${repository}/issues/${ref.number}`);
      if (record(issue)["pull_request"]) {
        return { url: ref.url, preview: parsePullPreview(await this.#call(`repos/${repository}/pulls/${ref.number}`), repository) };
      }
      return { url: ref.url, preview: parseIssuePreview(issue, repository) };
    } catch (error) {
      return { url: ref.url, error: error instanceof GitHubApiError ? error.reason : "unavailable" };
    }
  }

  async #call(path: string): Promise<unknown> {
    if (this.#running >= this.#concurrency) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#running += 1;
    try {
      return await this.#api(path);
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }
}

/** Pull request badge facts from the same previews, so badges and embeds agree. */
export function previewPullRequestFetcher(previews: GitHubPreviews): PullRequestFetcher {
  return async (url) => {
    const result = await previews.lookup(url);
    if (result.preview?.kind !== "pull") throw new GitHubApiError(result.error ?? "not_found");
    return { state: result.preview.state, title: result.preview.title, body: result.preview.body ?? "" };
  };
}
