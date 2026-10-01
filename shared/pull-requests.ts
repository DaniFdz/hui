/** Pull requests a session created, as reported to the browser. The reference
 * (repository, number, url) comes from the session transcript; the remaining
 * fields are GitHub facts and stay absent until GitHub has confirmed them. */
export type PullRequestState = "open" | "draft" | "merged" | "closed";

export type SessionPullRequest = {
  /** `owner/repo`, as written in the pull request URL. */
  repository: string;
  number: number;
  /** Canonical `https://github.com/<owner>/<repo>/pull/<number>`. */
  url: string;
  state?: PullRequestState;
  title?: string;
  /** Bounded Markdown description with HTML comments removed. */
  body?: string;
};

export function pullRequestReference(pullRequest: Pick<SessionPullRequest, "repository" | "number">): string {
  return `${pullRequest.repository}#${pullRequest.number}`;
}

export function pullRequestStateLabel(state: PullRequestState | undefined): string {
  switch (state) {
    case "open": return "Open";
    case "draft": return "Draft";
    case "merged": return "Merged";
    case "closed": return "Closed";
    default: return "Status unavailable";
  }
}

export function pullRequestAccessibleLabel(pullRequest: SessionPullRequest): string {
  const title = pullRequest.title ? `: ${pullRequest.title}` : "";
  return `Pull request ${pullRequestReference(pullRequest)}, ${pullRequestStateLabel(pullRequest.state).toLocaleLowerCase()}${title}`;
}

/** Rollup of the head commit's checks (`statusCheckRollup.state`, lower-cased). */
export type PullRequestChecks = "success" | "failure" | "error" | "pending" | "expected";
export type PullRequestReviewDecision = "approved" | "changes_requested" | "review_required";

/** An HUI session linked to one of the operator's pull requests. */
export type MyPullRequestSession = {
  id: string;
  title: string;
  archived: boolean;
  /** Created tab: review comments newer than the last send to this session. */
  newComments?: number;
};

/** An open or draft pull request authored by, or awaiting review from, the
 * `gh` account (Pull Requests page). */
export type MyPullRequest = {
  repository: string;
  number: number;
  url: string;
  title: string;
  state: "open" | "draft";
  headRefName: string;
  /** `owner/repo` of the head branch; differs from `repository` for forks. */
  headRepository?: string;
  baseRefName: string;
  author?: string;
  updatedAt: string;
  reviewDecision?: PullRequestReviewDecision;
  checks?: PullRequestChecks;
  /** Created-by and head-branch matches; newest first, archived last. */
  sessions: MyPullRequestSession[];
  /** Created tab: every open review comment by someone else (nothing sent yet). */
  newComments?: number;
  /** Created tab: a session directory is a checkout of the repository, so a
   * session can be started on the head branch. */
  localCheckout?: boolean;
};

/** `POST /__hui/pull-requests/review-comments` result. */
export type ReviewCommentsResult = {
  sessionId: string;
  /** Comments included in the message; `omitted` newer ones did not fit. */
  sent: number;
  omitted: number;
  /** `queued` when the session was busy and the message waits as a follow-up. */
  delivery: "prompt" | "queued";
};

export type MyPullRequestsError = "signed_out" | "cli_missing" | "unavailable";

export type MyPullRequests = {
  created: MyPullRequest[];
  reviewRequested: MyPullRequest[];
  /** ISO time of the last successful fetch; absent until one succeeded. */
  fetchedAt?: string;
  /** A background refetch is running. */
  pending: boolean;
  /** Why the last fetch failed; the lists are the last confirmed data. */
  error?: MyPullRequestsError;
};
