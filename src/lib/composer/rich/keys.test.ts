/**
 * The composer's keys: what Enter means in prose, a list item and a code block, that a paragraph holding only a fence
 * opens a code block with its language on Enter, that ArrowDown at a fence's end and Enter on a closing fence line leave
 * it where a paragraph can follow, that Shift+Enter always hard-breaks, that Tab and Shift+Tab leave the editor alone
 * outside a list, and that the formatting chords, undo, redo and select-all act on the document. The Enter policy itself
 * is documented in `keys.ts`.
 */
import assert from "node:assert/strict";
import { chainCommands } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { test } from "vitest";
import {
  closeCodeFence,
  codeBlockNewline,
  enterKey,
  enterPolicy,
  exitCodeBlockDown,
  fenceSelection,
  indentCodeBlock,
  newline,
  openCodeFence,
  outdentCodeBlock,
  selectAll,
  shiftTabInList,
  tabInList,
  toggleEmphasis,
  toggleInlineCode,
  toggleStrong,
} from "./keys.ts";
import { serializeMarkdown } from "./markdown.ts";
import { richSchema, schemaMark, schemaNode } from "./schema.ts";

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

/** The position at the end of the first code block's content, where a fence can be left from. */
function endOfCodeBlock(doc: Node): number {
  let end = -1;
  doc.descendants((node, position) => {
    if (end >= 0) return false;
    if (node.type !== richSchema.nodes.code_block) return true;
    end = position + 1 + node.content.size;
    return false;
  });
  if (end < 0) throw new RangeError("The document holds no code block.");
  return end;
}

/** Types `text` one character at a time, each an ordinary edit of its own, the way the view's typing arrives. */
function typed(state: EditorState, text: string): EditorState {
  let next = state;
  for (const character of text) next = next.apply(next.tr.insertText(character, next.selection.from));
  return next;
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

test("Enter on a fence opens a code block carrying its language", () => {
  for (const [source, language] of [["```", ""], ["``` ", ""], ["```ts", "ts"]] as const) {
    const state = stateAt(docOf(paragraph(richSchema.text(source))));
    const result = run(state, openCodeFence);
    assert.equal(result.ok, true, source);
    const block = result.state.doc.firstChild;
    assert.equal(block?.type.name, "code_block", source);
    assert.equal(block?.attrs["language"], language, source);
    assert.equal(block?.content.size, 0, `${source} opens an empty block`);
    assert.equal(result.state.doc.textContent, "", `${source} keeps no marker`);
    assert.deepEqual([result.state.selection.from, result.state.selection.to], [1, 1], `${source} puts the caret inside the block`);
    assert.equal(result.state.selection.$from.parent.type.name, "code_block", source);
  }
});

test("Enter opens no fence that is not a paragraph's whole text", () => {
  const code = schemaMark(richSchema, "code").create();
  const fenced = docOf(paragraph(richSchema.text("```")));
  // The paragraph's text alone reads as the fence, but the hard break makes it more than the markers.
  const broken = stateAt(docOf(paragraph(richSchema.text("```"), schemaNode(richSchema, "hard_break").create())));
  // A pending code mark makes the next character code, as the input rule reads `state.storedMarks` too.
  const pending = EditorState.create({ doc: fenced, selection: TextSelection.atEnd(fenced), storedMarks: [code] });
  const cases: readonly [label: string, state: EditorState][] = [
    ["mid-paragraph", stateAt(docOf(paragraph(richSchema.text("a```"))))],
    ["in a heading", stateAt(docOf(schemaNode(richSchema, "heading").create({ level: 2 }, richSchema.text("```"))))],
    ["inside a code mark", stateAt(docOf(paragraph(richSchema.text("```", [code]))))],
    ["inside a code block", stateAt(docOf(codeBlock("```")))],
    ["with the caret before the paragraph's end", stateAt(docOf(paragraph(richSchema.text("```"))), 1)],
    ["with a selection", stateAt(docOf(paragraph(richSchema.text("```"))), 1, 4)],
    ["with text after the fence", stateAt(docOf(paragraph(richSchema.text("``` more"))))],
    ["with a hard break after the fence", broken],
    ["under a pending code mark", pending],
  ];
  for (const [label, state] of cases) {
    assert.equal(openCodeFence(state, () => assert.fail(`${label} dispatched`)), false, label);
  }
  assert.equal(broken.doc.firstChild?.childCount, 2, "the break is a second child of the fence's paragraph");
  assert.equal(broken.doc.firstChild?.textContent, "```", "and its text alone would have read as the fence");
  assert.notEqual(pending.storedMarks, null, "the code mark is pending where the paragraph is fenced");

  // A list item's first paragraph cannot become a code block, so the markers stay text and Enter splits the item.
  const item = docOf(bulletList(listItem(paragraph(richSchema.text("```")))));
  const inItem = stateAt(item);
  assert.equal(openCodeFence(inItem, () => assert.fail("a list item's fence dispatched")), false, "a list item's first paragraph stays one");
  const split = run(inItem, enterKey);
  assert.equal(split.ok, true);
  assert.equal(split.state.doc.firstChild?.childCount, 2, "the item was split as any other list item");
  const first = split.state.doc.firstChild?.firstChild;
  assert.equal(first?.type.name, "list_item");
  assert.equal(first?.firstChild?.type.name, "paragraph", "the fence stays the paragraph it was");
  assert.equal(first?.firstChild?.textContent, "```", "the fence text survives");
  assert.equal(serializeMarkdown(split.state.doc), "- \\`\\`\\`\n- ", "the draft writes the markers as literal text");
});

test("one undo restores the typed fence, and the next removes it", () => {
  const base = EditorState.create({ doc: docOf(paragraph()), plugins: [history()] });
  const fence = typed(base, "```ts");
  assert.deepEqual(inlineShape(fence.doc), [{ text: "```ts", marks: [] }], "the fence is typed as text");
  const opened = run(fence, openCodeFence);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.doc.firstChild?.type.name, "code_block", "the conversion is the block the draft shows");
  const once = run(opened.state, undo);
  assert.equal(once.ok, true);
  assert.deepEqual(inlineShape(once.state.doc), [{ text: "```ts", marks: [] }], "one undo brings the markers back byte for byte");
  const twice = run(once.state, undo);
  assert.equal(twice.ok, true);
  assert.equal(twice.state.doc.textContent, "", "the typing before the fence is undone next");
});

test("ArrowDown at a fence's end leaves it for the paragraph after", () => {
  const withFollowing = docOf(paragraph(richSchema.text("before")), codeBlock("let a = 1;"), paragraph(richSchema.text("after")));
  const moved = run(stateAt(withFollowing, endOfCodeBlock(withFollowing)), exitCodeBlockDown);
  assert.equal(moved.ok, true);
  assert.equal(moved.state.doc.childCount, 3, "the paragraph after the block was already there");
  assert.equal(moved.state.selection.$from.parent.textContent, "after");
  assert.equal(moved.state.selection.$from.parentOffset, 0, "the caret is at that paragraph's start");

  for (const last of [codeBlock("let a = 1;"), codeBlock("")]) {
    const doc = docOf(last);
    const created = run(stateAt(doc, endOfCodeBlock(doc)), exitCodeBlockDown);
    assert.equal(created.ok, true);
    assert.equal(created.state.doc.childCount, 2, "a paragraph was added after the block");
    assert.equal(created.state.doc.lastChild?.type.name, "paragraph");
    assert.equal(created.state.doc.lastChild?.content.size, 0);
    assert.equal(created.state.selection.$from.parent, created.state.doc.lastChild, "the caret sits in the new paragraph");
    assert.equal(created.state.selection.$from.parentOffset, 0);
  }

  const midBlock = docOf(codeBlock("let a = 1;"));
  const midState = stateAt(midBlock, 3);
  const stayed = run(midState, exitCodeBlockDown);
  assert.equal(stayed.ok, false, "mid-block the arrow still moves the caret");
  assert.equal(stayed.state, midState, "nothing was dispatched");

  // A heading after the block is no paragraph to leave it for, so the caret stays and nothing is added around it.
  const beforeHeading = docOf(codeBlock("x"), schemaNode(richSchema, "heading").create({ level: 2 }, richSchema.text("next")));
  const endOfBlock = endOfCodeBlock(beforeHeading);
  const noExitState = stateAt(beforeHeading, endOfBlock);
  const noExit = run(noExitState, exitCodeBlockDown);
  assert.equal(noExit.ok, false, "a heading after the block is no exit");
  assert.equal(noExit.state, noExitState, "nothing was dispatched");
  assert.equal(noExit.state.doc.childCount, 2, "nothing was added or removed around the block");
  assert.equal(noExit.state.doc.lastChild?.type.name, "heading");
  assert.deepEqual([noExit.state.selection.from, noExit.state.selection.to], [endOfBlock, endOfBlock], "the caret stayed put");

  const prose = docOf(paragraph(richSchema.text("plain")));
  assert.equal(run(stateAt(prose), exitCodeBlockDown).ok, false, "there is no fence to leave");
});

test("Enter on a closing fence line leaves the block", () => {
  const closing = docOf(codeBlock("let a = 1;\n```"));
  const left = run(stateAt(closing, endOfCodeBlock(closing)), enterKey);
  assert.equal(left.ok, true);
  assert.equal(left.state.doc.firstChild?.type.name, "code_block");
  assert.equal(left.state.doc.firstChild?.textContent, "let a = 1;", "the closing line and the newline before it are gone");
  assert.equal(left.state.doc.childCount, 2, "the caret left the block for the paragraph after it");
  assert.equal(left.state.doc.lastChild?.type.name, "paragraph");
  assert.equal(left.state.selection.$from.parent.textContent, "");
  assert.equal(left.state.selection.$from.parentOffset, 0);

  const bare = docOf(codeBlock("```"));
  const emptied = run(stateAt(bare, endOfCodeBlock(bare)), enterKey);
  assert.equal(emptied.ok, true);
  assert.equal(emptied.state.doc.childCount, 1, "a block holding only the fence becomes the paragraph");
  assert.equal(emptied.state.doc.firstChild?.type.name, "paragraph");
  assert.equal(emptied.state.doc.firstChild?.content.size, 0);
  assert.deepEqual([emptied.state.selection.from, emptied.state.selection.to], [1, 1], "the caret is inside that paragraph");

  const inside = docOf(codeBlock("```\nx"));
  const newlineInside = run(stateAt(inside, endOfCodeBlock(inside) - 2), enterKey);
  assert.equal(newlineInside.ok, true);
  assert.equal(newlineInside.state.doc.childCount, 1, "a fence line with lines after it is an ordinary newline");
  assert.equal(newlineInside.state.doc.textContent, "```\n\nx");

  const lastLine = docOf(codeBlock("let a = 1;\nafter"));
  const textLine = run(stateAt(lastLine, endOfCodeBlock(lastLine)), enterKey);
  assert.equal(textLine.state.doc.childCount, 1, "a last line that is not a fence is an ordinary newline");
  assert.equal(textLine.state.doc.textContent, "let a = 1;\nafter\n");
});

test("Enter on a closing fence line adds a line when no paragraph can follow", () => {
  const doc = docOf(codeBlock("a\n```"), schemaNode(richSchema, "heading").create({ level: 2 }, richSchema.text("next")));
  const state = stateAt(doc, endOfCodeBlock(doc));
  assert.equal(closeCodeFence(state, () => assert.fail("a fence with no exit dispatched")), false, "a heading after the block is no exit");
  const result = run(state, enterKey);
  assert.equal(result.ok, true);
  assert.equal(result.state.doc.childCount, 2, "nothing was added or removed around the block");
  assert.equal(result.state.doc.firstChild?.type.name, "code_block");
  assert.equal(result.state.doc.firstChild?.textContent, "a\n```\n", "the closing line stays and Enter adds a line after it");
  assert.equal(result.state.doc.lastChild?.type.name, "heading");
  assert.equal(result.state.selection.$from.parent.type.name, "code_block", "the caret stays inside the block");
  assert.equal(result.state.selection.$from.parentOffset, result.state.selection.$from.parent.content.size);
});

test("Shift+Enter keeps a newline on a closing fence line", () => {
  // The view binds Shift+Enter to this chain, never to Enter's edit: a hard break in code is one newline.
  const shiftEnter: Command = chainCommands(codeBlockNewline, newline);
  const closing = docOf(codeBlock("let a = 1;\n```"));
  const broken = run(stateAt(closing, endOfCodeBlock(closing)), shiftEnter);
  assert.equal(broken.ok, true);
  assert.equal(broken.state.doc.childCount, 1, "no paragraph follows a Shift+Enter");
  assert.equal(broken.state.doc.textContent, "let a = 1;\n```\n");
  assert.equal(closeCodeFence(stateAt(closing, endOfCodeBlock(closing)), undefined), true, "Enter itself would have closed it");
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
  const opened = run(stateAt(docOf(paragraph(richSchema.text("```")))), openCodeFence).state;
  assert.equal(serializeMarkdown(opened.doc), "```\n```", "an empty fence opens a code block with no line in it");
  assert.equal(serializeMarkdown(run(stateAt(docOf(paragraph(richSchema.text("```ts")))), openCodeFence).state.doc), "```ts\n```", "the language follows the fence");
  const written = opened.apply(opened.tr.insertText("x", opened.selection.from));
  const left = run(written, exitCodeBlockDown);
  assert.equal(left.ok, true);
  const after = left.state.apply(left.state.tr.insertText("after", left.state.selection.from));
  assert.equal(serializeMarkdown(after.doc), "```\nx\n```\n\nafter", "a block followed by a paragraph is its fence and a blank line");
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
