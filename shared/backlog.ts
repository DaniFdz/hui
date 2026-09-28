/**
 * Backlog items: what the Kanban Backlog column holds instead of sessions.
 *
 * Two sources feed it. Jira work items assigned to the connected account in a
 * To Do status category, not yet linked to any session; their facts are live
 * Jira data, and HUI stores only a per-key `group`. Local tasks, which HUI owns
 * outright (title, problem, optional fix and working directory), typically
 * saved from a `suggest_task` card. A local task that gains a Jira key keeps
 * one card: the key is attached to the task and the Jira feed skips it.
 */
import type { SessionJiraIssue } from "./jira.ts";
import type { SessionStage } from "./session-stages.ts";

export type BacklogItemKind = "jira" | "local";

export type BacklogItem = {
  /** `jira:<KEY>` or `local:<uuid>`; stable across refreshes. */
  id: string;
  kind: BacklogItemKind;
  title: string;
  /** Custom group; empty for OTHER. HUI-owned for both kinds. */
  group: string;
  /** Local tasks: absolute directory the work would run in, when known. */
  cwd?: string;
  /** Local tasks: Markdown problem and, when known, proposed fix. */
  problem?: string;
  fix?: string;
  createdAt?: string;
  /** The Jira work item: the item itself for `jira`, an attached key for `local`. */
  jira?: SessionJiraIssue;
};

/** Whether the Jira half of the backlog could be read. Never an error wall:
 * the board shows local tasks and a quiet note. */
export type BacklogJiraState =
  | { status: "ok" }
  | { status: "unconfigured" }
  | { status: "unavailable"; message: string };

export type BacklogView = { items: BacklogItem[]; jira: BacklogJiraState };

/** Body of `POST /__hui/backlog/items/:id/start`. */
export type BacklogStartInput = {
  cwd: string;
  worktree: boolean;
  branchName?: string;
  baseRef?: string;
  stage: SessionStage;
  group: string;
};

export const BACKLOG_LIMITS = {
  title: 200,
  problem: 12_000,
  fix: 8_000,
  cwd: 4_096,
  group: 200,
  tasks: 500,
} as const;

export function backlogItemId(kind: BacklogItemKind, key: string): string {
  return `${kind}:${key}`;
}

/** First turn of a session started from a backlog item. Jira items carry
 * their summary, description and link; local tasks their problem and fix. */
export function backlogItemPrompt(item: Pick<BacklogItem, "kind" | "title" | "problem" | "fix" | "jira">): string {
  const link = item.jira ? [`Jira: [${item.jira.key}](${item.jira.url})`] : [];
  if (item.kind === "jira") {
    const summary = item.jira?.summary || item.title;
    return [
      `# ${item.jira ? `${item.jira.key}: ` : ""}${summary}`,
      ...link,
      "## Description",
      item.jira?.description?.trim() || "No description in Jira. Investigate and confirm the scope before changing code.",
    ].join("\n\n");
  }
  return [
    `# ${item.title}`,
    ...link,
    "## Problem", item.problem?.trim() || "Not described.",
    "## Proposed fix",
    item.fix?.trim() || "Not known yet. Investigate and confirm the root cause before changing code.",
  ].join("\n\n");
}

/** Plain text of a backlog item for the clipboard. */
export function backlogItemMarkdown(item: BacklogItem): string {
  return backlogItemPrompt(item);
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** Browser-side normalization of `GET /__hui/backlog`; drops malformed rows. */
export function parseBacklogView(value: unknown): BacklogView {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const items = Array.isArray(raw["items"]) ? raw["items"].flatMap((entry): BacklogItem[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const kind = row["kind"] === "jira" || row["kind"] === "local" ? row["kind"] : undefined;
    const id = text(row["id"], 200);
    const title = text(row["title"], BACKLOG_LIMITS.title);
    if (!kind || !id || !title) return [];
    const jiraRaw = row["jira"] && typeof row["jira"] === "object" ? row["jira"] as Record<string, unknown> : undefined;
    const jira = jiraRaw && typeof jiraRaw["key"] === "string" && typeof jiraRaw["url"] === "string"
      ? jiraRaw as unknown as SessionJiraIssue
      : undefined;
    if (kind === "jira" && !jira) return [];
    const cwd = text(row["cwd"], BACKLOG_LIMITS.cwd);
    const problem = text(row["problem"], BACKLOG_LIMITS.problem);
    const fix = text(row["fix"], BACKLOG_LIMITS.fix);
    const createdAt = text(row["createdAt"], 40);
    return [{
      id, kind, title, group: text(row["group"], BACKLOG_LIMITS.group),
      ...(cwd ? { cwd } : {}), ...(problem ? { problem } : {}), ...(fix ? { fix } : {}),
      ...(createdAt ? { createdAt } : {}), ...(jira ? { jira } : {}),
    }];
  }) : [];
  const jiraRaw = raw["jira"] && typeof raw["jira"] === "object" ? raw["jira"] as Record<string, unknown> : {};
  const jira: BacklogJiraState = jiraRaw["status"] === "ok"
    ? { status: "ok" }
    : jiraRaw["status"] === "unavailable"
      ? { status: "unavailable", message: text(jiraRaw["message"], 400) || "Jira could not be reached." }
      : { status: "unconfigured" };
  return { items, jira };
}
