/**
 * The browser's pure session logic over the session API's types (src/api/sessions.ts): group labels as the sidebar
 * shows and the API stores them, the session menu's Move to group choices, icon presets and Copy notices, the
 * transcript as Markdown and how an unreachable host reads.
 */
import { callMinutes, callTranscriptText } from "../voice/calls.ts";
import type { SessionGroup, SessionView, TranscriptItem } from "../../api/sessions.ts";

/** Labels are presentation, not registry identifiers. Preserve stored spelling. */
export function sessionGroupLabel(label: string): string {
  return !label || label === "ungrouped" ? "OTHER" : label.toLocaleUpperCase();
}

/** The API stores ungrouped sessions as an empty string while group projections
 * expose the stable `ungrouped` key used by the sidebar. */
export function storedSessionGroup(label: string): string {
  return !label || label === "ungrouped" ? "" : label;
}

export function sessionMoveGroupOptions(groups: readonly SessionGroup[]): Array<{ label: string; value: string }> {
  const labels = ["ungrouped", ...groups.map((group) => group.label)];
  return [...new Set(labels.map((label) => label || "ungrouped"))]
    .map((label) => ({ label: sessionGroupLabel(label), value: storedSessionGroup(label) }));
}

export const SESSION_ICONS = ["🦞", "🚀", "🐛", "✅", "🔥", "📦", "🧪", "📝", "🔍", "⚡", "🎯"] as const;
export function normalizeCustomSessionIcon(value: string): string | undefined {
  const icon = value.trim();
  return icon && icon.length <= 32 ? icon : undefined;
}

export function sessionCopiedNotice(action: "link" | "markdown" | "id" | "jira"): string {
  return action === "id" ? "Session ID copied." : action === "jira" ? "Jira link copied." : action === "link" ? "Session link copied." : "Conversation copied as Markdown.";
}

/** OpenClaw's Copy → Conversation as Markdown action, adapted to HUI's
 * normalized transcript. Pending rows are included because they are visible. */
export function transcriptAsMarkdown(items: readonly TranscriptItem[]): string {
  return items.map((item) => {
    if (item.kind === "message") return `## ${item.role === "user" ? "User" : "Assistant"}\n\n${item.text}`;
    if (item.kind === "thinking") return `### Thinking\n\n${item.text}`;
    if (item.kind === "error") return `### Error\n\n${item.text}`;
    if (item.kind === "compaction") return `### Context compacted\n\n${item.summary}`;
    if (item.kind === "call") return `### Call · ${callMinutes(item)} min\n\n${item.summary ?? "Summary unavailable."}\n\n${callTranscriptText(item.lines, item.bot ?? "Bot", "You")}`;
    const details = item.output || (item.args === undefined ? "" : JSON.stringify(item.args, null, 2));
    return `### Tool: ${item.name}${details ? `\n\n\`\`\`\n${details}\n\`\`\`` : ""}`;
  }).join("\n\n").trim();
}

/** How a session on a machine HUI cannot reach reads: its status and the
 * notice that explains it. Undefined while the session is reachable. */
export function unreachableHost(session: Pick<SessionView, "status" | "worker">): { status: string; notice: string } | undefined {
  const name = session.worker?.name ?? "its machine";
  if (session.status === "reconnecting") {
    return { status: `Reconnecting to ${name}…`, notice: `Connection to ${name} lost — the session keeps running there. HUI reconnects automatically.` };
  }
  if (session.status === "disconnected") {
    return { status: `Disconnected from ${name}`, notice: `Disconnected from ${name}. The session may still be running there.` };
  }
  return undefined;
}
