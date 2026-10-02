import type { FixCiResult, MyPullRequests, ReviewCommentsResult } from "../../shared/pull-requests.ts";
import { fetchJson } from "./settings-store.ts";

export type { FixCiResult, MyPullRequest, MyPullRequests, ReviewCommentsResult } from "../../shared/pull-requests.ts";

/** Created tab → selected repository chips: a browser reading preference, like the Kanban View menu. */
export const PULL_REQUEST_REPOS_KEY = "hui.pull-request-repositories";

export function normalizePullRequestRepos(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && /^[^/\s]+\/[^/\s]+$/u.test(item)))].slice(0, 200);
}

export function readPullRequestRepos(): string[] {
  try {
    return normalizePullRequestRepos(JSON.parse(localStorage.getItem(PULL_REQUEST_REPOS_KEY) ?? "null"));
  } catch {
    return [];
  }
}

export function writePullRequestRepos(repos: readonly string[]) {
  try { localStorage.setItem(PULL_REQUEST_REPOS_KEY, JSON.stringify(repos)); } catch { /* Keep the in-memory choice if storage is unavailable. */ }
}

export function loadMyPullRequests(): Promise<MyPullRequests> {
  return fetchJson<MyPullRequests>("/__hui/pull-requests", { signal: AbortSignal.timeout(60_000) });
}

export function refreshMyPullRequests(): Promise<MyPullRequests> {
  return fetchJson<MyPullRequests>("/__hui/pull-requests/refresh", { method: "POST", signal: AbortSignal.timeout(60_000) });
}

/** Without `sessionId` the gateway starts a session on the head branch; creating a worktree and booting PI can take minutes. */
export function sendReviewComments(url: string, sessionId?: string): Promise<ReviewCommentsResult> {
  return fetchJson<ReviewCommentsResult>("/__hui/pull-requests/review-comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...(sessionId ? { sessionId } : {}) }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
}

/** Starts the temporary risk-review session; resolves once its first prompt was accepted. */
export function assessPullRequest(url: string): Promise<{ sessionId: string }> {
  return fetchJson<{ sessionId: string }>("/__hui/pull-requests/assess", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
}

/** Approve (runs `gh pr review --approve`), dismiss or keep a risk review; resolves with the refreshed page. */
export function settlePullRequestReview(action: "approve" | "dismiss" | "keep", url: string): Promise<MyPullRequests> {
  return fetchJson<MyPullRequests>(`/__hui/pull-requests/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60_000),
  });
}

/** Sends the failing checks, read again from GitHub, to a session; without `sessionId` starts one on the head branch. */
export function fixPullRequestCi(url: string, sessionId?: string): Promise<FixCiResult> {
  return fetchJson<FixCiResult>("/__hui/pull-requests/fix-ci", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...(sessionId ? { sessionId } : {}) }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
}
