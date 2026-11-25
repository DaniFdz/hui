/**
 * Paste: plain text becomes a literal slice, so its lines survive exactly and nothing in it is read as Markdown, and
 * HTML is mapped through the schema's `parseDOM` rules where a DOM exists. Node has no `DOMParser`, so the mapping is
 * proved against the small test DOM below rather than a DOM implementation added to the project's dependencies.
 */
import assert from "node:assert/strict";
import type { Node } from "prosemirror-model";
import { test } from "vitest";
import { serializeMarkdown, sourceMode } from "./markdown.ts";
import { htmlSlice, plainTextLines, plainTextSlice } from "./paste.ts";
import { richSchema, schemaNode } from "./schema.ts";

/** The document a slice inserts into an empty one, for asserting what a paste carries. */
function documentOf(slice: ReturnType<typeof plainTextSlice>): Node {
  return schemaNode(richSchema, "doc").create(null, slice.content);
}

/** A `toJSON` result as plain objects: a node's `attrs` carry a null prototype, which a deep comparison would refuse. */
function plainJson(doc: Node): unknown {
  return JSON.parse(JSON.stringify(doc.toJSON()));
}

test("a plain-text paste keeps its line structure", () => {
  assert.deepEqual(plainTextLines("a\nb\n\nc"), [["a", "b"], ["c"]]);
  assert.deepEqual(plainTextLines("a\r\nb\r\n\r\nc"), [["a", "b"], ["c"]]);
  assert.deepEqual(plainTextLines("a\n \n\t\nb"), [["a"], ["b"]], "a line of whitespace is a blank line");
  assert.deepEqual(plainTextLines("a\n"), [["a"]], "the trailing newline ends the last line");
  assert.deepEqual(plainTextLines("   \n\n"), [], "a whitespace-only paste carries nothing");
  const doc = documentOf(plainTextSlice(richSchema, "a\nb\n\nc"));
  assert.deepEqual(doc.toJSON(), {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hard_break" }, { type: "text", text: "b" }] },
      { type: "paragraph", content: [{ type: "text", text: "c" }] },
    ],
  });
  assert.equal(serializeMarkdown(doc), "a\nb\n\nc", "the Markdown keeps the pasted lines exactly");
});

test("plain text is never read as Markdown, linked or changed", () => {
  const text = "- x\n**b**\nhttps://e.com\nread_text_file";
  const slice = plainTextSlice(richSchema, text);
  const doc = documentOf(slice);
  assert.equal(doc.childCount, 1, "no list was built");
  const marks: string[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) marks.push(mark.type.name);
  });
  assert.deepEqual(marks, [], "no mark, and no link, was added");
  const markdown = serializeMarkdown(doc);
  assert.equal(markdown, "\\- x\n\\*\\*b\\*\\*\nhttps://e.com\nread_text_file", "only what Markdown would read is escaped");
  assert.equal(sourceMode(markdown), false, "the escaped text is ordinary rich-composer content");
});

test("a pasted table is escaped rich text, so it never becomes a literal draft", () => {
  const text = "| a | b |\n| --- | --- |";
  const doc = documentOf(plainTextSlice(richSchema, text));
  assert.equal(doc.childCount, 1);
  const markdown = serializeMarkdown(doc);
  assert.equal(sourceMode(markdown), false);
  assert.notEqual(markdown, text, "the pipes are escaped so the table never forms");
});

test("an empty paste is an empty slice", () => {
  assert.equal(plainTextSlice(richSchema, "").content.size, 0);
  assert.equal(plainTextSlice(richSchema, "\n\n").content.size, 0);
});

test("an HTML paste is only mapped where a DOM exists", () => {
  // Node has no DOMParser; the browser does, and the mapping it enables is the case below.
  assert.equal(htmlSlice(richSchema, "<p><strong>bold</strong></p>"), undefined);
  assert.equal(htmlSlice(richSchema, "<p><strong>bold</strong></p>", {}), undefined);
  assert.equal(typeof globalThis.DOMParser, "undefined", "the guard is what makes the fallback reachable here");
});

/**
 * The test DOM: exactly the surface `htmlSlice` and ProseMirror's `DOMParser` read — node type and name, attributes,
 * children and siblings, tag, class and attribute selectors, and `createTextNode`. Nothing here needs a full DOM.
 */
class TestNode {
  attributes = new Map<string, string>();
  childNodes: TestNode[] = [];
  parentNode: TestNode | undefined;
  previousSibling: TestNode | undefined;
  nextSibling: TestNode | undefined;
  ownerDocument: TestDocument;

  private constructor(
    document: TestDocument,
    readonly nodeType: 1 | 3,
    readonly nodeName: string,
    private readonly value = "",
  ) {
    this.ownerDocument = document;
  }

  static element(document: TestDocument, name: string, attributes: Record<string, string> = {}): TestNode {
    const node = new TestNode(document, 1, name.toUpperCase());
    node.attributes = new Map(Object.entries(attributes));
    return node;
  }

  static text(document: TestDocument, value: string): TestNode {
    return new TestNode(document, 3, "#text", value);
  }

  get nodeValue(): string {
    return this.value;
  }

  get tagName(): string | undefined {
    return this.nodeType === 1 ? this.nodeName : undefined;
  }

  get firstChild(): TestNode | undefined {
    return this.childNodes[0];
  }

  get className(): string {
    return this.attributes.get("class") ?? "";
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  appendChild(child: TestNode): void {
    child.remove();
    link(this, [...this.childNodes, child]);
  }

  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    link(parent, parent.childNodes.filter((child) => child !== this));
    this.parentNode = undefined;
  }

  replaceWith(replacement: TestNode): void {
    const parent = this.parentNode;
    if (!parent) return;
    replacement.remove();
    link(parent, parent.childNodes.map((child) => (child === this ? replacement : child)));
    this.parentNode = undefined;
  }

  matches(selector: string): boolean {
    return this.nodeType === 1 && selector.split(",").some((part) => matchesPart(this, part));
  }

  querySelectorAll(selector: string): TestNode[] {
    const found: TestNode[] = [];
    for (const child of this.childNodes) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }

  querySelector(selector: string): TestNode | undefined {
    return this.querySelectorAll(selector)[0];
  }
}

/** Hangs `children` off `parent`, keeping every parent, sibling and owner-document link true. */
function link(parent: TestNode, children: TestNode[]): void {
  parent.childNodes = children;
  children.forEach((child, index) => {
    child.parentNode = parent;
    child.ownerDocument = parent.ownerDocument;
    child.previousSibling = children[index - 1];
    child.nextSibling = children[index + 1];
  });
}

/**
 * A tag name, any number of `.class` segments, and an optional attribute: what the schema's `parseDOM` rules ask for
 * (`aside.markdown-alert`, `div.markdown-alert.markdown-alert--tip`, `p`, `a[href]`). A selector outside that shape
 * throws instead of quietly matching nothing, so a rule this test DOM cannot answer fails here rather than in a browser
 * where it would pass.
 */
function matchesPart(node: TestNode, selector: string): boolean {
  const part = /^\s*([a-zA-Z][a-zA-Z0-9-]*)((?:\.[^\s.[\]#:>+~]+)*)(?:\[([-a-zA-Z_:][-a-zA-Z0-9_:.]*)\])?\s*$/u.exec(selector);
  if (!part) throw new RangeError(`The test DOM has no selector ${JSON.stringify(selector.trim())}.`);
  if (node.nodeName !== part[1]?.toUpperCase()) return false;
  const classes = node.className.split(/\s+/u);
  const wanted = (part[2] ?? "").split(".").filter((name) => name !== "");
  if (!wanted.every((name) => classes.includes(name))) return false;
  return part[3] === undefined || node.hasAttribute(part[3]);
}

const VOID_ELEMENTS = new Set(["br", "hr", "img", "input", "link", "meta"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/gu;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu;

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

/** The `<body>` a fragment parses to: tags nest, text is literal, and void elements never take children. */
function parseFragment(html: string, document: TestDocument): TestNode {
  const body = TestNode.element(document, "body");
  const open = [body];
  for (const match of html.matchAll(TAG)) {
    const [, closing, name, attributes, selfClosing, text] = match;
    if (text !== undefined) {
      open[open.length - 1]!.appendChild(TestNode.text(document, text));
      continue;
    }
    if (closing) {
      const openAt = open.map((node) => node.nodeName.toLowerCase()).lastIndexOf(name!.toLowerCase());
      if (openAt > 0) open.length = openAt;
      continue;
    }
    const element = TestNode.element(document, name!, attributesOf(attributes ?? ""));
    open[open.length - 1]!.appendChild(element);
    if (!VOID_ELEMENTS.has(name!.toLowerCase()) && !selfClosing) open.push(element);
  }
  return body;
}

class TestDocument {
  readonly body: TestNode;

  constructor(html: string) {
    this.body = parseFragment(html, this);
  }

  createTextNode(value: string): TestNode {
    return TestNode.text(this, value);
  }
}

/** Just the `parseFromString` `htmlSlice` calls. */
class TestDOMParser {
  parseFromString(html: string): TestDocument {
    return new TestDocument(html);
  }
}

const TEST_DOM = { DOMParser: TestDOMParser as unknown as typeof DOMParser };

/** Every text run and the marks it carries, in order. */
function inlineShape(node: Node): { text: string; marks: string[] }[] {
  const shape: { text: string; marks: string[] }[] = [];
  node.descendants((child) => {
    if (child.isText) shape.push({ text: child.text ?? "", marks: child.marks.map((mark) => mark.type.name).sort() });
  });
  return shape;
}

test("an HTML paste is mapped through the schema's parseDOM rules", () => {
  const html = "<h2>Title</h2>"
    + '<p>a <strong>b</strong> and <em>c</em> and <a href="https://e.com">d</a><br>e</p>'
    + "<ul><li>one</li><li>two</li></ul>"
    + '<pre><code class="language-ts">let a = 1;</code></pre>'
    + '<p><code>inline</code> <s>gone</s> <img alt="pic" src="x.png"><script>alert(1)</script></p>';
  const slice = htmlSlice(richSchema, html, TEST_DOM);
  assert.ok(slice, "a DOM environment maps the fragment");
  const doc = documentOf(slice);
  const blocks: Node[] = [];
  doc.forEach((block) => blocks.push(block));
  assert.deepEqual(blocks.map((block) => block.type.name), ["heading", "paragraph", "bullet_list", "code_block", "paragraph"]);
  assert.deepEqual([blocks[0]?.attrs["level"], blocks[0]?.textContent], [2, "Title"], "a heading keeps its level");
  assert.deepEqual(inlineShape(blocks[1]!), [
    { text: "a ", marks: [] },
    { text: "b", marks: ["strong"] },
    { text: " and ", marks: [] },
    { text: "c", marks: ["em"] },
    { text: " and ", marks: [] },
    { text: "d", marks: ["link"] },
    { text: "e", marks: [] },
  ], "strong, em and a link arrive as marks, and the br as a hard break between d and e");
  assert.deepEqual(blocks[1]?.content.content.map((child) => child.type.name), ["text", "text", "text", "text", "text", "text", "hard_break", "text"]);
  assert.deepEqual(blocks[2]?.content.content.map((item) => item.textContent), ["one", "two"], "a list keeps its items");
  assert.deepEqual([blocks[3]?.attrs["language"], blocks[3]?.textContent], ["ts", "let a = 1;"], "pre > code keeps its language");
  assert.deepEqual(inlineShape(blocks[4]!), [{ text: "inline", marks: ["code"] }, { text: " ", marks: [] }, { text: "gone", marks: ["s"] }, { text: " pic", marks: [] }], "the image became its alt text, merged with the space before it");
  assert.equal(doc.textContent.includes("alert(1)"), false, "a script's text never reaches the document");
});

test("a pasted callout becomes a note of its kind, and a plain aside stays ordinary text", () => {
  const html = '<aside class="markdown-alert markdown-alert--warning" aria-label="Warning">'
    + '<div class="markdown-alert__title">Warning</div>'
    + '<div class="markdown-alert__body"><p>Check it</p></div>'
    + "</aside>";
  const slice = htmlSlice(richSchema, html, TEST_DOM);
  assert.ok(slice, "a DOM maps the pasted callout");
  const doc = documentOf(slice);
  assert.deepEqual(plainJson(doc), {
    type: "doc",
    content: [{
      type: "note",
      attrs: { kind: "warning" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Check it" }] }],
    }],
  }, "aside.markdown-alert is the note's parseDOM selector, the kind is the markdown-alert--… class, and the title it draws is never content beside it");

  const plain = documentOf(htmlSlice(richSchema, "<aside>plain</aside>", TEST_DOM)!);
  const plainTypes: string[] = [];
  plain.descendants((node) => {
    plainTypes.push(node.type.name);
  });
  assert.equal(plain.child(0).type.name, "paragraph", "a bare aside has no rule, so its text becomes a paragraph");
  assert.equal(plain.textContent, "plain");
  assert.equal(plainTypes.includes("note"), false, "it does not become a note");
});

test("a callout's body keeps every block, and one without a body keeps what the aside holds", () => {
  const html = '<aside class="markdown-alert markdown-alert--tip">'
    + '<div class="markdown-alert__title">Tip</div>'
    + '<div class="markdown-alert__body"><p>First</p><ul><li>one</li></ul></div>'
    + "</aside>";
  const doc = documentOf(htmlSlice(richSchema, html, TEST_DOM)!);
  assert.deepEqual(plainJson(doc), {
    type: "doc",
    content: [{
      type: "note",
      attrs: { kind: "tip" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "bullet_list", attrs: { tight: true }, content: [{ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
      ],
    }],
  }, "the body's second block is content too, and the title is still not");
  assert.equal(serializeMarkdown(doc), "> [!TIP]\n> First\n>\n> - one", "the note writes back as one callout of that kind");

  const noBody = documentOf(htmlSlice(richSchema, '<aside class="markdown-alert markdown-alert--note">Everything</aside>', TEST_DOM)!);
  assert.deepEqual(plainJson(noBody), {
    type: "doc",
    content: [{
      type: "note",
      attrs: { kind: "note" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Everything" }] }],
    }],
  }, "a callout with no markdown-alert__body keeps whatever the aside holds");
});

test("the test DOM answers the schema's selector shapes and refuses any other", () => {
  const document = new TestDocument("");
  const alert = TestNode.element(document, "div", { class: "markdown-alert markdown-alert--tip" });
  assert.equal(alert.matches("div.markdown-alert"), true, "one class segment");
  assert.equal(alert.matches("div.markdown-alert.markdown-alert--tip"), true, "several class segments, all required");
  assert.equal(alert.matches("div.markdown-alert.markdown-alert--note"), false, "a class it does not carry");
  assert.equal(alert.matches("aside.markdown-alert"), false, "a tag it is not");
  assert.equal(TestNode.element(document, "aside", { "data-x": "1" }).matches("aside[data-x]"), true);
  assert.equal(TestNode.element(document, "aside").matches("aside[data-x]"), false);
  assert.throws(() => alert.matches("aside > p"), RangeError, "a selector it cannot read throws instead of passing");
});
