/**
 * The chat's rows as the iOS core hands them to the app, in one call per change: `projectChatTranscript`'s rows with
 * each activity row's labels, its question summary (`questionnaireSummary`) and each tool's card presentation and
 * printed input attached, each message's shown text (a bot's or session's without HUI's header) and whether it renders
 * as Markdown (the agent's and those senders', not the operator's, a routine's or a trigger's), each message row's footer (the text Reply and Copy use, without a sender's header, and the
 * Copy button's label, as the web's footer reads them), and a `key` on every row
 * and item that stays unique when tool call ids repeat across turns (the id, plus how many earlier rows or items
 * shared it).
 */
import type { TranscriptItem } from "../api/sessions.ts";
import { activityLabel, attributedMessage, projectChatTranscript, questionnaireSummary, type ChatActivity, type ChatProjectionRow } from "./chat-projection.ts";
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
type MessagesRow = Extract<ChatProjectionRow, { kind: "messages" }>;

function messagesRow(row: MessagesRow, key: (base: string) => string) {
  const markdown = row.role === "assistant" || !!row.sender && row.sender.kind !== "routine" && row.sender.kind !== "trigger";
  const messages = row.messages.map((message) => ({ ...message, key: key(`message:${message.id}`), shown: row.sender ? attributedMessage(message.text)?.body ?? message.text : message.text, markdown }));
  const last = messages.at(-1);
  const footer = last && !last.pending && last.shown ? { text: last.shown, copyLabel: row.sender ? "Copy message" : row.role === "assistant" ? "Copy response" : "Copy prompt" } : null;
  return { ...row, messages, footer };
}
type ChatRow =
  | Keyed<Exclude<ChatProjectionRow, { kind: "messages" | "activity" }>>
  | Keyed<ReturnType<typeof messagesRow>>
  | Keyed<Omit<ActivityRow, "items"> & { label: string; liveLabel: string; answers: ReturnType<typeof questionnaireSummary> | null; items: Keyed<ChatActivity & ReturnType<typeof toolCards>>[] }>;

export function chatRows(items: readonly TranscriptItem[]): ChatRow[] {
  const seen = new Map<string, number>();
  const key = (base: string) => {
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}#${count}` : base;
  };
  return projectChatTranscript(items).map((row): ChatRow => {
    const rowKey = key(`${row.kind}:${row.id}`);
    if (row.kind === "messages") return { ...messagesRow(row, key), key: rowKey };
    if (row.kind !== "activity") return { ...row, key: rowKey };
    return {
      ...row,
      key: rowKey,
      label: activityLabel(row.items, false),
      liveLabel: activityLabel(row.items, true),
      answers: questionnaireSummary(row.items) ?? null,
      items: row.items.map((item) => ({ ...item, key: key(`${item.kind}:${item.id}`), ...toolCards(item) })),
    };
  });
}
