/**
 * The browse page (spec section 10): the whole memory as one self-contained HTML
 * page, with the current view, ROOT (every message) and each level of the tree;
 * every entry shows its range, time span and size. Everything is escaped.
 */
import type { MessageLine } from "./store.ts";
import { bytes, localDateTime } from "./text.ts";
import { endOf, label, PLACEHOLDER, startOf, type Part, type Tree } from "./tree.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, (char) => ESCAPES[char]!);

export type BrowseInput = { readonly title: string; readonly log: readonly MessageLine[]; readonly tree: Tree; readonly view: readonly Part[] };

/** First and last message dates of a range, local time. */
function timeSpan(log: readonly MessageLine[], part: Part): string {
  const first = log[startOf(part)];
  const last = log[Math.min(endOf(part), log.length) - 1];
  if (!first || !last) return "";
  const from = localDateTime(new Date(first.date));
  const to = localDateTime(new Date(last.date));
  return from === to ? from : `${from} → ${to}`;
}

function entry(range: string, when: string, size: number, text: string): string {
  return `<li><div class="meta"><b>${escapeHtml(range)}</b> <span>${escapeHtml(when)}</span> <span>${size} B</span></div><pre>${escapeHtml(text)}</pre></li>`;
}

function nodeEntries(input: BrowseInput, parts: readonly Part[]): string {
  return parts.map((part) => {
    const text = input.tree.text(part[0], part[1]) ?? PLACEHOLDER;
    return entry(label(part), timeSpan(input.log, part), bytes(text), text);
  }).join("");
}

export function browsePage(input: BrowseInput): string {
  const sections = [
    `<section><h2>View · ${input.view.length} lines</h2><ol>${nodeEntries(input, input.view)}</ol></section>`,
    `<section><h2>ROOT · ${input.log.length} messages</h2><ol>${input.log.map((line) =>
      entry(`#${line.i} ${line.kind}`, localDateTime(new Date(line.date)), line.size, line.text)).join("")}</ol></section>`,
  ];
  for (let l = 0; l < input.tree.depth; l++) {
    const nodes = input.tree.level(l).map(([i]) => [l, i] as const);
    sections.push(`<section><h2>Level ${l} · ${nodes.length} nodes</h2><ol>${nodeEntries(input, nodes)}</ol></section>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
body { margin: 2rem; font: 14px/1.45 system-ui, sans-serif; color: #1f2328; background: #f6f8fa; }
section { margin-bottom: 2rem; }
ol { list-style: none; padding: 0; }
li { margin: 0 0 .5rem; padding: .5rem .75rem; background: #fff; border: 1px solid #d0d7de; border-radius: 6px; }
.meta { display: flex; gap: 1rem; color: #57606a; }
pre { margin: .25rem 0 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.45 ui-monospace, monospace; }
</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
${sections.join("\n")}
</body>
</html>
`;
}
