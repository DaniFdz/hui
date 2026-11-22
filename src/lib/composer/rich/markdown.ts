/**
 * The rich composer's Markdown dialect: `parseMarkdown` reads a draft into the `schema.ts` document, `serializeMarkdown`
 * writes the canonical Markdown the wire format carries, and `canonicalize`/`sourceMode` decide whether a draft fits
 * the editor at all. The browser sends the same Markdown a textarea would have sent; only its spelling is normalized
 * (bullets become `- `, `*emphasis*` is kept, `__strong__` becomes `**strong**`, indented code becomes a fence, CRLF
 * becomes LF), and a draft holding a construct the editor cannot represent opens in source mode instead of losing it.
 *
 * The parser is markdown-it 15 with the transcript's CJK-friendly emphasis rules, `html: false`, `linkify: false` and
 * `breaks: true`, plus one core rule that turns every `softbreak` into a `hardbreak`: in a composer a plain newline is
 * a line break, not a space, so it must survive the round trip as a `hard_break`. Tokens the schema has no node for
 * are rejected by the ProseMirror token map (it throws) and by `hasUnsupportedMarkdown`, so nothing is dropped.
 *
 * The serializer writes `\n` for a hard break, `- ` for a bullet, `1. ` from the list's `order`, three spaces per
 * nesting level (the composer's `LIST_INDENT`), a fence one backtick longer than the longest run inside it, and
 * `[text](href)`. Its `esc` is a two-pass one: a line that already reads as its own literal text is written byte for
 * byte, so `2 * 3 * 4`, `a * b`, `read_text_file`, a lone `*` and an unmatched `**` survive untouched, while a line
 * that would read as Markdown syntax gets every metacharacter and its block marker escaped (`*genuine markdown*`
 * becomes `\*genuine markdown\*`). `serializeMarkdown` re-parses its own output and falls back to escaping every
 * metacharacter when the result would not read back as the same document. An empty paragraph at the end of a document
 * holds the editor's caret below a quote and writes no line, because no Markdown spells one.
 */
import MarkdownIt, { type Env, type StateCore, type Token } from "markdown-it";
import markdownItCjkFriendly from "markdown-it-cjk-friendly";
import type { Mark, Node } from "prosemirror-model";
import { MarkdownParser, MarkdownSerializer, type MarkdownSerializerState, type ParseSpec } from "prosemirror-markdown";
import { markdownTokens } from "../../markdown/parser.ts";
import { richSchema } from "./schema.ts";

/** What the dialect holds and how the canonical form writes it. `markdown.test.ts` holds the round trip to this. */
export const SUPPORTED_DIALECT = {
  blocks: {
    paragraph: "a blank line between paragraphs",
    heading: "`#` … `######` followed by a space; setext headings canonicalize to `#`",
    blockquote: "`> ` on every line",
    bullet_list: "`- ` for every item, three spaces per nesting level",
    ordered_list: "`1. ` counting from the list's `order`, three spaces per nesting level",
    code_block: "a backtick fence, one longer than any run inside it, with the language after it",
    hard_break: "a single newline",
  },
  marks: {
    em: "`*italic*`",
    strong: "`**bold**`",
    s: "`~~strike~~`",
    code: "backticks, one longer than any run inside the span",
    link: "`[text](href)`, with `\"title\"` only when the link carries one",
  },
  unsupported: "raw HTML, math, tables, alerts and details, images, horizontal rules, task lists, link reference definitions, and `session:`/file references the transcript draws as chips",
} as const;

const tokenizer = new MarkdownIt({ html: false, linkify: false, breaks: true });
tokenizer.use(markdownItCjkFriendly);
/** A typed newline is a line break: `softbreak` would otherwise become a space in the document. */
tokenizer.core.ruler.after("inline", "hui_composer_hard_breaks", (state: StateCore) => {
  for (const token of state.tokens) {
    for (const child of token.children ?? []) if (child.type === "softbreak") child.type = "hardbreak";
  }
});

/** The first word of a fence's info string, which is all the schema keeps as the block's language. */
function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/u)[0] ?? "";
}

/** Every markdown-it token the schema can hold. Anything else makes the draft a source-mode draft. */
const DIALECT_TOKENS: ReadonlySet<string> = new Set([
  "paragraph_open", "paragraph_close", "inline", "text", "hardbreak", "softbreak",
  "blockquote_open", "blockquote_close",
  "bullet_list_open", "bullet_list_close", "ordered_list_open", "ordered_list_close",
  "list_item_open", "list_item_close",
  "heading_open", "heading_close",
  "fence", "code_block", "code_inline",
  "em_open", "em_close", "strong_open", "strong_close", "s_open", "s_close",
  "link_open", "link_close",
]);

const parseTokens: Record<string, ParseSpec> = {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: { block: "bullet_list" },
  ordered_list: { block: "ordered_list", getAttrs: (token: Token) => ({ order: Number(token.attrGet("start")) || 1 }) },
  heading: { block: "heading", getAttrs: (token: Token) => ({ level: Number(token.tag.slice(1)) }) },
  fence: { block: "code_block", getAttrs: (token: Token) => ({ language: fenceLanguage(token.info) }), noCloseToken: true },
  code_block: { block: "code_block", getAttrs: () => ({ language: "" }), noCloseToken: true },
  hardbreak: { node: "hard_break" },
  em: { mark: "em" },
  strong: { mark: "strong" },
  s: { mark: "s" },
  link: {
    mark: "link",
    getAttrs: (token: Token) => ({
      href: token.attrGet("href") ?? "",
      title: token.attrGet("title") || null,
    }),
  },
  code_inline: { mark: "code", noCloseToken: true },
};

const markdownParser = new MarkdownParser(richSchema, tokenizer, parseTokens);

/** `markdown-it` keeps link reference definitions in `env` and emits no token for them, so they would vanish. */
function hasReferenceDefinition(source: string): boolean {
  const environment: Env = {};
  tokenizer.parse(source, environment);
  return Object.keys(environment.references ?? {}).length > 0;
}

/** Whether a draft holds a construct the schema and therefore the rich editor cannot represent. */
export function hasUnsupportedMarkdown(source: string): boolean {
  try {
    // The transcript's own tokenizer, so the draft is judged by the dialect it will be rendered with: math, alerts,
    // details, task lists, HTML, images, rules, tables and the `session:`/file chips all show up here as their tokens.
    const tokens = markdownTokens(source, true);
    const unsupported = tokens.some(function outsideDialect(token: Token): boolean {
      return !DIALECT_TOKENS.has(token.type) || token.meta?.huiAlert !== undefined
        || (token.children ?? []).some(outsideDialect);
    });
    return unsupported || hasReferenceDefinition(source);
  } catch {
    // A source the transcript's tokenizer refuses is not a source the rich editor can draw either.
    return true;
  }
}

/** Every child of `node`, with its textblocks' trailing hard breaks removed: Markdown cannot keep one. */
function stripTrailingBreaks(node: Node): Node {
  if (node.isTextblock) {
    let keep = node.childCount;
    while (keep > 0 && node.child(keep - 1).type === richSchema.nodes.hard_break) keep -= 1;
    if (keep === node.childCount) return node;
    const children: Node[] = [];
    for (let index = 0; index < keep; index += 1) children.push(node.child(index));
    return node.type.create(node.attrs, children, node.marks);
  }
  if (node.isLeaf) return node;
  const children: Node[] = [];
  let changed = false;
  node.forEach((child) => {
    const next = stripTrailingBreaks(child);
    if (next !== child) changed = true;
    children.push(next);
  });
  return changed ? node.type.create(node.attrs, children, node.marks) : node;
}

/** The document a supported source parses to, or `undefined` when the source is not representable. */
function representable(source: string): Node | undefined {
  if (hasUnsupportedMarkdown(source)) return undefined;
  try {
    return stripTrailingBreaks(markdownParser.parse(source));
  } catch {
    // An unmapped token (`table_open`, `image`, `hr`, …) throws in the ProseMirror token map: the schema has no node.
    return undefined;
  }
}

/** The lossless stand-in a caller that ignores `sourceMode` gets: the whole source as literal text, in one paragraph. */
function sentinel(source: string): Node {
  const { doc, paragraph } = richSchema.nodes;
  return doc.create(null, paragraph.create(null, source ? richSchema.text(source) : undefined));
}

/** Parses a draft. Never throws: a draft the editor cannot represent comes back as `sourceMode`'s sentinel document. */
export function parseMarkdown(source: string): Node {
  return representable(source) ?? sentinel(source);
}

/**
 * The document as Markdown spells it: no Markdown writes an empty paragraph at the end of a document, so the empty
 * paragraph an editor keeps there for the caret writes no line (the draft's one block stays, so an empty draft is
 * still an empty draft).
 */
function withoutTrailingEmptyParagraphs(doc: Node): Node {
  let count = doc.childCount;
  while (count > 1) {
    const last = doc.child(count - 1);
    if (last.type !== richSchema.nodes.paragraph || last.content.size > 0) break;
    count -= 1;
  }
  if (count === doc.childCount) return doc;
  const blocks: Node[] = [];
  for (let index = 0; index < count; index += 1) blocks.push(doc.child(index));
  return doc.type.create(doc.attrs, blocks);
}

/** The canonical Markdown for a document. */
export function serializeMarkdown(doc: Node): string {
  const written = withoutTrailingEmptyParagraphs(doc);
  const smart = smartSerializer.serialize(written);
  if (reparsesTo(smart, written)) return smart;
  // The escaping was too optimistic about a mark boundary or a line structure: escape every metacharacter instead.
  return conservativeSerializer.serialize(written);
}

/** The canonical Markdown for a source, or the source itself when the editor cannot represent it. */
export function canonicalize(source: string): string {
  const doc = representable(source);
  return doc ? serializeMarkdown(doc) : source;
}

/**
 * Whether a draft must open in the source editor: it holds a construct the schema cannot hold, the parser rejects it,
 * or canonicalizing it twice does not settle on one text and document.
 */
export function sourceMode(source: string): boolean {
  const doc = representable(source);
  if (!doc) return true;
  const canonical = serializeMarkdown(doc);
  const second = representable(canonical);
  if (!second || !second.eq(doc)) return true;
  return serializeMarkdown(second) !== canonical;
}

function reparsesTo(markdown: string, doc: Node): boolean {
  try {
    return stripTrailingBreaks(markdownParser.parse(markdown)).eq(doc);
  } catch {
    return false;
  }
}

/** Characters a Markdown reader gives a meaning to inside a line. */
const METACHARACTERS = /[\\`*_[\]~<&]/u;
/** What the conservative escaper writes with a backslash, on top of `METACHARACTERS`. */
const CONSERVATIVE_CHARACTERS = new Set([..."|$#>+=-!()"]);

/** The index of the character that would turn this line into a block construct, if there is one. */
function blockStartEscape(text: string): number | undefined {
  const indent = /^ {0,3}/u.exec(text)?.[0].length ?? 0;
  const rest = text.slice(indent);
  if (!rest) return undefined;
  if (/^[#>]/u.test(rest)) return indent;
  if (/^[*+-](?:\s|$)/u.test(rest)) return indent;
  if (/^(?:`{3,}|~{3,})/u.test(rest)) return indent;
  if (/^\|/u.test(rest)) return indent;
  if (/^=+\s*$/u.test(rest)) return indent;
  const ordered = /^(\d{1,9})([.)])(?:\s|$)/u.exec(rest);
  return ordered ? indent + (ordered[1]?.length ?? 0) : undefined;
}

/** Every metacharacter, and the character that would start a block, written with a backslash. */
function escapeEveryCharacter(text: string): string {
  const marker = blockStartEscape(text);
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    out += index === marker || METACHARACTERS.test(char) ? `\\${char}` : char;
  }
  return out;
}

/** Whether the Markdown reads as exactly this one line of literal text: one paragraph, only text inside it. */
function readsAsLiteral(markdown: string, literal: string): boolean {
  if (!markdown) return literal === "";
  const tokens = tokenizer.parse(markdown, {});
  if (tokens.length !== 3) return false;
  const [open, inline, close] = tokens;
  if (open?.type !== "paragraph_open" || inline?.type !== "inline" || close?.type !== "paragraph_close") return false;
  let text = "";
  for (const child of inline.children ?? []) {
    if (child.type !== "text") return false;
    text += child.content;
  }
  return text === literal;
}

/**
 * The two passes: a line that already reads as its own literal text is written byte for byte (so `2 * 3 * 4`,
 * `read_text_file` and an unmatched `**` survive), and a line that would read as syntax is written with every
 * metacharacter and its block marker escaped. Escaping a whole line rather than single characters keeps the output
 * symmetric: `see *this*` becomes `see \*this\*`, not `see *this\*`, and still reads back as the same text.
 */
function escapeRemark(text: string, _startOfLine = false): string {
  if (!text) return text;
  if (!METACHARACTERS.test(text) && blockStartEscape(text) === undefined) return text;
  return readsAsLiteral(text, text) ? text : escapeEveryCharacter(text);
}

/** Escapes every character that could carry a meaning, for the case where the smart pass did not read back. */
function escapeConservatively(text: string, _startOfLine = false): string {
  const marker = blockStartEscape(text);
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    out += index === marker || METACHARACTERS.test(char) || CONSERVATIVE_CHARACTERS.has(char) ? `\\${char}` : char;
  }
  return out;
}

type Escaper = (text: string, startOfLine?: boolean) => string;

/** The backticks a code span needs: one more than the longest run inside it, with the padding Markdown strips. */
function backticksFor(node: Node | undefined, side: number): string {
  const text = node?.isText ? node.text ?? "" : "";
  let ticks = 0;
  for (const match of text.matchAll(/`+/gu)) ticks = Math.max(ticks, match[0].length);
  const fence = "`".repeat(ticks + 1);
  // A fence that touches a backtick inside the span needs a gap, and a span whose content starts and ends with a
  // space loses one on each side when it is read back, so it gains one more. One space serves both.
  const padding = (text.startsWith(" ") && text.endsWith(" ") && text.trim()) || ticks > 0 ? " " : "";
  return side > 0 ? `${padding}${fence}` : `${fence}${padding}`;
}

/** A hard break is a single newline; a break that ends a block means nothing in Markdown, so it is not written. */
function writeHardBreak(state: MarkdownSerializerState, node: Node, parent: Node, index: number): void {
  for (let next = index + 1; next < parent.childCount; next += 1) {
    const sibling = parent.child(next);
    if (sibling.type === node.type) continue;
    if (sibling.isText && !/\S/u.test(sibling.text ?? "")) continue;
    state.write("\n");
    return;
  }
}

/** A fence one backtick longer than the longest run inside the code, with its language after it. */
function writeCodeBlock(state: MarkdownSerializerState, node: Node): void {
  const text = node.textContent;
  let longest = 0;
  for (const match of text.matchAll(/`{3,}/gu)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const language = /^[A-Za-z0-9_+.#-]*/u.exec(String(node.attrs.language ?? ""))?.[0] ?? "";
  state.write(`${fence}${language}\n`);
  state.text(text, false);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

/** The link destination and title, escaped for the `](…)` they sit in. */
function linkTarget(mark: Mark): string {
  const href = String(mark.attrs.href ?? "").replace(/[()"\s]/gu, (character) => character === " " ? "%20" : `\\${character}`);
  const title = mark.attrs.title ? ` "${String(mark.attrs.title).replaceAll('"', '\\"')}"` : "";
  return `${href}${title}`;
}

/** Three spaces per list level, the composer's `LIST_INDENT`, so a nested list never reaches an indented code block. */
const LIST_INDENT = "   ";

/**
 * Ends the current block and leaves one blank line behind it. `flushClose` is internal to prosemirror-markdown, but it
 * is the only way to ask the state for that blank line: a nested ordered list starting above 1 cannot interrupt a
 * paragraph, so a tight item has to be made loose before one.
 */
function blankLine(state: MarkdownSerializerState): void {
  (state as MarkdownSerializerState & { flushClose(size?: number): void }).flushClose(2);
}

function serializerWith(escape: Escaper): MarkdownSerializer {
  /** The blocks that hold inline text are the only ones whose text the serializer escapes. */
  const install = (state: MarkdownSerializerState) => {
    state.esc = escape;
  };
  return new MarkdownSerializer({
    paragraph(state, node) {
      install(state);
      state.renderInline(node);
      state.closeBlock(node);
    },
    heading(state, node) {
      install(state);
      state.write(`${"#".repeat(Number(node.attrs.level))} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    bullet_list(state, node) {
      state.renderList(node, LIST_INDENT, () => "- ");
    },
    ordered_list(state, node) {
      const start = Number(node.attrs.order ?? 1);
      state.renderList(node, LIST_INDENT, (index) => `${start + index}. `);
    },
    list_item(state, node) {
      // An ordered list that starts above 1 cannot interrupt a paragraph, so a tight item needs a blank line before
      // one; without it `4. c` would read back as a lazy line of the paragraph above.
      node.forEach((child, _, index) => {
        if (index > 0 && child.type.name === "ordered_list" && Number(child.attrs.order ?? 1) !== 1) blankLine(state);
        state.render(child, node, index);
      });
    },
    code_block(state, node) {
      writeCodeBlock(state, node);
    },
    hard_break(state, node, parent, index) {
      writeHardBreak(state, node, parent, index);
    },
    text(state, node) {
      state.text(node.text ?? "");
    },
  }, {
    em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    s: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    link: { open: () => "[", close: (_state, mark) => `](${linkTarget(mark)})`, mixable: true },
    code: {
      open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
      close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
      escape: false,
    },
  });
}

const smartSerializer = serializerWith(escapeRemark);
const conservativeSerializer = serializerWith(escapeConservatively);
