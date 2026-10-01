import type { MyPullRequests } from "../../shared/pull-requests.ts";
import { fetchJson } from "./settings-store.ts";

export type { MyPullRequest, MyPullRequests } from "../../shared/pull-requests.ts";

export function loadMyPullRequests(): Promise<MyPullRequests> {
  return fetchJson<MyPullRequests>("/__hui/pull-requests", { signal: AbortSignal.timeout(60_000) });
}

export function refreshMyPullRequests(): Promise<MyPullRequests> {
  return fetchJson<MyPullRequests>("/__hui/pull-requests/refresh", { method: "POST", signal: AbortSignal.timeout(60_000) });
}
