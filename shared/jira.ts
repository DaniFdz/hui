/** Jira work items linked to a session, as reported to the browser. The
 * reference (key, url) is HUI-owned: it comes from the session registry (items
 * created from HUI) or from a creation command in the live transcript. The
 * remaining fields are Jira facts and stay absent until Jira has confirmed them. */
export type JiraStatusCategory = "new" | "indeterminate" | "done";

export type SessionJiraIssue = {
  /** Issue key such as `CI-123`. */
  key: string;
  /** Canonical `https://<site>/browse/<key>`. */
  url: string;
  summary?: string;
  status?: string;
  statusCategory?: JiraStatusCategory;
  issueType?: string;
  /** Bounded Markdown converted from Jira's document format. */
  description?: string;
};

/** Credential-free view of HUI's Jira connection. The token never leaves the server. */
export type JiraConnection = {
  configured: boolean;
  site: string;
  email: string;
  tokenSet: boolean;
  defaultProject: string;
  /** Display name reported by Jira when the connection was last verified. */
  accountName?: string;
};

export type JiraProject = { key: string; name: string };

export type JiraParentCandidate = {
  key: string;
  summary: string;
  issueType: string;
  /** Jira hierarchy: 1 epic, 0 standard work item, -1 subtask. */
  hierarchyLevel: number;
  status?: string;
};

export type JiraDraft = {
  project: string;
  parents: JiraParentCandidate[];
  /** Agent-chosen parent key, or empty for none. */
  parent: string;
  summary: string;
  description: string;
  /** Model that wrote the draft; absent when HUI fell back to a local draft. */
  model?: string;
  /** Why the draft is a local fallback, when it is. */
  note?: string;
  /**
   * How the parent default was chosen, so an empty parent is never ambiguous:
   * `suggested` the model chose `parent` (empty means it chose none);
   * `unmatched` the model named `rejectedParent`, which is not a candidate;
   * `none-available` the project has no open parent candidates;
   * `not-drafted` HUI prefilled the draft locally, so nothing was suggested;
   * `omitted` the model's answer had no parent field at all.
   */
  parentChoice?: "suggested" | "unmatched" | "none-available" | "not-drafted" | "omitted";
  rejectedParent?: string;
};

/** A work item offered by the link dialog. */
export type JiraIssueMatch = {
  key: string;
  url: string;
  summary: string;
  status?: string;
  statusCategory?: JiraStatusCategory;
  issueType?: string;
};

export const JIRA_API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function jiraStatusLabel(issue: Pick<SessionJiraIssue, "status">): string {
  return issue.status || "Status unavailable";
}

export function jiraIssueAccessibleLabel(issue: SessionJiraIssue, total = 1): string {
  const summary = issue.summary ? `: ${issue.summary}` : "";
  const more = total > 1 ? `, ${total - 1} more linked` : "";
  return `Jira ${issue.key}, ${jiraStatusLabel(issue).toLocaleLowerCase()}${summary}${more}`;
}

/** The newest linked item owns the row mark; older ones are listed in its card. */
export function primaryJiraIssue(
  issues: readonly SessionJiraIssue[] | undefined,
): { issue: SessionJiraIssue; others: SessionJiraIssue[] } | undefined {
  if (!issues?.length) return undefined;
  return { issue: issues.at(-1)!, others: issues.slice(0, -1) };
}
