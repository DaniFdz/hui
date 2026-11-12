/**
 * OptChat's transcript search: the reading tool the reference recipe does not
 * have, because a view can only be opened where it already names a line, so the
 * agent finds a word again only by remembering which summary stood near it.
 * `search_chat(query)` walks the log newest first and answers with the messages
 * that mention the query, each named as the view's own line `id+1` so that
 * `zoom(id, 1)` opens it word for word. A search's own call is skipped, since
 * every search would otherwise answer with the line that asked it. It only
 * reads: the log is history and a search never appends, edits or summarizes it.
 */
import type { MessageLine } from "./store.ts";
import { cutUtf8, flatten } from "./text.ts";

/** The most lines one search answers with, when it is not given a smaller limit. */
export const SEARCH_LIMIT = 20;
/** The most of one message a hit shows, in bytes: enough to recognize it, never the message. */
export const SEARCH_SNIPPET = 200;
/** The most hits one search answers with, whatever it is asked for. */
export const SEARCH_MAX = 100;
/** The most messages a search looks at before it gives up on older ones, and the bytes they may hold. */
export const SEARCH_SCAN = 50_000;
export const SEARCH_BYTES = 8_000_000;

/** How much of a chat one search reads; a test lowers them, a caller never does. */
export type SearchBounds = { readonly scan?: number; readonly bytes?: number };

/** The hit's text: at most `SEARCH_SNIPPET` bytes of a flattened line, marked where it was cut. */
const snippetOf = (line: string): string => {
  const cut = cutUtf8(line, SEARCH_SNIPPET);
  return cut.length === line.length ? cut : `${cut}…`;
};

/**
 * The search tool's answer: the messages mentioning `query`, newest first, each as `id+1|<kind>: <snippet>` (the
 * view's label for the line covering that one message), then the limits that applied. A query is a word or phrase,
 * matched case-insensitively against each message as the view writes it: `kind: text`, newlines as single spaces.
 */
export function searchLog(messages: readonly MessageLine[], query: string, limit?: number, bounds: SearchBounds = {}): string {
  const asked = flatten(query).trim();
  if (!asked) return "No word to search for.";
  const askedFor = limit === undefined || !Number.isFinite(limit) ? SEARCH_LIMIT : Math.trunc(limit);
  const most = Math.min(Math.max(1, askedFor), SEARCH_MAX);
  const scanMost = bounds.scan ?? SEARCH_SCAN;
  const byteMost = bounds.bytes ?? SEARCH_BYTES;
  const needle = asked.toLowerCase();
  const hits: string[] = [];
  let scanned = 0;
  let visited = 0;
  let bounded = false;
  let limited = false;
  for (let id = messages.length - 1; id >= 0; id--) {
    if (scanned >= scanMost || visited >= byteMost) { bounded = true; break; }
    const message = messages[id]!;
    scanned++;
    visited += message.size;
    const line = flatten(`${message.kind}: ${message.text}`);
    // A search's own call is not an answer: every search would otherwise start with the line that asked.
    if (message.kind === "tool" && message.text.startsWith("search_chat ")) continue;
    if (!line.toLowerCase().includes(needle)) continue;
    hits.push(`${id}+1|${snippetOf(line)}`);
    if (hits.length >= most) { limited = id > 0; break; }
  }
  const where = bounded ? `the newest ${scanned} of ${messages.length} messages` : "the chat";
  if (!hits.length) return `No line mentions "${asked}" in ${where}.`;
  const notes = [limited ? `[at most ${most} shown]` : "", bounded ? `[searched ${where}]` : ""].filter(Boolean);
  return [`${hits.length} ${hits.length === 1 ? "line mentions" : "lines mention"} "${asked}", newest first:`, ...hits, ...notes].join("\n");
}
