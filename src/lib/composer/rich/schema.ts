/**
 * The rich composer's document schema: exactly the Markdown the composer draws and the transcript's
 * `renderAgentMarkdown` renders back — paragraphs, headings, blockquotes, GitHub alert notes, bullet and ordered lists,
 * fenced code, hard breaks, emphasis, strong, strikethrough, inline code and links. It is hand-written rather than one of
 * ProseMirror's example schemas because the dialect is the product contract: `markdown.ts` parses into it and writes its
 * canonical Markdown, and every node and mark carries the `toDOM`/`parseDOM` pair an HTML paste needs.
 *
 * A note is the transcript's alert callout: `> [!NOTE]` and its four other kinds are the only state the wire carries, and
 * the title is presentation from the transcript's own label map (`../markdown/parser.ts`), never document content. The
 * element it draws is the one the transcript renders (`aside.markdown-alert`), so the composer shows the same callout.
 *
 * Images, horizontal rules, tables, task lists and math have no node here on purpose. They are not unrenderable by the
 * transcript, but the composer cannot edit them as rich content, so `sourceMode` loads a draft holding one as literal
 * text instead of dropping or corrupting it.
 */
import { Schema, type DOMOutputSpec, type MarkSpec, type MarkType, type NodeSpec, type NodeType } from "prosemirror-model";
import { bulletList, listItem, orderedList } from "prosemirror-schema-list";
import { ALERT_LABELS, type AlertType } from "../../markdown/parser.ts";

/** The `language-…` class a pasted `<pre><code>` carries, which becomes the code block's `language` attribute. */
function pastedCodeLanguage(dom: HTMLElement): string {
  const code = dom.querySelector("code");
  const classes = `${dom.className} ${code?.className ?? ""}`;
  return /(?:^|\s)language-([^\s]+)/u.exec(classes)?.[1] ?? dom.getAttribute("data-language") ?? "";
}

const paragraph: NodeSpec = {
  content: "inline*",
  group: "block",
  parseDOM: [{ tag: "p" }],
  toDOM: (): DOMOutputSpec => ["p", 0],
};

const heading: NodeSpec = {
  attrs: { level: { default: 1, validate: "number" } },
  content: "inline*",
  group: "block",
  defining: true,
  parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  toDOM: (node): DOMOutputSpec => [`h${node.attrs.level as number}`, 0],
};

const blockquote: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "blockquote" }],
  toDOM: (): DOMOutputSpec => ["blockquote", 0],
};

/** The kind a pasted callout carries in its `markdown-alert--…` class, or the default when it names none. */
function pastedAlertKind(dom: HTMLElement): AlertType {
  const kind = /(?:^|\s)markdown-alert--([a-z]+)/u.exec(dom.className)?.[1];
  return kind !== undefined && kind in ALERT_LABELS ? (kind as AlertType) : "note";
}

/**
 * A GitHub alert, `> [!NOTE]` and its four other kinds (`markdown.ts` parses and writes them). Its `toDOM` is the
 * transcript's own callout, so the composer draws the title, the tone and the body the chat draws; the title comes from
 * the label map and is never content.
 */
const note: NodeSpec = {
  attrs: { kind: { default: "note" } },
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "aside.markdown-alert", getAttrs: (dom) => ({ kind: pastedAlertKind(dom as HTMLElement) }) }],
  toDOM: (node): DOMOutputSpec => {
    const kind = String(node.attrs.kind) as AlertType;
    const label = ALERT_LABELS[kind] ?? ALERT_LABELS.note;
    return [
      "aside",
      { class: `markdown-alert markdown-alert--${kind}`, "aria-label": label },
      ["div", { class: "markdown-alert__title" }, label],
      ["div", { class: "markdown-alert__body" }, 0],
    ];
  },
};

const codeBlock: NodeSpec = {
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  attrs: { language: { default: "" } },
  parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: (dom) => ({ language: pastedCodeLanguage(dom as HTMLElement) }) }],
  toDOM: (node): DOMOutputSpec => [
    "pre",
    ["code", node.attrs.language ? { class: `language-${String(node.attrs.language)}` } : {}, 0],
  ],
};

const hardBreak: NodeSpec = {
  inline: true,
  group: "inline",
  selectable: false,
  parseDOM: [{ tag: "br" }],
  toDOM: (): DOMOutputSpec => ["br"],
};

const em: MarkSpec = {
  parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
  toDOM: (): DOMOutputSpec => ["em", 0],
};

const strong: MarkSpec = {
  parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }, { style: "font-weight=700" }],
  toDOM: (): DOMOutputSpec => ["strong", 0],
};

/** Strikethrough, written `~~like this~~`; `<s>`, `<del>` and `<strike>` all paste into it. */
const strike: MarkSpec = {
  parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }, { style: "text-decoration=line-through" }],
  toDOM: (): DOMOutputSpec => ["s", 0],
};

/** Inline code. `code: true` is what makes input rules and the Markdown serializer treat its text as literal. */
const code: MarkSpec = {
  code: true,
  parseDOM: [{ tag: "code" }, { style: "font-family=monospace" }],
  toDOM: (): DOMOutputSpec => ["code", 0],
};

const link: MarkSpec = {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  parseDOM: [{
    tag: "a[href]",
    getAttrs: (dom) => ({
      href: (dom as HTMLElement).getAttribute("href") ?? "",
      title: (dom as HTMLElement).getAttribute("title"),
    }),
  }],
  // A click on a link in the composer is the view's call, not the DOM's: no target or rel is written here.
  toDOM: (node): DOMOutputSpec => ["a", { href: String(node.attrs.href), ...(node.attrs.title ? { title: String(node.attrs.title) } : {}) }, 0],
};

/** The composer's document schema (see the module header). */
export const richSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph,
    heading,
    blockquote,
    note,
    // The list specs come from prosemirror-schema-list, so its sink/lift/split commands apply to these nodes. A list is
    // tight by default, which is the canonical form: the serializer writes no blank line between items, and the
    // Markdown reader tells them apart only for rendering.
    bullet_list: { ...bulletList, content: "list_item+", group: "block", attrs: { tight: { default: true } } },
    ordered_list: { ...orderedList, content: "list_item+", group: "block", attrs: { ...orderedList.attrs, tight: { default: true } } },
    list_item: { ...listItem, content: "paragraph block*" },
    code_block: codeBlock,
    hard_break: hardBreak,
    text: { group: "inline" },
  },
  marks: { em, strong, code, s: strike, link },
});

/** A node type of `schema` by name. The dialect's names always exist; a missing one is a programming error. */
export function schemaNode(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new RangeError(`The composer schema has no node type \`${name}\`.`);
  return type;
}

/** A mark type of `schema` by name, with the same contract as `schemaNode`. */
export function schemaMark(schema: Schema, name: string): MarkType {
  const mark = schema.marks[name];
  if (!mark) throw new RangeError(`The composer schema has no mark type \`${name}\`.`);
  return mark;
}
