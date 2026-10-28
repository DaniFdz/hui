/**
 * HUI's Markdown renderer for chat: the HTML of `parser.ts`'s parsers, memoised per source because Lit re-renders the
 * whole transcript on every update, wrapped for Lit templates.
 *
 * The agent's own replies render through a second parser (`renderAgentMarkdown`) that also wraps file references in
 * `<hui-file-ref>`, which becomes a link to the Files view once the gateway confirms the path
 * (`components/file-link.ts`). Fenced code, prose and other Markdown (hovercards, the Files view's preview, user
 * messages) are never wrapped. It draws Slack and X links as cards only when asked: the chat does so on its latest
 * messages and leaves older ones plain links.
 */
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { createMarkdownParser } from "./parser.ts";

const markdownParser = createMarkdownParser();

/** Sources retained before the cache is dropped entirely. A long transcript is
 * a few hundred Markdown strings, so one session's worth fits comfortably. */
const CACHE_LIMIT = 2_000;

/** Memoises one parse per distinct source. Lit re-runs the whole template on
 * every update — each keystroke in the composer, each streamed token and the
 * 3s session poll — so an uncached parse would repeat the entire transcript's
 * Markdown work every time any of those happens.
 *
 * `parse` is a parameter so the memoisation contract itself is testable. */
export function createMarkdownCache(
  parse: (source: string) => string = (source) => markdownParser.render(source),
): (source: string) => string {
  const cache = new Map<string, string>();
  return (source) => {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    const html = parse(source);
    // ponytail: clear-all eviction, bounded by CACHE_LIMIT; per-entry LRU only
    // if a workload larger than that shows a measurable hit-rate loss.
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(source, html);
    return html;
  };
}

export const markdownToHtml = createMarkdownCache();

export function renderMarkdown(source: string) {
  return unsafeHTML(markdownToHtml(source));
}

const agentMarkdownParser = createMarkdownParser({ fileReferences: true });
const agentLinksParser = createMarkdownParser({ fileReferences: true, linkCards: false });

/** The agent's replies: `markdownToHtml` plus file references (see the module header). */
export const agentMarkdownToHtml = createMarkdownCache((source) => agentMarkdownParser.render(source));
const agentLinksToHtml = createMarkdownCache((source) => agentLinksParser.render(source));

export function renderAgentMarkdown(source: string, linkCards = false) {
  return unsafeHTML((linkCards ? agentMarkdownToHtml : agentLinksToHtml)(source));
}
