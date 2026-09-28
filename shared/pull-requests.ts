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
