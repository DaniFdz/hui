/**
 * Transcript search: finds the sessions whose user and assistant messages contain a text, reading each
 * conversation where it is stored (this host's Durable store or a PI session file) without starting a runtime.
 * The gateway runs it for local sessions and each remote worker host for its own.
 */
import { readFile } from "node:fs/promises";
import type { Message } from "@earendil-works/pi-ai";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { ResetEntry, type Cursor } from "@earendil-works/pi-durable";
import { durableContext, type DurableHost } from "./durable-host.ts";
import { durableConversationId, textOf } from "./durable.ts";
import { isCustomInput } from "./durable-extensions.ts";

export type TranscriptHit = { sessionFile: string; snippet: string; matches: number };

const PAGE = 200;
const SNIPPET_CONTEXT = 60;

function searchable(message: unknown): message is Message {
  const role = (message as { role?: unknown } | undefined)?.role;
  return (role === "user" && !isCustomInput(message)) || role === "assistant";
}

/** Newest message first, from the latest reset on: what the session shows. */
async function* durableTexts(host: DurableHost, reference: string): AsyncGenerator<string> {
  const id = durableConversationId(reference);
  const conversation = id === undefined ? undefined : await (await host.open()).conversation(id, durableContext);
  if (!conversation) return;
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({}, PAGE, cursor, durableContext);
    for (const entry of page.items) {
      if (ResetEntry.is(entry)) return;
      for (const message of [...entry.model ?? []].reverse()) if (searchable(message)) yield textOf(message);
    }
    cursor = page.next;
  } while (cursor);
}

async function* piFileTexts(path: string): AsyncGenerator<string> {
  const entries = parseSessionEntries(await readFile(path, "utf8"));
  for (const entry of entries.reverse()) {
    if (entry.type === "message" && searchable(entry.message)) yield textOf(entry.message);
  }
}

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + length + SNIPPET_CONTEXT);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/gu, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Sessions whose history contains `query`, case-insensitively, with the newest matching message as the snippet.
 * A conversation that cannot be read is left out. */
export async function searchTranscripts(host: DurableHost, sessionFiles: readonly string[], query: string, signal?: AbortSignal): Promise<TranscriptHit[]> {
  const needle = query.trim().toLocaleLowerCase();
  const hits: TranscriptHit[] = [];
  if (!needle) return hits;
  for (const sessionFile of sessionFiles) {
    signal?.throwIfAborted();
    let hit: TranscriptHit | undefined;
    try {
      const texts = durableConversationId(sessionFile) === undefined ? piFileTexts(sessionFile) : durableTexts(host, sessionFile);
      for await (const text of texts) {
        const at = text.toLocaleLowerCase().indexOf(needle);
        if (at < 0) continue;
        hit ??= { sessionFile, snippet: snippet(text, at, needle.length), matches: 0 };
        hit.matches++;
      }
    } catch {
      continue;
    }
    if (hit) hits.push(hit);
  }
  return hits;
}
