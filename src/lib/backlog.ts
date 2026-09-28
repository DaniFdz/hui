/** Browser half of the Kanban backlog. The server owns `backlog.json` and the
 * Jira credential; this module only moves views and explicit operator input. */
import { parseBacklogView, type BacklogStartInput, type BacklogView } from "../../shared/backlog.ts";
import type { JiraDraft } from "../../shared/jira.ts";
import type { TaskSuggestion } from "../../shared/task-suggestions.ts";
import type { SessionView } from "./sessions-store.ts";
import { fetchJson } from "./settings-store.ts";

export { backlogItemMarkdown, backlogItemPrompt, parseBacklogView, type BacklogItem, type BacklogJiraState, type BacklogView } from "../../shared/backlog.ts";

const BACKLOG_URL = "/__hui/backlog";
const JSON_HEADERS = { "content-type": "application/json" } as const;

function itemUrl(id: string, action = ""): string {
  return `${BACKLOG_URL}/items/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

/** `refresh` bypasses the short Jira cache (the board's Refresh button). */
export async function loadBacklog(refresh = false): Promise<BacklogView> {
  return parseBacklogView(await fetchJson<unknown>(`${BACKLOG_URL}${refresh ? "?refresh=1" : ""}`, { signal: AbortSignal.timeout(30_000) }));
}

export async function setBacklogItemGroup(id: string, group: string): Promise<BacklogView> {
  return parseBacklogView(await fetchJson<unknown>(itemUrl(id), {
    method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ group }), signal: AbortSignal.timeout(30_000),
  }));
}

export async function removeBacklogItem(id: string): Promise<BacklogView> {
  return parseBacklogView(await fetchJson<unknown>(itemUrl(id), { method: "DELETE", signal: AbortSignal.timeout(30_000) }));
}

/** Creates the session (and worktree) and waits for its runtime to accept the
 * first prompt, so this can take as long as a cold boot plus a checkout. */
export async function startBacklogItem(id: string, input: BacklogStartInput): Promise<{ session: SessionView; backlog: BacklogView }> {
  const body = await fetchJson<{ session: SessionView; backlog: unknown }>(itemUrl(id, "start"), {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input),
    signal: AbortSignal.timeout(input.worktree ? 10 * 60_000 : 90_000),
  });
  return { session: body.session, backlog: parseBacklogView(body.backlog) };
}

export type SuggestedBranchName = { name: string; source: "model" | "fallback" };

/** The utility model's suggestion for the part of a new worktree branch after
 * the configured prefix; the server falls back to the title's words. */
export async function suggestBacklogBranchName(id: string, cwd: string, signal?: AbortSignal): Promise<SuggestedBranchName> {
  const body = await fetchJson<{ name?: unknown; source?: unknown }>(itemUrl(id, "branch-name"), {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ cwd }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("No branch name was suggested.");
  return { name, source: body.source === "model" ? "model" : "fallback" };
}

export async function addSuggestionToBacklog(sessionId: string, suggestionId: string): Promise<TaskSuggestion[]> {
  return (await fetchJson<{ suggestions: TaskSuggestion[] }>(
    `/__hui/sessions/${encodeURIComponent(sessionId)}/suggestions/${encodeURIComponent(suggestionId)}/backlog`,
    { method: "POST", headers: JSON_HEADERS, body: "{}", signal: AbortSignal.timeout(30_000) },
  )).suggestions;
}

export async function draftBacklogJira(id: string, project: string): Promise<JiraDraft> {
  return (await fetchJson<{ draft: JiraDraft }>(itemUrl(id, "jira/draft"), {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ project }), signal: AbortSignal.timeout(120_000),
  })).draft;
}

export async function createBacklogJira(
  id: string,
  input: { project: string; parent: string; summary: string; description: string; assignToMe: boolean },
): Promise<{ issue: { key: string; url: string }; warning?: string }> {
  return fetchJson(itemUrl(id, "jira"), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
}

export async function linkBacklogJira(id: string, key: string): Promise<{ issue: { key: string; url: string } }> {
  return fetchJson(itemUrl(id, "jira/link"), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ key }), signal: AbortSignal.timeout(30_000) });
}
