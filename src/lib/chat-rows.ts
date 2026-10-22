/**
 * The chat's rows as the iOS core hands them to the app, in one call per change: `projectChatTranscript`'s rows with
 * each activity row's labels and each tool's card presentation and printed input attached, and a `key` on every row
 * and item that stays unique when tool call ids repeat across turns (the id, plus how many earlier rows or items
 * shared it).
 */
import type { TranscriptItem } from "../api/sessions.ts";
import { activityLabel, projectChatTranscript, type ChatActivity, type ChatMessage, type ChatProjectionRow } from "./chat-projection.ts";
import { codemodeOutcome, codemodeSummary, codemodeToolPresentation, commandToolPresentation, formatCallDuration, printable, readToolOutput, readToolPresentation } from "./tool-cards.ts";

function toolCards(item: ChatActivity) {
  if (item.kind !== "tool") return { read: null, command: null, codemode: null, input: null };
  const codemode = codemodeToolPresentation(item);
  const read = readToolPresentation(item);
  return {
    read: read && { ...read, output: readToolOutput(item) },
    command: commandToolPresentation(item),
    codemode: codemode && {
      ...codemode,
      calls: codemode.calls.map((call) => ({ ...call, duration: call.durationMs === undefined ? "" : formatCallDuration(call.durationMs) })),
      summary: codemodeSummary(codemode),
      outcome: codemodeOutcome(codemode),
    },
    input: item.args === undefined ? null : printable(item.args),
  };
}

type Keyed<T> = T & { key: string };
type ActivityRow = Extract<ChatProjectionRow, { kind: "activity" }>;
type ChatRow =
  | Keyed<Exclude<ChatProjectionRow, { kind: "messages" | "activity" }>>
  | Keyed<Omit<Extract<ChatProjectionRow, { kind: "messages" }>, "messages"> & { messages: Keyed<ChatMessage>[] }>
  | Keyed<Omit<ActivityRow, "items"> & { label: string; liveLabel: string; items: Keyed<ChatActivity & ReturnType<typeof toolCards>>[] }>;

export function chatRows(items: readonly TranscriptItem[]): ChatRow[] {
  const seen = new Map<string, number>();
  const key = (base: string) => {
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}#${count}` : base;
  };
  return projectChatTranscript(items).map((row): ChatRow => {
    const rowKey = key(`${row.kind}:${row.id}`);
    if (row.kind === "messages") return { ...row, key: rowKey, messages: row.messages.map((message) => ({ ...message, key: key(`message:${message.id}`) })) };
    if (row.kind !== "activity") return { ...row, key: rowKey };
    return {
      ...row,
      key: rowKey,
      label: activityLabel(row.items, false),
      liveLabel: activityLabel(row.items, true),
      items: row.items.map((item) => ({ ...item, key: key(`${item.kind}:${item.id}`), ...toolCards(item) })),
    };
  });
}
