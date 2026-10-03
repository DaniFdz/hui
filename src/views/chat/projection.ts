import type { TranscriptItem } from "../../lib/sessions-store.ts";
import { parseSubagentCompletionEvent, type SubagentCompletionItem } from "../../lib/subagent-completion.ts";

export type ChatMessage = Extract<TranscriptItem, { kind: "message" }>;
export type ChatCompaction = Extract<TranscriptItem, { kind: "compaction" }>;
export type ChatActivity = Exclude<TranscriptItem, { kind: "message" | "compaction" }> | ChatMessage;

export type ChatProjectionRow =
  | { kind: "messages"; id: string; role: ChatMessage["role"]; messages: readonly ChatMessage[] }
  | { kind: "activity"; id: string; items: readonly ChatActivity[] }
  /** Where PI summarized the history above; it stays visible and rewindable. */
  | { kind: "compaction"; id: string; item: ChatCompaction }
  /** A HUI-injected subagent completion: a system event, never a user turn. */
  | { kind: "subagentEvent"; id: string; items: readonly SubagentCompletionItem[] };

/**
 * Presentation-only projection of PI's durable transcript. OpenClaw groups
 * adjacent user messages by author. While the newest turn is live, intermediate
 * assistant messages remain in place and consecutive activity is collapsed
 * between them. Once the turn settles, all intermediate context moves into one
 * disclosure and only the final assistant message remains visible. PI remains
 * the owner of event order and data.
 */
export function projectChatTranscript(
  items: readonly TranscriptItem[],
  liveLastTurn = false,
): ChatProjectionRow[] {
  const rows: ChatProjectionRow[] = [];
  let assistantTurn: ChatActivity[] = [];

  const pushActivity = (items: readonly ChatActivity[]) => {
    let ordinary: ChatActivity[] = [];
    const flushOrdinary = () => {
      if (!ordinary.length) return;
      rows.push({ kind: "activity", id: ordinary[0]!.id, items: ordinary });
      ordinary = [];
    };
    for (const item of items) {
      if (item.kind === "tool" && item.name === "present_media") {
        flushOrdinary();
        rows.push({ kind: "activity", id: item.id, items: [item] });
      } else ordinary.push(item);
    }
    flushOrdinary();
  };

  const flushLiveAssistantTurn = () => {
    let activity: ChatActivity[] = [];
    const flushActivity = () => {
      if (activity.length === 0) return;
      pushActivity(activity);
      activity = [];
    };
    for (const item of assistantTurn) {
      if (item.kind === "message" && item.role === "assistant") {
        flushActivity();
        rows.push({ kind: "messages", id: item.id, role: "assistant", messages: [item] });
      } else {
        activity.push(item);
      }
    }
    flushActivity();
    assistantTurn = [];
  };

  const flushCompletedAssistantTurn = () => {
    if (assistantTurn.length === 0) return;
    const finalIndex = assistantTurn.findLastIndex((item) => item.kind === "message" && item.role === "assistant");
    const finalIsLast = finalIndex === assistantTurn.length - 1;
    const activity = finalIsLast ? assistantTurn.slice(0, finalIndex) : assistantTurn;
    if (activity.length > 0) {
      pushActivity(activity);
    }
    if (finalIsLast) {
      const final = assistantTurn[finalIndex];
      if (final?.kind === "message") {
        rows.push({ kind: "messages", id: final.id, role: "assistant", messages: [final] });
      }
    }
    assistantTurn = [];
  };

  for (const item of items) {
    if (item.kind === "message" && item.role === "user") {
      flushCompletedAssistantTurn();
      const event = parseSubagentCompletionEvent(item.text);
      if (event) {
        rows.push({ kind: "subagentEvent", id: item.id, items: event });
        continue;
      }
      const previous = rows.at(-1);
      if (previous?.kind === "messages" && previous.role === "user") {
        rows[rows.length - 1] = { ...previous, messages: [...previous.messages, item] };
      } else {
        rows.push({ kind: "messages", id: item.id, role: "user", messages: [item] });
      }
      continue;
    }
    if (item.kind === "compaction") {
      flushCompletedAssistantTurn();
      rows.push({ kind: "compaction", id: item.id, item });
      continue;
    }
    assistantTurn.push(item);
  }
  if (liveLastTurn) flushLiveAssistantTurn();
  else flushCompletedAssistantTurn();
  return rows;
}

export function activityLabel(items: readonly ChatActivity[], streaming: boolean): string {
  const tools = items.filter((item): item is Extract<TranscriptItem, { kind: "tool" }> => item.kind === "tool");
  const running = items.findLast(
    (item) => item.kind === "tool" && (item.status ?? "running") === "running",
  );
  if (running?.kind === "tool" && tools.length === 1) return `${running.name}${streaming ? "…" : ""}`;
  if (running?.kind === "tool" && tools.length > 1) return `Ran ${tools.length} commands${streaming ? "…" : ""}`;
  if (tools.length > 0) {
    const edited = tools.filter((item) => /^(apply_patch|edit|write|file_write)$/i.test(item.name)).length;
    const commands = `Ran ${tools.length} ${tools.length === 1 ? "command" : "commands"}`;
    return edited > 0 ? `${commands}, edited ${edited} ${edited === 1 ? "file" : "files"}` : commands;
  }
  if (items.some((item) => item.kind === "thinking")) return streaming ? "Thinking…" : "Reasoning";
  return "Run details";
}

/** Short, user-facing description for the transient working indicator. */
export function workingLabel(items: readonly TranscriptItem[]): string {
  const latest = items.at(-1);
  if (latest?.kind === "message" && latest.role === "assistant") return "Writing response…";
  if (latest?.kind === "thinking") return "Thinking…";
  if (latest?.kind === "tool" && (latest.status ?? "running") === "running") {
    const name = latest.name.toLocaleLowerCase().replace(/[\s-]+/g, "_");
    if (/^(read|read_file|file_read|glob|grep|find|search|list|ls)(_|$)/u.test(name)) return "Reading files…";
    if (/^(write|write_file|file_write|edit|apply_patch)(_|$)/u.test(name)) return "Editing files…";
    if (/^(bash|shell|exec|run_command|command|terminal|npm|pnpm|yarn|test)(_|$)/u.test(name)) return "Running command…";
    if (/^git(_|$)/u.test(name)) return "Checking git…";
  }
  return "Working…";
}

/** Where the chat shows its live browser preview: the index of the activity row
 * holding the conversation's latest `browser` call (an index, since tool call
 * ids and so row ids can repeat across turns). `pending` while that call runs;
 * `currentTurn` while no later prompt started another turn. */
export function browserPreviewRow(rows: readonly ChatProjectionRow[]): { index: number; pending: boolean; currentTurn: boolean } | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind !== "activity") continue;
    const call = row.items.findLast((item) => item.kind === "tool" && item.name === "browser");
    if (call?.kind !== "tool") continue;
    const currentTurn = !rows.slice(index + 1).some((later) => later.kind === "subagentEvent" || (later.kind === "messages" && later.role === "user"));
    return { index, pending: (call.status ?? "running") === "running", currentTurn };
  }
  return undefined;
}
