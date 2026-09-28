/** Browser half of the Jira integration. The server owns the credential; this
 * module only moves credential-free views and explicit user input. */
import type { JiraConnection, JiraDraft, JiraIssueMatch, JiraProject } from "../../shared/jira.ts";
import type { SessionView } from "./sessions-store.ts";
import { fetchJson } from "./settings-store.ts";

const JIRA_URL = "/__hui/jira";
const JSON_HEADERS = { "content-type": "application/json" } as const;

export function loadJiraConnection(): Promise<JiraConnection> {
  return fetchJson<JiraConnection>(JIRA_URL);
}

export function connectJira(input: { site: string; email: string; token: string; defaultProject: string }): Promise<JiraConnection> {
  return fetchJson<JiraConnection>(JIRA_URL, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
}

export function setJiraDefaultProject(defaultProject: string): Promise<JiraConnection> {
  return fetchJson<JiraConnection>(JIRA_URL, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ defaultProject }) });
}

export function disconnectJira(): Promise<JiraConnection> {
  return fetchJson<JiraConnection>(JIRA_URL, { method: "DELETE" });
}

/** First page of projects, or Jira's own search when `query` is set. */
export function loadJiraProjects(query = ""): Promise<{ projects: JiraProject[]; total: number }> {
  const search = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  return fetchJson(`${JIRA_URL}/projects${search}`, { signal: AbortSignal.timeout(30_000) });
}

/** Adds search results to the known projects without dropping the selection. */
export function mergeJiraProjects(known: readonly JiraProject[], found: readonly JiraProject[]): JiraProject[] {
  const byKey = new Map(known.map((project) => [project.key, project]));
  for (const project of found) byKey.set(project.key, project);
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Debounced remote search with stale-response protection. */
export function jiraProjectSearch(onResult: (projects: JiraProject[]) => void, onError: (message: string) => void, delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  return (query: string) => {
    if (timer) clearTimeout(timer);
    const term = query.trim();
    if (!term) return;
    timer = setTimeout(() => {
      const request = ++sequence;
      loadJiraProjects(term).then(
        (result) => { if (request === sequence) onResult(result.projects); },
        (error: unknown) => { if (request === sequence) onError(error instanceof Error ? error.message : "Jira projects could not be searched."); },
      );
    }, delayMs);
  };
}

/** Parents plus an agent-written summary, description and parent default.
 * The utility model can take a while, so the timeout is generous. */
export async function draftJiraWorkItem(sessionId: string, project: string, suggestionId = ""): Promise<JiraDraft> {
  return (await fetchJson<{ draft: JiraDraft }>(`/__hui/sessions/${encodeURIComponent(sessionId)}/jira/draft`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ project, ...(suggestionId ? { suggestionId } : {}) }),
    signal: AbortSignal.timeout(120_000),
  })).draft;
}

export async function createJiraWorkItem(
  sessionId: string,
  input: { project: string; parent: string; summary: string; description: string; assignToMe: boolean; suggestionId?: string },
): Promise<{ issue: { key: string; url: string }; session?: SessionView; warning?: string }> {
  return fetchJson(`/__hui/sessions/${encodeURIComponent(sessionId)}/jira`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
}

/** Recently viewed items for an empty query; a key, URL or text otherwise. */
export async function searchJiraIssues(query: string, signal?: AbortSignal): Promise<JiraIssueMatch[]> {
  const search = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  return (await fetchJson<{ issues: JiraIssueMatch[] }>(`${JIRA_URL}/issues${search}`, { signal: signal ?? AbortSignal.timeout(30_000) })).issues;
}

export async function linkJiraWorkItem(sessionId: string, key: string): Promise<{ issue: { key: string; url: string }; session?: SessionView }> {
  return fetchJson(`/__hui/sessions/${encodeURIComponent(sessionId)}/jira/link`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(30_000),
  });
}

/** Tracks which draft fields the operator has edited, so a late or repeated
 * agent draft never overwrites their words. */
export type JiraDraftFields = { parent: string; summary: string; description: string };

/**
 * The parent field's hint and explanation. The model's choice (a parent or
 * deliberately none) is marked `suggested`; an empty parent that the model did
 * not choose says why. Once the operator edits the parent, both disappear.
 */
export function jiraParentHint(
  draft: Pick<JiraDraft, "project" | "parent" | "parentChoice" | "rejectedParent"> | undefined,
  edited: boolean,
): { suggested: boolean; reason: string } {
  if (!draft || edited) return { suggested: false, reason: "" };
  switch (draft.parentChoice) {
    case "suggested":
      return { suggested: true, reason: draft.parent ? "" : "No open parent matches this work." };
    case "unmatched":
      return { suggested: false, reason: `The model suggested ${draft.rejectedParent || "a parent"}, which isn't an open parent in ${draft.project}.` };
    case "none-available":
      return { suggested: false, reason: `${draft.project} has no open parent work items.` };
    case "omitted":
      return { suggested: false, reason: "The model didn't choose a parent." };
    case "not-drafted":
      return { suggested: false, reason: "No parent was suggested because the draft was prefilled locally." };
    default:
      return { suggested: Boolean(draft.parent), reason: "" };
  }
}

export function applyJiraDraft(
  current: JiraDraftFields,
  edited: ReadonlySet<keyof JiraDraftFields>,
  draft: Pick<JiraDraft, "parent" | "summary" | "description">,
): JiraDraftFields {
  return {
    parent: edited.has("parent") ? current.parent : draft.parent,
    summary: edited.has("summary") ? current.summary : draft.summary,
    description: edited.has("description") ? current.description : draft.description,
  };
}
