/**
 * OptChat's prompt-cache marks (docs/optchat.md, "Prompt caching"). Anthropic
 * writes a cache entry only where a block carries `cache_control`, and a request
 * reuses an entry only when one of its marks finds it within 20 blocks back. So a
 * view, or a compaction's context, goes as text blocks of a few lines each, and
 * the mark sits on its last whole block: the last one the next request, whose
 * view only grew at its end, still starts with. While a request still starts with
 * the prefix the previous one marked, that block is marked as well, so a request
 * that grew by more than 20 blocks still reaches it. Pure functions over pi-ai's
 * Anthropic payload; any other payload is left untouched.
 */

/** Lines per text block. */
export const BLOCK_LINES = 4;
/** Anthropic's limit of cache breakpoints per request. */
const MAX_BREAKPOINTS = 4;

type Block = Record<string, unknown>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const marked = (blocks: unknown): Block[] => Array.isArray(blocks) ? blocks.filter((block): block is Block => isRecord(block) && block["cache_control"] !== undefined) : [];

/**
 * Where `text` (`<chat>`, then one line each, then `</chat>`) is cut into blocks of `lines` lines: just before the
 * newline that starts every `lines`-th line, so `<chat>` opens the first block and the last one, the rest of the lines,
 * ends with `\n</chat>`. Block k ends at cut k and is whole: it holds `lines` lines. A text with no line, such as an
 * empty view, is not cut.
 */
export function blockCuts(text: string, lines = BLOCK_LINES): number[] {
  const breaks: number[] = [];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) breaks.push(at);
  // breaks[0] ends `<chat>`; breaks[k] starts line k, and the last one starts `</chat>`.
  const count = breaks.length - 1;
  if (!(lines >= 1) || count < 1 || (count === 1 && breaks[1] === breaks[0]! + 1)) return [];
  const cuts: number[] = [];
  for (let k = lines; k <= count; k += lines) cuts.push(breaks[k]!);
  return cuts;
}

/** `text` up to the end of its last whole block: the prefix a request marks, for the next one to read. */
export function markedPrefix(text: string, cuts: readonly number[]): string | undefined {
  return cuts.length ? text.slice(0, cuts.at(-1)) : undefined;
}

/**
 * The blocks of `text`, cut at `cuts`, to mark: its last whole block, and the block that ends `previous`, the prefix
 * the previous request marked, while `text` still starts with it. Oldest first.
 */
export function blockMarks(text: string, cuts: readonly number[], previous?: string): number[] {
  const marks: number[] = [];
  const carried = previous === undefined ? -1 : cuts.indexOf(previous.length);
  if (carried !== -1 && carried < cuts.length - 1 && text.startsWith(previous!)) marks.push(carried);
  if (cuts.length) marks.push(cuts.length - 1);
  return marks;
}

/**
 * Marks an Anthropic payload's cache: the text block equal to `block` in the first user message holding it is cut at
 * `cuts` into blocks, and the blocks numbered in `marks` get pi-ai's own `cache_control`, while the last block keeps
 * whatever mark the block had. Anthropic allows four breakpoints: pi-ai's at the request end stays, and those on the
 * tools, then the system prompt, give way first (a mark after them caches them too), then the oldest of these marks.
 * Undefined, with the payload untouched, for another API, when pi-ai does not cache (no mark of its own), with
 * nothing to mark, or without the block.
 */
export function markCache(payload: unknown, model: unknown, block: string, cuts: readonly number[], marks: readonly number[]): unknown {
  if (!isRecord(model) || model["api"] !== "anthropic-messages" || !marks.length || !isRecord(payload) || !Array.isArray(payload["messages"])) return undefined;
  const messages = payload["messages"] as unknown[];
  const control = [...messages.flatMap((message) => isRecord(message) ? marked(message["content"]) : []), ...marked(payload["system"]), ...marked(payload["tools"])][0]?.["cache_control"];
  if (!isRecord(control)) return undefined;
  for (const message of messages) {
    if (!isRecord(message) || message["role"] !== "user" || !Array.isArray(message["content"])) continue;
    const content = message["content"] as unknown[];
    const index = content.findIndex((part) => isRecord(part) && part["type"] === "text" && part["text"] === block);
    if (index === -1) continue;
    const original = content[index] as Block;
    const pieces: Block[] = [];
    let start = 0;
    cuts.forEach((cut, k) => {
      pieces.push({ type: "text", text: block.slice(start, cut), ...(marks.includes(k) ? { cache_control: { ...control } } : {}) });
      start = cut;
    });
    pieces.push({ type: "text", text: block.slice(start), ...(original["cache_control"] === undefined ? {} : { cache_control: original["cache_control"] }) });
    content.splice(index, 1, ...pieces);
    let total = messages.flatMap((each) => isRecord(each) ? marked(each["content"]) : []).length + marked(payload["system"]).length + marked(payload["tools"]).length;
    for (const extra of [...marked(payload["tools"]), ...marked(payload["system"]), ...marked(pieces.slice(0, -1))]) {
      if (total <= MAX_BREAKPOINTS) break;
      delete extra["cache_control"];
      total--;
    }
    return payload;
  }
  return undefined;
}
