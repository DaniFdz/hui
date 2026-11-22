/**
 * The composer's keys: what Enter means in prose, a list item and a code block, that Shift+Enter always hard-breaks,
 * that Tab and Shift+Tab leave the editor alone outside a list, and that the formatting chords, undo, redo and
 * select-all act on the document. The Enter policy itself is documented in `keys.ts`.
 */
import assert from "node:assert/strict";
import { history, redo, undo } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { test } from "vitest";
import {
  codeBlockNewline,
  enterKey,
  enterPolicy,
  fenceSelection,
  indentCodeBlock,
  newline,
  outdentCodeBlock,
  selectAll,
  shiftTabInList,
  tabInList,
  toggleEmphasis,
  toggleInlineCode,
  toggleStrong,
} from "./keys.ts";
import { serializeMarkdown } from "./markdown.ts";
import { richSchema, schemaNode } from "./schema.ts";

const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const codeBlock = (text: string) => schemaNode(richSchema, "code_block").create(null, text ? richSchema.text(text) : undefined);
const listItem = (...content: Node[]) => schemaNode(richSchema, "list_item").create(null, content);
const bulletList = (...items: Node[]) => schemaNode(richSchema, "bullet_list").create(null, items);

/** A state with its cursor at `from`, or at the end of the document when no position is given. */
function stateAt(doc: Node, from?: number, to = from): EditorState {
  const base = EditorState.create({ doc });
  const selection = from === undefined ? TextSelection.atEnd(base.doc) : TextSelection.create(base.doc, from, to);
  return base.apply(base.tr.setSelection(selection));
}

/** Runs a command and returns whether it applied and the state it produced. */
function run(state: EditorState, command: Command): { ok: boolean; state: EditorState } {
  let next = state;
  const ok = command(state, (transaction) => {
    next = state.apply(transaction);
  });
  return { ok, state: next };
}

/** Every text run and the marks it carries, for asserting what a command produced. */
function inlineShape(doc: Node): { text: string; marks: string[] }[] {
  const shape: { text: string; marks: string[] }[] = [];
  doc.descendants((node) => {
    if (node.isText) shape.push({ text: node.text ?? "", marks: node.marks.map((mark) => mark.type.name).sort() });
  });
  return shape;
}

test("Enter means send in prose", () => {
  const state = stateAt(docOf(paragraph(richSchema.text("hello"))));
  assert.equal(enterPolicy(state), "send");
  assert.equal(run(state, enterKey).ok, false, "the editor does not edit on Enter in prose");
  assert.equal(run(state, enterKey).state.doc.textContent, "hello");
});

test("Enter splits a non-empty list item", () => {
  const doc = docOf(bulletList(listItem(paragraph(richSchema.text("one")))));
  const state = stateAt(doc);
  assert.equal(enterPolicy(state), "split-item");
  assert.equal(run(state, enterKey).ok, true);
  const list = run(state, enterKey).state.doc.firstChild;
  assert.equal(list?.childCount, 2, "the item was split in two");
  assert.equal(run(state, enterKey).state.doc.textContent, "one");
});

test("Enter ends the list on an empty item", () => {
  const doc = docOf(bulletList(listItem(paragraph(richSchema.text("one"))), listItem(paragraph())));
  const state = stateAt(doc);
  assert.equal(enterPolicy(state), "exit-item");
  const result = run(state, enterKey);
  assert.equal(result.ok, true);
  assert.equal(result.state.doc.childCount, 2, "the empty item left the list as its own paragraph");
  assert.equal(result.state.doc.firstChild?.type.name, "bullet_list");
  assert.equal(result.state.doc.lastChild?.type.name, "paragraph");
});

test("Enter inserts a newline in a code block", () => {
  const state = stateAt(docOf(codeBlock("let a = 1;")));
  assert.equal(enterPolicy(state), "newline");
  const result = run(state, enterKey);
  assert.equal(result.ok, true);
  assert.equal(result.state.doc.textContent, "let a = 1;\n");
  assert.equal(newline(state, undefined), false, "a hard break is not valid code-block content");
});

test("Shift+Enter always hard-breaks, in prose and in a code block", () => {
  const prose = stateAt(docOf(paragraph(richSchema.text("a"))));
  assert.equal(enterPolicy(prose, true), "hard-break");
  const broken = run(prose, newline);
  assert.equal(broken.ok, true);
  assert.equal(broken.state.doc.childCount, 1, "the hard break stays inside the paragraph");
  assert.equal(broken.state.doc.firstChild?.childCount, 2);
  assert.equal(broken.state.doc.firstChild?.lastChild?.type.name, "hard_break");
  const code = stateAt(docOf(codeBlock("a")));
  const result = run(code, codeBlockNewline);
  assert.equal(result.ok, true);
  assert.equal(result.state.doc.textContent, "a\n");
});

test("Tab sinks a list item and Shift+Tab lifts it, and both leave a non-list alone", () => {
  const doc = docOf(bulletList(listItem(paragraph(richSchema.text("one"))), listItem(paragraph(richSchema.text("two")))));
  const state = stateAt(doc);
  assert.equal(run(state, tabInList).ok, true);
  const sunk = run(state, tabInList).state.doc;
  assert.equal(sunk.firstChild?.firstChild?.childCount, 2, "the second item became a nested list");
  assert.equal(sunk.textContent, "onetwo");
  const lifted = run(run(state, tabInList).state, shiftTabInList);
  assert.equal(lifted.ok, true);
  assert.equal(lifted.state.doc.firstChild?.childCount, 2, "the item is a sibling again");
  const plain = stateAt(docOf(paragraph(richSchema.text("plain"))));
  assert.equal(run(plain, tabInList).ok, false, "Tab reports false outside a list, so focus leaves");
  assert.equal(run(plain, shiftTabInList).ok, false);
});

test("Tab indents a code block by two spaces and Shift+Tab removes them", () => {
  const state = stateAt(docOf(codeBlock("let a = 1;")));
  const indented = run(state, indentCodeBlock);
  assert.equal(indented.ok, true);
  assert.equal(indented.state.doc.textContent, "let a = 1;  ");
  const outdented = run(indented.state, outdentCodeBlock);
  assert.equal(outdented.ok, true);
  assert.equal(outdented.state.doc.textContent, "let a = 1;");
  assert.equal(run(stateAt(docOf(paragraph(richSchema.text("a")))), indentCodeBlock).ok, false);
});

test("Mod-b, Mod-i and Mod-e toggle their marks", () => {
  const state = stateAt(docOf(paragraph(richSchema.text("ab"))), 1, 3);
  const cases: readonly [command: Command, mark: string][] = [
    [toggleStrong, "strong"],
    [toggleEmphasis, "em"],
    [toggleInlineCode, "code"],
  ];
  for (const [command, mark] of cases) {
    const result = run(state, command);
    assert.equal(result.ok, true, mark);
    assert.deepEqual(inlineShape(result.state.doc), [{ text: "ab", marks: [mark] }], mark);
    const off = run(result.state, command);
    assert.deepEqual(inlineShape(off.state.doc), [{ text: "ab", marks: [] }], `${mark} toggles off`);
  }
});

test("Mod-Shift-E fences the selection and unfences a code block", () => {
  const state = stateAt(docOf(paragraph(richSchema.text("let a = 1;"))));
  const fenced = run(state, fenceSelection);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.state.doc.firstChild?.type.name, "code_block");
  assert.equal(fenced.state.doc.textContent, "let a = 1;");
  const unfenced = run(fenced.state, fenceSelection);
  assert.equal(unfenced.ok, true);
  assert.equal(unfenced.state.doc.firstChild?.type.name, "paragraph");
  assert.equal(unfenced.state.doc.textContent, "let a = 1;");
});

test("what the keys produce is the Markdown the wire carries", () => {
  const list = (...texts: string[]) => docOf(bulletList(...texts.map((text) => listItem(paragraph(richSchema.text(text))))));
  const enter = (doc: Node) => run(stateAt(doc), enterKey).state.doc;
  assert.equal(serializeMarkdown(enter(list("one"))), "- one\n- ", "splitting ends in an empty item");
  assert.equal(serializeMarkdown(enter(list("one", "two"))), "- one\n- two\n- ", "splitting the last item adds an empty one");
  const ended = enter(docOf(bulletList(listItem(paragraph(richSchema.text("one"))), listItem(paragraph()))));
  assert.equal(ended.lastChild?.type.name, "paragraph", "the empty item left the list");
  // An empty paragraph has no Markdown spelling, so the list is all a draft that ended a list sends.
  assert.equal(serializeMarkdown(ended), "- one");
  const sunk = run(stateAt(list("one", "two")), tabInList).state.doc;
  assert.equal(serializeMarkdown(sunk), "- one\n   - two", "Tab nests one level");
  assert.equal(serializeMarkdown(run(stateAt(sunk), shiftTabInList).state.doc), "- one\n- two", "Shift+Tab lifts it back");
  const broken = run(stateAt(docOf(paragraph(richSchema.text("ab"))), 2), newline).state.doc;
  assert.equal(serializeMarkdown(broken), "a\nb", "Shift+Enter is one newline");
  assert.equal(serializeMarkdown(run(stateAt(docOf(paragraph(richSchema.text("a")))), newline).state.doc), "a", "a break that ends a block is not written");
  assert.equal(serializeMarkdown(enter(docOf(codeBlock("let a = 1;")))), "```\nlet a = 1;\n```", "Enter in a fence is a line in the code");
  assert.equal(serializeMarkdown(run(stateAt(docOf(codeBlock("let a = 1;")), 1), indentCodeBlock).state.doc), "```\n  let a = 1;\n```");
  assert.equal(serializeMarkdown(run(stateAt(docOf(codeBlock("  let a = 1;")), 3), outdentCodeBlock).state.doc), "```\nlet a = 1;\n```");
  const selected = stateAt(docOf(paragraph(richSchema.text("ab"))), 1, 3);
  for (const [command, markdown] of [[toggleStrong, "**ab**"], [toggleEmphasis, "*ab*"], [toggleInlineCode, "`ab`"]] as const) {
    assert.equal(serializeMarkdown(run(selected, command).state.doc), markdown);
  }
});

test("select all, undo and redo act on the document", () => {
  const base = EditorState.create({ doc: docOf(paragraph(richSchema.text("abc"))), plugins: [history()] });
  const all = run(base, selectAll);
  assert.equal(all.ok, true);
  assert.deepEqual([all.state.selection.from, all.state.selection.to], [0, 5]);
  const typed = base.apply(base.tr.insertText("x", 1));
  const undone = run(typed, undo);
  assert.equal(undone.ok, true);
  assert.equal(undone.state.doc.textContent, "abc");
  const redone = run(undone.state, redo);
  assert.equal(redone.ok, true);
  assert.equal(redone.state.doc.textContent, "xabc");
});
