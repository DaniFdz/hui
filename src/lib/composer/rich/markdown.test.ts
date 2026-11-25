/**
 * The dialect's round trip: what a draft parses to, the canonical Markdown it is sent as, and which drafts load as
 * literal text instead. `SUPPORTED_DIALECT` in `markdown.ts` is the contract these cases hold to, including the literals
 * the serializer must reproduce byte for byte (`2 * 3 * 4`, `read_text_file`, an unmatched `**`).
 */
import assert from "node:assert/strict";
import { Fragment, type Node } from "prosemirror-model";
import { test } from "vitest";
import {
  canonicalize,
  hasUnsupportedMarkdown,
  literalDocument,
  literalInline,
  literalWire,
  parseMarkdown,
  serializeMarkdown,
  sourceMode,
  SUPPORTED_DIALECT,
} from "./markdown.ts";
import { richSchema, schemaNode } from "./schema.ts";

/** A document of `content`, with the helpers a test needs to build one. */
const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const blockquote = (...content: Node[]) => schemaNode(richSchema, "blockquote").create(null, content);
const hardBreak = () => schemaNode(richSchema, "hard_break").create();

/**
 * A paragraph of the given runs, each its own text node: `Fragment.fromArray` joins adjacent text nodes with the same
 * marks, so a document split mid-run — which the fragment itself allows — is built through the fragment.
 */
function splitParagraph(...runs: Node[]): Node {
  const content = new (Fragment as unknown as new (content: readonly Node[], size?: number) => Fragment)(runs);
  return schemaNode(richSchema, "paragraph").create(null, content);
}

type Case = {
  source: string;
  canonical: string;
  mode?: "rich" | "literal";
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
  { source: "```\n```", canonical: "```\n```" },
  { source: "```\nx\n```\n\nafter", canonical: "```\nx\n```\n\nafter" },
  { source: "``` ts\nx\n```", canonical: "```ts\nx\n```" },
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
  { source: "| a | b |\n| --- | --- |", canonical: "| a | b |\n| --- | --- |", mode: "literal" },
  { source: "![alt](x.png)", canonical: "![alt](x.png)", mode: "literal" },
  { source: "<div>x</div>", canonical: "<div>x</div>", mode: "literal" },
  { source: "$$x$$", canonical: "$$x$$", mode: "literal" },
  { source: "$x$", canonical: "$x$", mode: "literal" },
  { source: "- [ ] task", canonical: "- [ ] task", mode: "literal" },
  // A GitHub alert is the composer's note block: its marker, its kind and its body round-trip, and the marker alone is a
  // note holding one empty paragraph.
  { source: "> [!NOTE]", canonical: "> [!NOTE]" },
  { source: "> [!note]\n> hi", canonical: "> [!NOTE]\n> hi" },
  // The two spaces of a Markdown hard break end the marker line, not the note's body.
  { source: "> [!NOTE]  \n> body", canonical: "> [!NOTE]\n> body" },
  { source: "> [!NOTE]\n> one\n>\n> two", canonical: "> [!NOTE]\n> one\n>\n> two" },
  { source: "> [!NOTE]\n> - a\n> - b", canonical: "> [!NOTE]\n> - a\n> - b" },
  { source: "> [!NOTE]\n> ```\n> x\n> ```", canonical: "> [!NOTE]\n> ```\n> x\n> ```" },
  { source: "> > [!NOTE]\n> > body", canonical: "> > [!NOTE]\n> > body" },
  { source: "> one\n> [!NOTE]", canonical: "> one\n> [!NOTE]" },
  { source: "[!NOTE]", canonical: "[!NOTE]" },
  { source: "> [!FOO]", canonical: "> [!FOO]" },
  { source: "> quote", canonical: "> quote" },
  { source: "[a]: https://x", canonical: "[a]: https://x", mode: "literal" },
  { source: "session:195c3659", canonical: "session:195c3659", mode: "literal" },
  { source: "`src/lib/composer/rich/schema.ts`", canonical: "`src/lib/composer/rich/schema.ts`", mode: "literal" },
];

for (const entry of CASES) {
  const label = JSON.stringify(entry.source);
  test(`the dialect keeps ${label}`, () => {
    const literal = entry.mode === "literal";
    assert.equal(sourceMode(entry.source), literal, `${label} loads as ${literal ? "literal text" : "a rich document"}`);
    assert.equal(hasUnsupportedMarkdown(entry.source), literal, `${label} unsupported construct detection`);
    assert.equal(canonicalize(entry.source), entry.canonical, `${label} canonical Markdown`);
    const doc = parseMarkdown(entry.source);
    if (literal) {
      assert.equal(literalWire(doc), entry.source, `${label} is kept whole as the literal document's text`);
    } else {
      assert.equal(serializeMarkdown(doc), entry.canonical, `${label} serializes to its canonical Markdown`);
      assert.ok(parseMarkdown(entry.canonical).eq(doc), `${label} reads back as the same document`);
    }
    assert.equal(canonicalize(entry.canonical), entry.canonical, `${label} canonicalizes twice to one text`);
  });
}

test("a quote's unknown marker is written byte for byte, however the text and the caret's line are split", () => {
  // `[!FOO]` names no kind, so the marker is the quote's own text: the wire carries those bytes, never an escaped pair of
  // brackets, and it reads back as that quote rather than as a note.
  const quote = parseMarkdown("> [!FOO]");
  assert.equal(quote.firstChild?.type.name, "blockquote", "a marker no kind names stays quote text");
  assert.equal(serializeMarkdown(quote), "> [!FOO]", "the marker line is written as it reads");
  assert.equal(serializeMarkdown(parseMarkdown(serializeMarkdown(quote))), "> [!FOO]", "the wire is its own canonical spelling");

  // The empty paragraph Enter leaves below the marker is the caret's, not a line of Markdown: it writes nothing, so the
  // escaper cannot read the marker as a document that differs from the one it was given and escape brackets it need not.
  const caret = docOf(blockquote(paragraph(richSchema.text("[!FOO]")), paragraph()));
  assert.equal(serializeMarkdown(caret), "> [!FOO]", "the caret's empty line below the marker writes no line");

  // How the editor split the run into nodes is not part of the wire either: two adjacent text nodes spelling the marker
  // write the same bytes as one.
  const split = docOf(blockquote(splitParagraph(richSchema.text("["), richSchema.text("!FOO]"))));
  assert.equal(serializeMarkdown(split), "> [!FOO]", "the same bytes from a run split into two text nodes");
});

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

test("a note holds the blocks its marker opens, and its marker is never content", () => {
  const blocks = (doc: Node) => doc.firstChild?.content.content.map((child) => child.type.name) ?? [];
  const list = parseMarkdown("> [!NOTE]\n> - a\n> - b");
  assert.equal(list.firstChild?.type.name, "note");
  assert.equal(list.firstChild?.attrs["kind"], "note");
  assert.deepEqual(blocks(list), ["bullet_list"], "the marker line is the note, not an empty paragraph in it");
  assert.equal(serializeMarkdown(list), "> [!NOTE]\n> - a\n> - b");

  const fenced = parseMarkdown("> [!WARNING]\n> ```ts\n> x\n> ```");
  assert.equal(fenced.firstChild?.type.name, "note");
  assert.equal(fenced.firstChild?.attrs["kind"], "warning");
  assert.deepEqual(blocks(fenced), ["code_block"]);
  assert.equal(fenced.firstChild?.firstChild?.attrs["language"], "ts");
  assert.equal(fenced.firstChild?.textContent, "x");

  const lone = parseMarkdown("> [!Tip]");
  assert.equal(lone.firstChild?.type.name, "note");
  assert.equal(lone.firstChild?.attrs["kind"], "tip");
  assert.deepEqual(blocks(lone), ["paragraph"], "a marker alone holds the note's one empty paragraph");
  assert.equal(lone.firstChild?.textContent, "", "the marker and the title are not document content");
  assert.equal(serializeMarkdown(lone), "> [!TIP]", "a note with no body writes its marker line alone");

  const nested = parseMarkdown("> > [!CAUTION]\n> > body");
  assert.equal(nested.firstChild?.type.name, "blockquote", "a note inside a quote is that quote's child");
  assert.equal(nested.firstChild?.firstChild?.type.name, "note");
  assert.equal(nested.firstChild?.firstChild?.attrs["kind"], "caution");
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

/** Drafts the schema cannot hold, each with the characters a literal draft must keep: pipes, dollars, markers and breaks. */
const LITERAL_DRAFTS = [
  "| name | $ count |\n| --- | --- |\n| **alpha** | 1 |\n\n$$x$$",
  "a | b\n2 * 3 * 4 ** ` _ ~~ [x]\n\n![alt](x.png)",
  "![line one](x.png)\n\n\nline four\n",
  "<div>*x*</div>\nnext",
] as const;

test("an unrepresentable draft loads as one literal paragraph, and writing its displayed text gives back its exact source", () => {
  for (const source of LITERAL_DRAFTS) {
    assert.equal(sourceMode(source), true, `${JSON.stringify(source)} is a literal draft`);
    const doc = literalDocument(source);
    assert.equal(doc.childCount, 1, "the document is one block");
    assert.equal(doc.firstChild?.type.name, "paragraph", "the block is a paragraph");
    assert.ok(inlineShape(doc).every((run) => run.marks.length === 0), "no run carries a mark, so no marker is hidden");
    assert.equal(literalWire(doc), source, "the displayed text is the exact source");
    assert.ok(parseMarkdown(source).eq(doc), "parseMarkdown gives the same literal document");
  }
});

test("a draft flagged literal whose parse is a rich block loads as its own text, not as that block", () => {
  // The serializer drops this fence's odd info string, so the draft is not stable and `sourceMode` flags it, yet
  // `parseMarkdown` would make a code block of it. The literal document keeps the text the operator wrote.
  const source = "```**";
  assert.equal(sourceMode(source), true);
  assert.equal(parseMarkdown(source).firstChild?.type.name, "code_block", "the parse alone would be a code block");
  const doc = literalDocument(source);
  assert.equal(doc.firstChild?.type.name, "paragraph");
  assert.equal(literalWire(doc), source);
});

test("typed or pasted text enters a literal draft as plain text, with one hard break per newline", () => {
  const nodes = literalInline("a **b**\n| c |");
  assert.deepEqual(nodes.map((node) => node.type.name), ["text", "hard_break", "text"]);
  assert.ok(nodes.every((node) => node.marks.length === 0), "no node carries a mark");
  assert.equal(literalInline("").length, 0, "empty text inserts nothing");
  assert.equal(literalWire(literalDocument("x\n\ny")), "x\n\ny", "blank lines survive");
});

test("a carriage return reads as a line break, so a literal draft's wire is written with LF", () => {
  const doc = literalDocument("first\r\nsecond\rthird");
  assert.equal(literalWire(doc), "first\nsecond\nthird");
  assert.equal(doc.firstChild?.childCount, 5, "each line is a text run, with a hard break between them");
});

test("a literal document a browser split into paragraphs writes one newline per boundary, so the bytes survive", () => {
  // A filled or dictated newline can split a literal draft into paragraphs instead of hard breaks: each boundary is a
  // line, and an empty paragraph is a blank line.
  const split = docOf(paragraph(richSchema.text("a")), paragraph(), paragraph(richSchema.text("b")));
  assert.equal(literalWire(split), "a\n\nb");
  assert.equal(literalWire(docOf(paragraph(richSchema.text("| a |")), paragraph(richSchema.text("| --- |")))), "| a |\n| --- |");
});
