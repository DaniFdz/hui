/**
 * The dialect's round trip: what a draft parses to, the canonical Markdown it is sent as, and which drafts open in
 * source mode instead. `SUPPORTED_DIALECT` in `markdown.ts` is the contract these cases hold to, including the literals
 * the serializer must reproduce byte for byte (`2 * 3 * 4`, `read_text_file`, an unmatched `**`).
 */
import assert from "node:assert/strict";
import type { Node } from "prosemirror-model";
import { test } from "vitest";
import {
  canonicalize,
  hasUnsupportedMarkdown,
  parseMarkdown,
  serializeMarkdown,
  sourceMode,
  SUPPORTED_DIALECT,
} from "./markdown.ts";
import { richSchema, schemaNode } from "./schema.ts";

/** A document of `content`, with the helpers a test needs to build one. */
const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const hardBreak = () => schemaNode(richSchema, "hard_break").create();

type Case = {
  source: string;
  canonical: string;
  mode?: "rich" | "source";
};

/** One case per construct and per literal the dialect must keep, in the order the module header describes them. */
const CASES: readonly Case[] = [
  { source: "", canonical: "" },
  { source: "   ", canonical: "" },
  { source: "**bold**", canonical: "**bold**" },
  { source: "*a **b** c*", canonical: "*a **b** c*" },
  { source: "_it_ and ~~gone~~", canonical: "*it* and ~~gone~~" },
  { source: "``a`b``", canonical: "`` a`b ``" },
  { source: "```ts\nconst a = 1;\n```", canonical: "```ts\nconst a = 1;\n```" },
  { source: "~~~\nx\n~~~", canonical: "```\nx\n```" },
  { source: "- a\n   - b\n      1. c", canonical: "- a\n   - b\n      1. c" },
  { source: "- a\n   - b\n\n      4. c", canonical: "- a\n   - b\n\n      4. c" },
  { source: "1. one\n2. two\n\n- a\n- b", canonical: "1. one\n2. two\n\n- a\n- b" },
  { source: "> quote\n>\n> second", canonical: "> quote\n>\n> second" },
  { source: "# h1\n\n###### h6", canonical: "# h1\n\n###### h6" },
  { source: "a\n---", canonical: "## a" },
  { source: "[link](https://e.com)", canonical: "[link](https://e.com)" },
  { source: '[link](https://e.com "title")', canonical: '[link](https://e.com "title")' },
  { source: "a\nb", canonical: "a\nb" },
  { source: "a  \nb", canonical: "a\nb" },
  { source: "a\\\nb", canonical: "a\nb" },
  { source: "😀 **émoji** 日本語", canonical: "😀 **émoji** 日本語" },
  { source: "2 * 3 * 4", canonical: "2 * 3 * 4" },
  { source: "a * b", canonical: "a * b" },
  { source: "read_text_file", canonical: "read_text_file" },
  { source: "x *", canonical: "x *" },
  { source: "**a", canonical: "**a" },
  { source: "a\tb", canonical: "a\tb" },
  { source: "*", canonical: "- " },
  { source: "* item", canonical: "- item" },
  { source: "+ item", canonical: "- item" },
  { source: "1) x", canonical: "1. x" },
  { source: "| a | b |\n| --- | --- |", canonical: "| a | b |\n| --- | --- |", mode: "source" },
  { source: "![alt](x.png)", canonical: "![alt](x.png)", mode: "source" },
  { source: "<div>x</div>", canonical: "<div>x</div>", mode: "source" },
  { source: "$$x$$", canonical: "$$x$$", mode: "source" },
  { source: "$x$", canonical: "$x$", mode: "source" },
  { source: "- [ ] task", canonical: "- [ ] task", mode: "source" },
  { source: "> [!NOTE]\n> hi", canonical: "> [!NOTE]\n> hi", mode: "source" },
  { source: "[a]: https://x", canonical: "[a]: https://x", mode: "source" },
  { source: "session:195c3659", canonical: "session:195c3659", mode: "source" },
  { source: "`src/lib/composer/rich/schema.ts`", canonical: "`src/lib/composer/rich/schema.ts`", mode: "source" },
];

for (const entry of CASES) {
  const label = JSON.stringify(entry.source);
  test(`the dialect keeps ${label}`, () => {
    const sourceDraft = entry.mode === "source";
    assert.equal(sourceMode(entry.source), sourceDraft, `${label} opens in ${sourceDraft ? "source" : "rich"} mode`);
    assert.equal(hasUnsupportedMarkdown(entry.source), sourceDraft, `${label} unsupported construct detection`);
    assert.equal(canonicalize(entry.source), entry.canonical, `${label} canonical Markdown`);
    const doc = parseMarkdown(entry.source);
    if (sourceDraft) {
      assert.equal(doc.textContent, entry.source, `${label} is kept whole in the sentinel document`);
    } else {
      assert.equal(serializeMarkdown(doc), entry.canonical, `${label} serializes to its canonical Markdown`);
      assert.ok(parseMarkdown(entry.canonical).eq(doc), `${label} reads back as the same document`);
    }
    assert.equal(canonicalize(entry.canonical), entry.canonical, `${label} canonicalizes twice to one text`);
  });
}

/** The inline shape of a document: each text run and the marks it carries, in order. */
function inlineShape(doc: Node): { text: string; marks: string[] }[] {
  const shape: { text: string; marks: string[] }[] = [];
  doc.descendants((node) => {
    if (node.isText) shape.push({ text: node.text ?? "", marks: node.marks.map((mark) => mark.type.name).sort() });
  });
  return shape;
}

test("a parsed draft carries the structure the editor draws", () => {
  const doc = parseMarkdown("**bold** and *italic* with `code`\n\n- one\n- two\n\n> quoted\n\n```ts\nlet a = 1;\n```");
  assert.deepEqual(doc.toJSON().content?.map((node: { type: string }) => node.type), ["paragraph", "bullet_list", "blockquote", "code_block"]);
  assert.deepEqual(inlineShape(doc), [
    { text: "bold", marks: ["strong"] },
    { text: " and ", marks: [] },
    { text: "italic", marks: ["em"] },
    { text: " with ", marks: [] },
    { text: "code", marks: ["code"] },
    { text: "one", marks: [] },
    { text: "two", marks: [] },
    { text: "quoted", marks: [] },
    { text: "let a = 1;", marks: [] },
  ]);
  assert.equal(doc.firstChild?.type.name, "paragraph");
  assert.equal(doc.lastChild?.attrs["language"], "ts");
});

test("a literal text node that looks like Markdown is escaped instead of read back", () => {
  const doc = docOf(paragraph(richSchema.text("see *this* now")));
  const markdown = serializeMarkdown(doc);
  assert.equal(markdown, "see \\*this\\* now", "the line is escaped whole, so the pair cannot read back as emphasis");
  assert.ok(parseMarkdown(markdown).eq(doc), "the escaped text reads back as the same document");
});

test("a hard break at the end of a block is dropped, not written as a blank line", () => {
  const doc = docOf(paragraph(richSchema.text("a"), hardBreak()), paragraph(richSchema.text("b")));
  assert.equal(serializeMarkdown(doc), "a\n\nb");
});

test("the empty paragraph a reply's caret sits in writes no line", () => {
  const quote = parseMarkdown("My draft\n\n> First line\n> Fixture response.");
  const caret = docOf(quote.child(0), quote.child(1), paragraph());
  assert.equal(serializeMarkdown(caret), "My draft\n\n> First line\n> Fixture response.", "the caret's line is not Markdown");
  const typed = docOf(quote.child(0), quote.child(1), paragraph(richSchema.text("Thanks")));
  assert.equal(serializeMarkdown(typed), "My draft\n\n> First line\n> Fixture response.\n\nThanks", "a word typed there is its own paragraph, below the quote");
  assert.equal(serializeMarkdown(docOf(paragraph())), "", "an empty draft keeps its one block and stays empty");
});

test("a 5,000-character draft round-trips untouched", () => {
  const source = "The quick brown fox jumps over the lazy dog. ".repeat(112).trimEnd();
  assert.ok(source.length >= 5_000, `the draft is long enough (${source.length})`);
  assert.equal(sourceMode(source), false);
  assert.equal(canonicalize(source), source);
});

test("parsing never throws, whatever a draft holds", () => {
  const drafts = ["\u0000", "**".repeat(500), "[".repeat(500), "```\n".repeat(300), "<div>".repeat(200), "$".repeat(500)];
  for (const draft of drafts) {
    assert.doesNotThrow(() => parseMarkdown(draft), `parsing ${JSON.stringify(draft.slice(0, 20))}…`);
    assert.doesNotThrow(() => sourceMode(draft));
    assert.doesNotThrow(() => canonicalize(draft));
  }
});

test("the dialect documents every node and mark the schema draws", () => {
  const structural = new Set(["doc", "list_item", "text"]);
  const schemaBlocks = Object.values(richSchema.nodes)
    .map((type) => type.name)
    .filter((name) => !structural.has(name))
    .sort();
  assert.deepEqual(Object.keys(SUPPORTED_DIALECT.blocks).sort(), schemaBlocks);
  assert.deepEqual(Object.keys(SUPPORTED_DIALECT.marks).sort(), Object.keys(richSchema.marks).sort());
});
