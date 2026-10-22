/**
 * The chat's rows as the iOS core hands them to the app, in one call per change: `projectChatTranscript`'s rows with
 * each activity row's labels and each tool's card presentation attached, and a `key` on every row and item that stays
 * unique when tool call ids repeat across turns (the id, plus how many earlier rows or items shared it).
 */
import type { TranscriptItem } from "../api/sessions.ts";
import { activityLabel, projectChatTranscript, type ChatActivity } from "./chat-projection.ts";
import { codemodeOutcome, codemodeSummary, codemodeToolPresentation, commandToolPresentation, readToolOutput, readToolPresentation } from "./tool-cards.ts";

function toolCards(item: ChatActivity) {
  if (item.kind !== "tool") return {};
  const codemode = codemodeToolPresentation(item);
  const read = readToolPresentation(item);
  return {
    read: read && { ...read, output: readToolOutput(item) },
    command: commandToolPresentation(item),
    codemode: codemode && { ...codemode, summary: codemodeSummary(codemode), outcome: codemodeOutcome(codemode) },
  };
}

export function chatRows(items: readonly TranscriptItem[]) {
  const seen = new Map<string, number>();
  const key = (base: string) => {
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}#${count}` : base;
  };
  return projectChatTranscript(items).map((row) => {
    const keyed = { ...row, key: key(`${row.kind}:${row.id}`) };
    if (row.kind === "messages") return { ...keyed, messages: row.messages.map((message) => ({ ...message, key: key(`message:${message.id}`) })) };
    if (row.kind !== "activity") return keyed;
    return {
      ...keyed,
      label: activityLabel(row.items, false),
      liveLabel: activityLabel(row.items, true),
      items: row.items.map((item) => ({ ...item, key: key(`${item.kind}:${item.id}`), ...toolCards(item) })),
    };
  });
}
