/**
 * The rich composer's paste: what a clipboard payload becomes in the schema's document.
 *
 * Plain text is taken literally. One paragraph per blank-line group, a `hard_break` for every single newline, and no
 * marks, lists, headings or linkification: a pasted `- x`, `**b**` or URL stays that text, and serializing the slice
 * gives the lines back with the exact line structure they were pasted with (Markdown syntax is escaped, since a
 * composer's wire format is Markdown). A trailing newline also ends the last line rather than adding an empty one.
 *
 * HTML is mapped through the schema's own `parseDOM` rules, so headings, strong/em, `s`, links, lists, blockquotes,
 * `pre > code`, inline `code` and `br` arrive as the same nodes the editor draws. Before parsing, `script`, `style`,
 * `noscript`, `template`, `iframe`, `object` and `embed` elements are removed, and an `img` is replaced by its alt
 * text: an image has no node in the schema, so its alternative text is the content it still carries. The mapping runs
 * only where a DOM exists; `htmlSlice` answers `undefined` in a test or worker environment without one, and the
 * caller falls back to the plain-text path.
 */
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import { schemaNode } from "./schema.ts";

/** Two newlines with only spaces or tabs between them end a paragraph; one newline is a line break. */
const BLANK_LINES = /\n(?:[ \t]*\n)+/u;

/** The lines of every paragraph a plain-text paste carries (see the module header). */
export function plainTextLines(text: string): string[][] {
  const normalized = text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  if (!normalized.trim()) return [];
  return normalized.split(BLANK_LINES).map((group) => group.split("\n"));
}

/** One paragraph whose lines are separated by hard breaks, so a single pasted newline stays a line break. */
function textParagraph(schema: Schema, lines: readonly string[]): ProseMirrorNode {
  const content: ProseMirrorNode[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) content.push(schemaNode(schema, "hard_break").create());
    if (line) content.push(schema.text(line));
  }
  return schemaNode(schema, "paragraph").create(null, content);
}

/** The literal slice a plain-text paste inserts: no Markdown is read and nothing is linkified. */
export function plainTextSlice(schema: Schema, text: string): Slice {
  const paragraphs = plainTextLines(text).map((lines) => textParagraph(schema, lines));
  return paragraphs.length ? Slice.maxOpen(Fragment.fromArray(paragraphs)) : Slice.empty;
}

/** What `htmlSlice` needs from the environment; a DOM-less one has no `DOMParser` and gets no HTML mapping. */
export type DomEnvironment = { DOMParser?: typeof DOMParser };

/**
 * The slice a pasted HTML fragment inserts, mapped through the schema's `parseDOM` rules, or `undefined` when the
 * environment has no DOM to parse it with.
 */
export function htmlSlice(schema: Schema, html: string, environment: DomEnvironment = globalThis): Slice | undefined {
  const Parser = environment.DOMParser;
  if (typeof Parser !== "function") return undefined;
  const document = new Parser().parseFromString(html, "text/html");
  const body = document.body;
  if (!body) return undefined;
  for (const element of body.querySelectorAll("script, style, noscript, template, iframe, object, embed")) element.remove();
  for (const image of body.querySelectorAll("img")) {
    image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
  }
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(body);
  return parsed.content.size ? Slice.maxOpen(parsed.content) : Slice.empty;
}
