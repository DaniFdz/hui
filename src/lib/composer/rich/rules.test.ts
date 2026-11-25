/**
 * The input rules: every rule converts its completed run, every literal the guards name stays as typed, a mark typed
 * inside another adds to it, nothing fires in a code mark or a code block, and one undo brings the typed markers back
 * byte for byte.
 */
import assert from "node:assert/strict";
import { history, undo } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { test } from "vitest";
import { richInputRules } from "./rules.ts";
import { serializeMarkdown } from "./markdown.ts";
import { richSchema, schemaMark, schemaNode } from "./schema.ts";

const plugin = richInputRules(richSchema);

const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const blockquote = (...content: Node[]) => schemaNode(richSchema, "blockquote").create(null, content);
const emptyDoc = () => docOf(paragraph());

/** The position at the end of the document's last textblock's content, however deeply a container wraps it. */
function endOfLastBlock(doc: Node): number {
  let end = -1;
  doc.descendants((node, position) => {
    if (node.isTextblock) end = position + 1 + node.content.size;
    return true;
  });
  if (end < 0) throw new RangeError("The document holds no textblock.");
  return end;
}

/** One text run and its marks, for asserting what the typing produced. */
function inlineShape(doc: Node): { text: string; marks: string[] }[] {
  const shape: { text: string; marks: string[] }[] = [];
  doc.descendants((node) => {
    if (node.isText) shape.push({ text: node.text ?? "", marks: node.marks.map((mark) => mark.type.name).sort() });
  });
  return shape;
}

/** A headless editor: typing goes through the rule plugin the way the view's `handleTextInput` does. */
function editorFor(doc: Node, at = doc.content.size - 1) {
  let state = EditorState.create({ doc, selection: TextSelection.atEnd(doc), plugins: [history(), plugin] });
  if (at !== state.selection.from) state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction);
    },
    composing: false,
  };
  return {
    get state() {
      return state;
    },
    /** Types `text` one keystroke at a time, the way a person would. */
    type(text: string) {
      for (const character of text) {
        const position = state.selection.from;
        // The fifth argument is the editor's own insert; a rule that converts does its own typing instead (see rules.ts).
        const insert = () => state.tr.insertText(character, position, position);
        const handled = plugin.props.handleTextInput?.call(plugin, view as unknown as EditorView, position, position, character, insert) ?? false;
        if (!handled) state = state.apply(state.tr.insertText(character, position, position));
      }
    },
    undo() {
      undo(state, (transaction) => {
        state = state.apply(transaction);
      });
    },
  };
}

test("every mark rule converts its completed run", () => {
  const cases: readonly [typed: string, text: string, marks: string[]][] = [
    ["**bold**", "bold", ["strong"]],
    ["__strong__", "strong", ["strong"]],
    ["*it*", "it", ["em"]],
    ["_it_", "it", ["em"]],
    ["~~gone~~", "gone", ["s"]],
    ["`code`", "code", ["code"]],
  ];
  for (const [typed, text, marks] of cases) {
    const editor = editorFor(emptyDoc());
    editor.type(typed);
    assert.deepEqual(inlineShape(editor.state.doc), [{ text, marks }], `typing ${typed}`);
  }
});

test("every block rule converts its completed marker", () => {
  const cases: readonly [typed: string, name: string, attrs: Record<string, unknown>][] = [
    ["# ", "heading", { level: 1 }],
    ["###### ", "heading", { level: 6 }],
    ["> ", "blockquote", {}],
    ["- ", "bullet_list", {}],
    ["1. ", "ordered_list", { order: 1 }],
    ["1) ", "ordered_list", { order: 1 }],
    ["3. ", "ordered_list", { order: 3 }],
    ["``` ", "code_block", { language: "" }],
    ["```ts ", "code_block", { language: "ts" }],
  ];
  for (const [typed, name, attrs] of cases) {
    const editor = editorFor(emptyDoc());
    editor.type(typed);
    const block = editor.state.doc.firstChild;
    assert.equal(block?.type.name, name, `typing ${JSON.stringify(typed)}`);
    for (const [key, value] of Object.entries(attrs)) assert.equal(block?.attrs[key], value, `${name}.${key}`);
    assert.equal(editor.state.doc.textContent, "", `typing ${JSON.stringify(typed)} leaves no marker behind`);
  }
});

test("a note marker and the space after it turn the quote into that note", () => {
  const cases: readonly [typed: string, kind: string][] = [
    ["NOTE", "note"],
    ["note", "note"],
    ["TIP", "tip"],
    ["Important", "important"],
    ["WARNING", "warning"],
    ["caution", "caution"],
  ];
  for (const [typed, kind] of cases) {
    const editor = editorFor(emptyDoc());
    editor.type(`> [!${typed}] `);
    const block = editor.state.doc.firstChild;
    assert.equal(block?.type.name, "note", `typing > [!${typed}] `);
    assert.equal(block?.attrs["kind"], kind, `typing > [!${typed}] `);
    assert.equal(editor.state.doc.textContent, "", `typing > [!${typed}] leaves no marker behind`);
    assert.equal(editor.state.doc.childCount, 1, "the quote became the note, it did not join it");
    assert.equal(block?.childCount, 1);
    assert.equal(block?.firstChild?.type.name, "paragraph");
    assert.equal(block?.firstChild?.content.size, 0, "the note is empty, its marker gone");
    assert.equal(serializeMarkdown(editor.state.doc), `> [!${kind.toUpperCase()}]`, "the wire is the note's marker alone");
  }
});

test("one undo brings the typed note marker back as the text it was", () => {
  const editor = editorFor(emptyDoc());
  editor.type("> [!note] ");
  assert.equal(editor.state.doc.firstChild?.type.name, "note", "the marker converted");
  editor.undo();
  assert.equal(editor.state.doc.firstChild?.type.name, "blockquote", "one undo restores the quote it was typed in");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "[!note] ", marks: [] }], "with the marker as it was typed");
  editor.undo();
  assert.equal(editor.state.doc.firstChild?.type.name, "blockquote", "the typing is the undo after");
  assert.equal(editor.state.doc.textContent, "", "the typed marker is gone");
  editor.undo();
  assert.equal(editor.state.doc.firstChild?.type.name, "paragraph", "and then the `> ` that made the quote");
});

test("a note marker stays text without a quote, or in a quote holding more", () => {
  // No quote at all: prose keeps the marker as the text it is.
  const prose = editorFor(emptyDoc());
  prose.type("[!NOTE] ");
  assert.equal(prose.state.doc.firstChild?.type.name, "paragraph");
  assert.deepEqual(inlineShape(prose.state.doc), [{ text: "[!NOTE] ", marks: [] }]);

  // A quote already holding another paragraph is not the note's: the marker is that paragraph's text.
  const twoBlocks = docOf(blockquote(paragraph(richSchema.text("one")), paragraph()));
  const later = editorFor(twoBlocks, endOfLastBlock(twoBlocks));
  later.type("[!TIP] ");
  assert.equal(later.state.doc.firstChild?.type.name, "blockquote", "the quote is untouched");
  assert.equal(later.state.doc.firstChild?.childCount, 2);
  assert.deepEqual(inlineShape(later.state.doc), [{ text: "one", marks: [] }, { text: "[!TIP] ", marks: [] }]);

  // A marker without the space that completes it is text too, in prose and in a quote.
  const openProse = editorFor(emptyDoc());
  openProse.type("[!WARNING]");
  assert.deepEqual(inlineShape(openProse.state.doc), [{ text: "[!WARNING]", marks: [] }], "the marker alone is text");
  const openQuote = editorFor(emptyDoc());
  openQuote.type("> [!WARNING]");
  assert.equal(openQuote.state.doc.firstChild?.type.name, "blockquote", "`> ` made the quote and the marker is its text");
  assert.deepEqual(inlineShape(openQuote.state.doc), [{ text: "[!WARNING]", marks: [] }]);
});

test("a plain `> ` stays a quote", () => {
  const editor = editorFor(emptyDoc());
  editor.type("> ");
  assert.equal(editor.state.doc.firstChild?.type.name, "blockquote");
  assert.equal(editor.state.doc.firstChild?.attrs["kind"], undefined, "a quote carries no note kind");
  editor.type("quote");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "quote", marks: [] }]);
  assert.equal(serializeMarkdown(editor.state.doc), "> quote");
});

test("a literal run stays exactly as typed", () => {
  const literals = ["*", "2 * 3 * 4", "a * b", "read_text_file", "x *", "**a", "a_b_c", "**a * b**", "* 3 *"];
  for (const literal of literals) {
    const editor = editorFor(emptyDoc());
    editor.type(literal);
    assert.deepEqual(inlineShape(editor.state.doc), [{ text: literal, marks: [] }], `typing ${JSON.stringify(literal)}`);
  }
});

test("a mark rule fires only once the closing delimiter is typed", () => {
  const editor = editorFor(emptyDoc());
  editor.type("**bold");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "**bold", marks: [] }], "an unmatched opening run is text");
  editor.type("*");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "**bold*", marks: [] }], "half a closing run converts nothing");
  editor.type("*");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "bold", marks: ["strong"] }], "the closing run converts the span");
});

test("a star may open inside a word, an underscore may not", () => {
  const star = editorFor(emptyDoc());
  star.type("a*b*");
  assert.deepEqual(inlineShape(star.state.doc), [{ text: "a", marks: [] }, { text: "b", marks: ["em"] }]);
  const underscore = editorFor(emptyDoc());
  underscore.type("a_b_");
  assert.deepEqual(inlineShape(underscore.state.doc), [{ text: "a_b_", marks: [] }]);
});

test("a mark typed inside another adds to it instead of replacing it", () => {
  const emphasis = schemaMark(richSchema, "em").create();
  const editor = editorFor(docOf(paragraph(richSchema.text("x y", [emphasis]))), 3);
  editor.type("**b**");
  assert.deepEqual(inlineShape(editor.state.doc), [
    { text: "x ", marks: ["em"] },
    { text: "b", marks: ["em", "strong"] },
    { text: "y", marks: ["em"] },
  ]);
});

test("one undo restores the typed markers byte for byte, and the next removes them", () => {
  for (const typed of ["**bold**", "__strong__", "*it*", "~~gone~~", "`code`"]) {
    const editor = editorFor(emptyDoc());
    editor.type(typed);
    assert.notDeepEqual(inlineShape(editor.state.doc), [{ text: typed, marks: [] }], `${typed} was converted`);
    editor.undo();
    assert.deepEqual(inlineShape(editor.state.doc), [{ text: typed, marks: [] }], `${typed} comes back as typed`);
    editor.undo();
    assert.equal(editor.state.doc.textContent, "", `the typing before ${typed} is undone next`);
  }
});

test("a rule never fires inside a code mark", () => {
  const code = schemaMark(richSchema, "code").create();
  const editor = editorFor(docOf(paragraph(richSchema.text("x", [code]))));
  editor.type("**");
  assert.deepEqual(inlineShape(editor.state.doc), [{ text: "x**", marks: ["code"] }]);
});

test("a block rule never fires inside a code block", () => {
  const editor = editorFor(docOf(schemaNode(richSchema, "code_block").create(null, richSchema.text("x"))));
  editor.type("# ");
  assert.equal(editor.state.doc.firstChild?.type.name, "code_block");
  assert.equal(editor.state.doc.textContent, "x# ");
});

test("a block rule leaves a heading alone", () => {
  const editor = editorFor(docOf(schemaNode(richSchema, "heading").create({ level: 2 })));
  editor.type("# ");
  assert.equal(editor.state.doc.firstChild?.type.name, "heading");
  assert.equal(editor.state.doc.firstChild?.attrs["level"], 2);
  assert.equal(editor.state.doc.textContent, "# ");
});

test("a disabled rule plugin leaves every marker as typed, so a literal draft is never formatted", () => {
  // The composer turns the rules off for a literal draft: the same keystrokes that convert in a rich draft stay text.
  const off = richInputRules(richSchema, () => false);
  let state = EditorState.create({ doc: emptyDoc() });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction);
    },
    composing: false,
  };
  for (const character of "**bold** *it* `code` ~~gone~~") {
    const position = state.selection.from;
    // The fifth argument is the view's own insert, which a rule that converts does instead of the keystroke.
    const insert = () => state.tr.insertText(character, position, position);
    const handled = off.props.handleTextInput?.call(off, view as unknown as EditorView, position, position, character, insert) ?? false;
    if (!handled) state = state.apply(state.tr.insertText(character, position, position));
  }
  assert.equal(state.doc.textContent, "**bold** *it* `code` ~~gone~~");
  assert.deepEqual(inlineShape(state.doc), [{ text: "**bold** *it* `code` ~~gone~~", marks: [] }]);
});
