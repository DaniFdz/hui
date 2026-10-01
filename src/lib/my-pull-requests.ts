import type { MyPullRequests, ReviewCommentsResult } from "../../shared/pull-requests.ts";
import { fetchJson } from "./settings-store.ts";

export type { MyPullRequest, MyPullRequests, ReviewCommentsResult } from "../../shared/pull-requests.ts";

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
