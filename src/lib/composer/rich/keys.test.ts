/**
 * The composer's keys: what Enter means in prose, a list item, a code block, a quote, a note and a heading, that a
 * paragraph holding only a fence opens a code block with its language on Enter and one holding only a note marker opens
 * that note, that Enter adds a line inside a quote, a note and a heading and never sends there, that Backspace on the
 * empty last line that gesture leaves is the way out of a quote, a note and a fence, that Backspace at the start of an
 * empty quote, note or heading makes it prose, that ArrowDown at a fence's end and Enter on a closing fence line leave it
 * where a paragraph can follow, that Shift+Enter always hard-breaks, that Tab and Shift+Tab leave the editor alone
 * outside a list, that one undo takes every exit back, and that the formatting chords, undo, redo and select-all act on
 * the document. The Enter policy itself is documented in `keys.ts`.
 */
import assert from "node:assert/strict";
import { chainCommands } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { test } from "vitest";
import {
  blockKindOf,
  closeCodeFence,
  codeBlockNewline,
  enterKey,
  enterPolicy,
  exitBlockBackward,
  exitCodeBlockDown,
  exitEmptyLineBackward,
  fenceSelection,
  formatState,
  indentCodeBlock,
  makeNote,
  markActive,
  newline,
  openCodeFence,
  openNote,
  outdentCodeBlock,
  selectAll,
  shiftTabInList,
  tabInList,
  toggleBulletList,
  toggleCodeBlock,
  toggleEmphasis,
  toggleInlineCode,
  toggleQuote,
  toggleStrike,
  toggleStrong,
  toPlainParagraph,
} from "./keys.ts";
import { serializeMarkdown } from "./markdown.ts";
import { richSchema, schemaMark, schemaNode } from "./schema.ts";

const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const codeBlock = (text: string) => schemaNode(richSchema, "code_block").create(null, text ? richSchema.text(text) : undefined);
const listItem = (...content: Node[]) => schemaNode(richSchema, "list_item").create(null, content);
const bulletList = (...items: Node[]) => schemaNode(richSchema, "bullet_list").create(null, items);
const blockquote = (...content: Node[]) => schemaNode(richSchema, "blockquote").create(null, content);
const note = (kind: string, ...content: Node[]) => schemaNode(richSchema, "note").create({ kind }, content);
const heading = (level: number, ...content: Node[]) => schemaNode(richSchema, "heading").create({ level }, content);

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

/** The position where the document's `index`th textblock starts, in document order, however deeply a container wraps it. */
function startOfBlock(doc: Node, index: number): number {
  const starts: number[] = [];
  doc.descendants((node, position) => {
    if (node.isTextblock) starts.push(position + 1);
    return true;
  });
  const start = starts[index];
  if (start === undefined) throw new RangeError(`The document holds no textblock ${index}.`);
  return start;
}

/** The position where the document's first textblock starts, however deeply a container wraps it. */
function startOfFirstBlock(doc: Node): number {
  return startOfBlock(doc, 0);
}

/** The position at the end of the document's first textblock, however deeply a container wraps it. */
function endOfFirstBlock(doc: Node): number {
  let end = -1;
  doc.descendants((node, position) => {
    if (end >= 0) return false;
    if (!node.isTextblock) return true;
    end = position + 1 + node.content.size;
    return false;
  });
  if (end < 0) throw new RangeError("The document holds no textblock.");
  return end;
}

/** The position at the end of the document's last textblock, however deeply a container wraps it. */
function endOfLastBlock(doc: Node): number {
  let end = -1;
  doc.descendants((node, position) => {
    if (node.isTextblock) end = position + 1 + node.content.size;
    return true;
  });
  if (end < 0) throw new RangeError("The document holds no textblock.");
  return end;
}

/** Types `text` one character at a time, each an ordinary edit of its own, the way the view's typing arrives. */
function typed(state: EditorState, text: string): EditorState {
  let next = state;
  for (const character of text) next = next.apply(next.tr.insertText(character, next.selection.from));
  return next;
}

/**
 * The document's shape, one line per block: a container by its name with its children indented below it, a textblock by
 * its name and its text, and every empty block included. It is what says an empty line came back, since the wire drops a
 * trailing one.
 */
function shapeOf(node: Node, indent = ""): string[] {
  const shape: string[] = [];
  node.forEach((child) => {
    if (!child.isTextblock) {
      shape.push(`${indent}${child.type.name}`, ...shapeOf(child, `${indent}  `));
      return;
    }
    shape.push(`${indent}${child.type.name}(${child.textContent.replaceAll("\n", "\\n")})`);
  });
  return shape;
}

/** The view's Backspace chain: the empty line's exit first, then the empty block's. */
const backspace = chainCommands(exitEmptyLineBackward, exitBlockBackward);

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

test("Enter in a quote adds a line, and Backspace on the empty one leaves it", () => {
  // `> ` and the space that opens the quote: the rule converts it, and the caret sits in the quote's empty paragraph.
  const opened = stateAt(docOf(blockquote(paragraph())));
  assert.deepEqual(shapeOf(opened.doc), ["blockquote", "  paragraph()"]);
  assert.equal(serializeMarkdown(opened.doc), "> ", "the quote is the whole draft");

  const annotation = typed(opened, "hello");
  assert.deepEqual(shapeOf(annotation.doc), ["blockquote", "  paragraph(hello)"]);
  assert.equal(enterPolicy(annotation), "block", "Enter inside a quote is an edit, so the caller never sends");

  // Enter adds a line inside the quote rather than leaving it, and the caret sits in that line.
  const one = run(annotation, enterKey);
  assert.equal(one.ok, true);
  assert.deepEqual(shapeOf(one.state.doc), ["blockquote", "  paragraph(hello)", "  paragraph()"]);
  assert.equal(one.state.selection.$from.parent, one.state.doc.firstChild?.lastChild, "the caret is in the new line");
  assert.equal(one.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(one.state.doc), "> hello", "an empty line inside the quote writes no line");

  // A second Enter adds the third line the gesture leaves: nothing is ever added outside the quote.
  const two = run(one.state, enterKey);
  assert.equal(two.ok, true);
  assert.deepEqual(shapeOf(two.state.doc), ["blockquote", "  paragraph(hello)", "  paragraph()", "  paragraph()"]);
  assert.equal(serializeMarkdown(two.state.doc), "> hello");

  // Backspace on that empty line is the way out: the empty lines go and a plain paragraph takes the caret below.
  const left = run(two.state, backspace);
  assert.equal(left.ok, true);
  assert.deepEqual(shapeOf(left.state.doc), ["blockquote", "  paragraph(hello)", "paragraph()"]);
  assert.equal(left.state.selection.$from.parent, left.state.doc.lastChild, "the caret is in the paragraph below");
  assert.equal(left.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(left.state.selection.$from.depth, 1, "outside the quote");
  assert.equal(serializeMarkdown(left.state.doc), "> hello", "the quote keeps its text, and its wire");

  // In the middle the quote still splits where the caret is, and nothing is added around it.
  const quoted = docOf(blockquote(paragraph(richSchema.text("quote"))));
  const middle = run(stateAt(quoted, startOfFirstBlock(quoted) + 3), enterKey);
  assert.equal(middle.ok, true);
  assert.equal(middle.state.doc.childCount, 1, "nothing was added outside the quote");
  const inside = middle.state.doc.firstChild;
  assert.equal(inside?.type.name, "blockquote");
  assert.equal(inside?.childCount, 2, "the paragraph split inside the quote");
  assert.deepEqual([inside?.firstChild?.textContent, inside?.lastChild?.textContent], ["quo", "te"]);
  assert.equal(middle.state.selection.$from.parent, inside?.lastChild, "the caret is in the second paragraph");
  assert.equal(middle.state.selection.$from.parentOffset, 0);
  assert.equal(serializeMarkdown(middle.state.doc), "> quo\n>\n> te", "the quote writes both paragraphs");

  // Nowhere for a plain paragraph to follow, the empty line stays: the key deletes instead of ejecting.
  const blockedDoc = docOf(blockquote(paragraph(richSchema.text("quote")), paragraph()), heading(2, richSchema.text("next")));
  const blocked = stateAt(blockedDoc, startOfBlock(blockedDoc, 1));
  assert.equal(exitEmptyLineBackward(blocked, () => assert.fail("a quote before a heading dispatched")), false, "a heading after the quote is no exit");
});

test("Enter in a heading edits the block instead of sending", () => {
  const headed = docOf(heading(2, richSchema.text("head")));
  assert.equal(enterPolicy(stateAt(headed)), "block", "Enter inside a heading is an edit, so the caller never sends");

  const end = run(stateAt(headed), enterKey);
  assert.equal(end.ok, true);
  assert.equal(end.state.doc.childCount, 2, "a paragraph follows the heading");
  assert.equal(end.state.doc.firstChild?.type.name, "heading");
  assert.equal(end.state.doc.firstChild?.attrs["level"], 2, "the heading keeps its level");
  assert.equal(end.state.doc.lastChild?.type.name, "paragraph");
  assert.equal(end.state.selection.$from.parent, end.state.doc.lastChild, "the caret is in the paragraph after it");
  assert.equal(end.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(end.state.doc), "## head");

  // In the middle the heading splits into two headings of its own level, and nothing appears outside.
  const middle = run(stateAt(headed, startOfFirstBlock(headed) + 2), enterKey);
  assert.equal(middle.ok, true);
  assert.equal(middle.state.doc.childCount, 2, "the heading split in two and nothing was added around it");
  const halves = [middle.state.doc.firstChild, middle.state.doc.lastChild];
  assert.deepEqual(halves.map((half) => half?.type.name), ["heading", "heading"]);
  assert.deepEqual(halves.map((half) => half?.attrs["level"]), [2, 2], "both halves stay headings of the same level");
  assert.deepEqual(halves.map((half) => half?.textContent), ["he", "ad"]);
  assert.equal(middle.state.selection.$from.parent, halves[1], "the caret is in the second heading");
  assert.equal(middle.state.selection.$from.parentOffset, 0);
  assert.equal(serializeMarkdown(middle.state.doc), "## he\n\n## ad");

  // An empty heading splits too: Enter adds the line its own split puts below it.
  const emptied = run(stateAt(docOf(heading(1))), enterKey);
  assert.equal(emptied.ok, true);
  assert.deepEqual(shapeOf(emptied.state.doc), ["heading()", "paragraph()"]);
  assert.equal(emptied.state.doc.firstChild?.type.name, "heading", "the heading stays where it was");
  assert.equal(emptied.state.selection.$from.parent, emptied.state.doc.lastChild, "the caret is in the paragraph below it");
  assert.equal(emptied.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(emptied.state.doc), "# ", "an empty heading writes its marker, and the paragraph below no line");
});

test("Backspace at the start of an empty quote or heading makes it a paragraph", () => {
  const quoted = docOf(blockquote(paragraph()));
  const lifted = run(stateAt(quoted), exitBlockBackward);
  assert.equal(lifted.ok, true);
  assert.equal(lifted.state.doc.childCount, 1, "the quote is gone and its paragraph took its place");
  assert.equal(lifted.state.doc.firstChild?.type.name, "paragraph");
  assert.equal(lifted.state.doc.firstChild?.content.size, 0, "the text is untouched");
  assert.deepEqual([lifted.state.selection.from, lifted.state.selection.to], [1, 1], "the caret is at its start");
  assert.equal(serializeMarkdown(lifted.state.doc), "", "a quote holding nothing writes nothing");

  const headed = docOf(heading(3));
  const plain = run(stateAt(headed), exitBlockBackward);
  assert.equal(plain.ok, true);
  assert.equal(plain.state.doc.childCount, 1);
  assert.equal(plain.state.doc.firstChild?.type.name, "paragraph");
  assert.deepEqual([plain.state.selection.from, plain.state.selection.to], [1, 1], "the caret is at its start");
  assert.equal(serializeMarkdown(plain.state.doc), "", "the heading marker is gone from the wire");

  // Typed text is never this key's: `false` lets `baseKeymap` delete a character as it always did.
  const written = docOf(blockquote(paragraph(richSchema.text("quote"))));
  const titled = docOf(heading(3, richSchema.text("head")));
  const several = docOf(blockquote(paragraph(richSchema.text("one")), paragraph(richSchema.text("two"))));
  const cases: readonly [label: string, state: EditorState][] = [
    ["a quote holding text", stateAt(written, startOfFirstBlock(written))],
    ["a heading holding text", stateAt(titled, startOfFirstBlock(titled))],
    ["mid-quote", stateAt(written, startOfFirstBlock(written) + 3)],
    ["a quote holding several blocks", stateAt(several, startOfFirstBlock(several))],
    ["a list item", stateAt(docOf(bulletList(listItem(paragraph(richSchema.text("one"))))), 3)],
    ["a fence", stateAt(docOf(codeBlock("x")), 1)],
    ["prose", stateAt(docOf(paragraph(richSchema.text("plain"))), 1)],
  ];
  for (const [label, state] of cases) {
    assert.equal(exitBlockBackward(state, () => assert.fail(`${label} dispatched`)), false, label);
  }
});

test("Enter in a code block adds a line, and Backspace on the empty one leaves it", () => {
  // ``` and Enter open the fence, the same gesture a quote starts with; the caret sits inside it with no text.
  const opened = stateAt(docOf(codeBlock("")));
  assert.deepEqual(shapeOf(opened.doc), ["code_block()"], "the fence starts empty");
  assert.equal(serializeMarkdown(opened.doc), "```\n```");

  const written = typed(opened, "hello");
  assert.deepEqual(shapeOf(written.doc), ["code_block(hello)"]);
  assert.equal(serializeMarkdown(written.doc), "```\nhello\n```");

  // Enter adds a newline, because a fence's lines are its content, and the caret stays in the block.
  const one = run(written, enterKey);
  assert.equal(one.ok, true);
  assert.deepEqual(shapeOf(one.state.doc), ["code_block(hello\\n)"]);
  assert.equal(one.state.selection.$from.parent.type.name, "code_block", "the caret stays in the fence");
  assert.equal(serializeMarkdown(one.state.doc), "```\nhello\n```", "the newline is the closing fence's line");

  // An empty last line takes another newline, and it is written as the blank line it is.
  const two = run(one.state, enterKey);
  assert.equal(two.ok, true);
  assert.deepEqual(shapeOf(two.state.doc), ["code_block(hello\\n\\n)"]);
  assert.equal(two.state.selection.$from.parent.type.name, "code_block", "the caret stays in the fence");
  assert.equal(serializeMarkdown(two.state.doc), "```\nhello\n\n```");

  // Backspace at the end of that empty line is the way out: the newlines go and a plain paragraph takes the caret.
  const left = run(two.state, backspace);
  assert.equal(left.ok, true);
  assert.deepEqual(shapeOf(left.state.doc), ["code_block(hello)", "paragraph()"]);
  assert.equal(left.state.selection.$from.parent, left.state.doc.lastChild, "the caret is in the paragraph below");
  assert.equal(left.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(left.state.doc), "```\nhello\n```", "the fence keeps its line and its closing fence");
});

test("Backspace never leaves a block by deleting typed text", () => {
  // A caret inside typed text is not the empty line: nothing is dispatched, so `baseKeymap` deletes a character.
  const written = docOf(blockquote(paragraph(richSchema.text("hello"))));
  const midText = stateAt(written, startOfFirstBlock(written) + 2);
  assert.equal(exitEmptyLineBackward(midText, () => assert.fail("a caret inside typed text dispatched")), false);
  assert.equal(backspace(midText, () => assert.fail("the chain dispatched inside typed text")), false);

  // A quote holding nothing but empty paragraphs is a join, never this exit: only an empty block is
  // `exitBlockBackward`'s, and a second empty paragraph is no block of that shape either.
  const empties = docOf(blockquote(paragraph(), paragraph()));
  const emptyLast = stateAt(empties, startOfBlock(empties, 1));
  assert.equal(exitEmptyLineBackward(emptyLast, () => assert.fail("an empty block dispatched")), false, "an empty line before only an empty line is no exit");
  assert.equal(backspace(emptyLast, () => assert.fail("the chain dispatched on an empty block")), false);

  // An empty line in the middle of a block stays a join, however much content surrounds it.
  const middleDoc = docOf(blockquote(paragraph(richSchema.text("hello")), paragraph(), paragraph(richSchema.text("after"))));
  const middleLine = stateAt(middleDoc, startOfBlock(middleDoc, 1));
  assert.equal(exitEmptyLineBackward(middleLine, () => assert.fail("a middle empty line dispatched")), false);
  assert.equal(backspace(middleLine, () => assert.fail("the chain dispatched on a middle empty line")), false);

  // A fence is only left by the newlines at its very end, with text before them.
  const fenceStart = stateAt(docOf(codeBlock("hello\nworld")), 1 + 5);
  assert.equal(exitEmptyLineBackward(fenceStart, () => assert.fail("a fence's middle dispatched")), false);
  const fenceOnlyNewlines = stateAt(docOf(codeBlock("\n")));
  assert.equal(exitEmptyLineBackward(fenceOnlyNewlines, () => assert.fail("a fence of newlines dispatched")), false, "nothing typed is nothing to keep");
});

test("one undo takes back each block an exit changed, and the wire with it", () => {
  const quoted = docOf(blockquote(paragraph(richSchema.text("quote"))));
  const headed = docOf(heading(1, richSchema.text("heading")));
  const noted = docOf(note("note", paragraph(richSchema.text("noted"))));
  const emptyQuote = docOf(blockquote(paragraph()), paragraph());
  const emptyHeading = docOf(heading(2), paragraph());
  const emptyNote = docOf(note("tip", paragraph()), paragraph());
  const linedQuote = docOf(blockquote(paragraph(richSchema.text("quote")), paragraph()), paragraph());
  const linedFence = docOf(codeBlock("let a = 1;\n"), paragraph());
  const cases: readonly [label: string, doc: Node, command: Command, caret?: number][] = [
    ["Enter at the end of a quote", quoted, enterKey],
    ["Enter at the end of a heading", headed, enterKey],
    ["Enter at the end of a note", noted, enterKey],
    ["Backspace at the start of an empty quote", emptyQuote, exitBlockBackward, startOfFirstBlock(emptyQuote)],
    ["Backspace at the start of an empty heading", emptyHeading, exitBlockBackward, startOfFirstBlock(emptyHeading)],
    ["Backspace at the start of an empty note", emptyNote, exitBlockBackward, startOfFirstBlock(emptyNote)],
    ["Backspace on a quote's empty last line", linedQuote, exitEmptyLineBackward, startOfBlock(linedQuote, 1)],
    ["Backspace on a fence's empty last line", linedFence, exitEmptyLineBackward, endOfCodeBlock(linedFence)],
  ];
  for (const [label, doc, command, caret] of cases) {
    const base = EditorState.create({ doc, selection: TextSelection.atEnd(doc), plugins: [history()] });
    // The typing the exit follows, one history event of its own, so a second undo would take it too.
    const typedBefore = typed(base, "x");
    const state = caret === undefined ? typedBefore : typedBefore.apply(typedBefore.tr.setSelection(TextSelection.create(typedBefore.doc, caret)));
    const before = { doc: state.doc, wire: serializeMarkdown(state.doc) };
    const exited = run(state, command);
    assert.equal(exited.ok, true, label);
    assert.equal(exited.state.doc.eq(before.doc), false, `${label} changed the document`);
    const once = run(exited.state, undo);
    assert.equal(once.ok, true, label);
    assert.equal(once.state.doc.eq(before.doc), true, `${label}: one undo restores the document`);
    assert.equal(serializeMarkdown(once.state.doc), before.wire, `${label}: and the wire it carried`);
    const twice = run(once.state, undo);
    assert.equal(twice.ok, true, label);
    assert.equal(twice.state.doc.eq(base.doc), true, `${label}: the typing before it is the undo after`);
  }
});

test("one undo brings back the block and the empty line the gesture left", () => {
  const cases: readonly [label: string, doc: Node][] = [
    ["a quote", docOf(blockquote(paragraph(richSchema.text("hello"))))],
    ["a note", docOf(note("tip", paragraph(richSchema.text("body"))))],
    ["a fence", docOf(codeBlock("hello"))],
  ];
  for (const [label, doc] of cases) {
    const base = EditorState.create({ doc, plugins: [history()] });
    const start = base.apply(base.tr.setSelection(TextSelection.atEnd(base.doc)));
    const first = run(start, enterKey);
    const second = run(first.state, enterKey);
    assert.equal(second.ok, true, label);
    const before = second.state.doc;
    const shape = shapeOf(before);
    const left = run(second.state, backspace);
    assert.equal(left.ok, true, label);
    assert.equal(left.state.doc.eq(before), false, `${label}: the empty line went`);
    const once = run(left.state, undo);
    assert.equal(once.ok, true, label);
    // A trailing empty line inside the block is dropped from the wire, so the document is what says it came back.
    assert.deepEqual(shapeOf(once.state.doc), shape, `${label}: one undo restores the block and its empty line`);
    assert.equal(once.state.doc.eq(before), true, label);
    assert.equal(serializeMarkdown(once.state.doc), serializeMarkdown(before), `${label}: and the wire it had`);
  }
});

test("Enter adds a line and never sends inside a quote, a note and a heading", () => {
  const cases: readonly [label: string, doc: Node, opened: string[]][] = [
    ["a quote", docOf(blockquote(paragraph(richSchema.text("quote")))), ["blockquote", "  paragraph(quote)", "  paragraph()"]],
    ["a note", docOf(note("tip", paragraph(richSchema.text("body")))), ["note", "  paragraph(body)", "  paragraph()"]],
    ["a heading", docOf(heading(2, richSchema.text("head"))), ["heading(head)", "paragraph()"]],
  ];
  for (const [label, doc, opened] of cases) {
    const state = stateAt(doc);
    assert.equal(enterPolicy(state), "block", `${label}: Enter is an edit, so the keymap's send branch is never taken`);
    assert.equal(enterKey(state, undefined, undefined), true, `${label}: Enter has an edit to make`);
    const result = run(state, enterKey);
    assert.equal(result.ok, true, label);
    assert.deepEqual(shapeOf(result.state.doc), opened, label);
    assert.equal(result.state.selection.empty, true, `${label}: the caret is still a caret`);
    assert.equal(result.state.selection.$from.parent.isTextblock, true, `${label}: inside a textblock`);
    assert.doesNotThrow(() => result.state.doc.resolve(result.state.selection.from), `${label}: the caret is in the document`);
  }
});

test("Enter on a note's marker opens that note", () => {
  const cases: readonly [marker: string, kind: string][] = [
    ["[!NOTE]", "note"],
    ["[!note]", "note"],
    ["[!Tip]", "tip"],
    ["[!IMPORTANT]", "important"],
    ["[!warning]", "warning"],
    ["[!CAUTION]", "caution"],
  ];
  for (const [marker, kind] of cases) {
    for (const space of ["", " "]) {
      const label = `> ${marker}${space}`;
      const doc = docOf(blockquote(paragraph(richSchema.text(`${marker}${space}`))));
      const result = run(stateAt(doc), openNote);
      assert.equal(result.ok, true, label);
      const block = result.state.doc.firstChild;
      assert.equal(block?.type.name, "note", label);
      assert.equal(block?.attrs["kind"], kind, label);
      assert.equal(block?.childCount, 1, label);
      assert.equal(block?.firstChild?.type.name, "paragraph", label);
      assert.equal(block?.firstChild?.content.size, 0, `${label}: the marker is gone`);
      assert.equal(result.state.doc.textContent, "", label);
      assert.equal(serializeMarkdown(result.state.doc), `> [!${kind.toUpperCase()}]`, `${label}: the wire is the marker alone`);
      assert.equal(result.state.selection.$from.parent, block?.firstChild, `${label}: the caret is in the note's paragraph`);
    }
  }
});

test("Enter opens no note that is not a quote's whole first paragraph", () => {
  const marker = richSchema.text("[!NOTE]");
  const quoted = docOf(blockquote(paragraph(marker)));
  const later = docOf(blockquote(paragraph(richSchema.text("one")), paragraph(marker)));
  const cases: readonly [label: string, state: EditorState][] = [
    ["with the caret before the paragraph's end", stateAt(quoted, startOfFirstBlock(quoted))],
    ["with a selection", stateAt(quoted, startOfFirstBlock(quoted), endOfFirstBlock(quoted))],
    ["with text before the marker", stateAt(docOf(blockquote(paragraph(richSchema.text("a [!NOTE]")))))],
    ["with text after the marker", stateAt(docOf(blockquote(paragraph(richSchema.text("[!NOTE] more")))))],
    ["in a later paragraph", stateAt(later, endOfLastBlock(later))],
    ["with a hard break after the marker", stateAt(docOf(blockquote(paragraph(marker, schemaNode(richSchema, "hard_break").create()))))],
    ["outside a quote", stateAt(docOf(paragraph(marker)))],
    ["inside a note instead of a quote", stateAt(docOf(note("note", paragraph(marker))))],
    ["with no marker", stateAt(docOf(blockquote(paragraph(richSchema.text("[!FOO]")))))],
  ];
  for (const [label, state] of cases) {
    assert.equal(openNote(state, () => assert.fail(`${label} dispatched`)), false, label);
  }
});

test("one undo restores the marker Enter converted, and the note writes that marker back", () => {
  const base = EditorState.create({ doc: docOf(blockquote(paragraph())), plugins: [history()] });
  const marked = typed(base, "[!NOTE]");
  const opened = run(marked, openNote);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.doc.firstChild?.type.name, "note", "the conversion is the note the draft shows");
  assert.equal(serializeMarkdown(opened.state.doc), "> [!NOTE]", "a note writes the marker it was opened from");
  const once = run(opened.state, undo);
  assert.equal(once.ok, true);
  assert.equal(once.state.doc.firstChild?.type.name, "blockquote", "one undo restores the quote");
  assert.deepEqual(inlineShape(once.state.doc), [{ text: "[!NOTE]", marks: [] }], "with the literal marker");
  // A quote whose decoded text is a marker is the one state the wire cannot spell: the transcript reads it as the
  // callout, so the serializer escapes it and it reads back as that note. The text the undo restored is kept displayable.
  assert.equal(serializeMarkdown(once.state.doc), "> \\[\\!NOTE\\]", "the marker text is escaped, never dropped");
  const twice = run(once.state, undo);
  assert.equal(twice.ok, true);
  assert.equal(twice.state.doc.textContent, "", "the marker typing is the undo after");
});

test("Enter in a note adds a line inside it", () => {
  const doc = docOf(note("tip", paragraph(richSchema.text("body"))));
  assert.equal(enterPolicy(stateAt(doc)), "block", "Enter inside a note is an edit, so the caller never sends");

  // The line Enter adds at the note's end is inside the note: nothing is added outside it.
  const end = run(stateAt(doc), enterKey);
  assert.equal(end.ok, true);
  assert.deepEqual(shapeOf(end.state.doc), ["note", "  paragraph(body)", "  paragraph()"]);
  assert.equal(end.state.doc.childCount, 1, "nothing was added outside the note");
  assert.equal(end.state.doc.firstChild?.attrs["kind"], "tip", "the note keeps its kind");
  assert.equal(end.state.selection.$from.parent, end.state.doc.firstChild?.lastChild, "the caret is in the new line");
  assert.equal(end.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(end.state.doc), "> [!TIP]\n> body", "an empty line inside the note writes no line");

  // In the middle the note splits where it is: a second paragraph inside it, and nothing around it.
  const middle = run(stateAt(doc, startOfFirstBlock(doc) + 2), enterKey);
  assert.equal(middle.ok, true);
  assert.equal(middle.state.doc.childCount, 1, "nothing was added outside the note");
  assert.equal(middle.state.doc.firstChild?.type.name, "note");
  assert.equal(middle.state.doc.firstChild?.childCount, 2, "the paragraph split inside the note");
  assert.deepEqual([middle.state.doc.firstChild?.firstChild?.textContent, middle.state.doc.firstChild?.lastChild?.textContent], ["bo", "dy"]);
  assert.equal(serializeMarkdown(middle.state.doc), "> [!TIP]\n> bo\n>\n> dy");
});

test("an empty note's Backspace returns its prose, and its empty last line leaves it", () => {
  const empty = docOf(note("warning", paragraph()));
  const lifted = run(stateAt(empty), exitBlockBackward);
  assert.equal(lifted.ok, true);
  assert.equal(lifted.state.doc.childCount, 1, "the note is gone and its paragraph took its place");
  assert.equal(lifted.state.doc.firstChild?.type.name, "paragraph");
  assert.deepEqual([lifted.state.selection.from, lifted.state.selection.to], [1, 1], "the caret is at its start");
  assert.equal(serializeMarkdown(lifted.state.doc), "", "the marker is gone from the wire");

  // A note holding typed text keeps its Backspace for that text, and a note holding several blocks keeps it too.
  const written = docOf(note("caution", paragraph(richSchema.text("careful"))));
  assert.equal(exitBlockBackward(stateAt(written, startOfFirstBlock(written)), () => assert.fail("a note holding text dispatched")), false);
  const several = docOf(note("note", paragraph(richSchema.text("one")), paragraph(richSchema.text("two"))));
  assert.equal(exitBlockBackward(stateAt(several, startOfFirstBlock(several)), () => assert.fail("a note holding several blocks dispatched")), false);

  // The empty line an Enter leaves is the way out, and the note keeps its marker and its body.
  const body = docOf(note("caution", paragraph(richSchema.text("body"))));
  const lined = run(run(stateAt(body), enterKey).state, enterKey);
  assert.deepEqual(shapeOf(lined.state.doc), ["note", "  paragraph(body)", "  paragraph()", "  paragraph()"]);
  const left = run(lined.state, backspace);
  assert.equal(left.ok, true);
  assert.deepEqual(shapeOf(left.state.doc), ["note", "  paragraph(body)", "paragraph()"]);
  assert.equal(left.state.selection.$from.parent, left.state.doc.lastChild, "the caret is in the paragraph below the note");
  assert.equal(left.state.selection.$from.parentOffset, 0, "at its start");
  assert.equal(serializeMarkdown(left.state.doc), "> [!CAUTION]\n> body", "the marker and the body stay, and the empty line writes nothing");
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

test("the strip's mark toggles and the state they report over a range and at a caret", () => {
  const selected = stateAt(docOf(paragraph(richSchema.text("ab"))), 1, 3);
  const cases = [
    [toggleStrong, "strong", "**ab**"],
    [toggleEmphasis, "em", "*ab*"],
    [toggleStrike, "s", "~~ab~~"],
    [toggleInlineCode, "code", "`ab`"],
  ] as const;
  for (const [command, mark, markdown] of cases) {
    const on = run(selected, command);
    assert.equal(on.ok, true, mark);
    assert.deepEqual(inlineShape(on.state.doc), [{ text: "ab", marks: [mark] }], `${mark} covers the selection`);
    assert.equal(serializeMarkdown(on.state.doc), markdown, `${mark} writes its Markdown`);
    assert.equal(markActive(selected, mark), false, `${mark} is not what the selection carried`);
    assert.equal(markActive(on.state, mark), true, `${mark} is what the whole selection carries now`);
    const off = run(on.state, command);
    assert.deepEqual(inlineShape(off.state.doc), [{ text: "ab", marks: [] }], `${mark} toggles off`);
  }

  // At a caret the mark is the one the next typed character would carry, which is what the button must show.
  const caret = stateAt(docOf(paragraph(richSchema.text("ab"))), 2);
  for (const [, mark] of cases) assert.equal(markActive(caret, mark), false, mark);
  const pending = run(caret, toggleStrong).state;
  assert.equal(markActive(pending, "strong"), true, "a caret toggled bold types bold");
  // Half a marked run is not the whole selection: the button offers to finish the job rather than claiming it is done.
  const strong = schemaMark(richSchema, "strong").create();
  const half = docOf(paragraph(richSchema.text("bo"), richSchema.text("ld", [strong])));
  assert.equal(markActive(stateAt(half, 1, 5), "strong"), false, "only half the range is bold");
  assert.equal(markActive(stateAt(half, 3, 5), "strong"), true, "a range wholly inside the mark is bold");
});

test("the strip's block actions change the blocks and their wire, and take them back", () => {
  const prose = () => stateAt(docOf(paragraph(richSchema.text("note this"))));

  const quoted = run(prose(), toggleQuote);
  assert.equal(quoted.ok, true);
  assert.equal(blockKindOf(quoted.state), "quote");
  assert.equal(serializeMarkdown(quoted.state.doc), "> note this", "Quote wraps the selection");
  const requoted = run(quoted.state, toggleQuote);
  assert.equal(requoted.ok, true);
  assert.equal(requoted.state.doc.firstChild?.type.name, "paragraph", "and presses again to take the quote away");
  assert.equal(serializeMarkdown(requoted.state.doc), "note this");

  const noted = run(run(prose(), toggleQuote).state, makeNote);
  assert.equal(noted.ok, true);
  assert.equal(noted.state.doc.firstChild?.type.name, "note", "Note turns the quote around the selection into the note");
  assert.equal(noted.state.doc.firstChild?.attrs["kind"], "note");
  assert.equal(serializeMarkdown(noted.state.doc), "> [!NOTE]\n> note this");
  assert.equal(blockKindOf(noted.state), "note");
  assert.equal(run(noted.state, makeNote).ok, false, "a note is what Text takes away, not a second note");

  const fromProse = run(prose(), makeNote);
  assert.equal(fromProse.ok, true);
  assert.equal(serializeMarkdown(fromProse.state.doc), "> [!NOTE]\n> note this", "a paragraph becomes a note's body");

  const itemised = run(prose(), toggleBulletList);
  assert.equal(itemised.ok, true);
  assert.equal(blockKindOf(itemised.state), "list");
  assert.equal(serializeMarkdown(itemised.state.doc), "- note this");
  const unlisted = run(itemised.state, toggleBulletList);
  assert.equal(unlisted.ok, true);
  assert.equal(unlisted.state.doc.firstChild?.type.name, "paragraph", "a second press takes the list away");
  assert.equal(serializeMarkdown(unlisted.state.doc), "note this");

  const fenced = run(prose(), toggleCodeBlock);
  assert.equal(fenced.ok, true);
  assert.equal(blockKindOf(fenced.state), "code");
  assert.equal(serializeMarkdown(fenced.state.doc), "```\nnote this\n```");
  const unfenced = run(fenced.state, toggleCodeBlock);
  assert.equal(unfenced.state.doc.firstChild?.type.name, "paragraph", "a second press unfences the block");

  const titled = stateAt(docOf(schemaNode(richSchema, "heading").create({ level: 2 }, richSchema.text("Title"))));
  assert.equal(blockKindOf(titled), "heading");
  const plain = run(titled, toPlainParagraph);
  assert.equal(plain.ok, true);
  assert.equal(plain.state.doc.firstChild?.type.name, "paragraph", "Text flattens a heading");
  assert.equal(serializeMarkdown(plain.state.doc), "Title");

  // Text is what takes every block away at once: the note goes, and the list inside it with it.
  const nested = stateAt(docOf(note("note", bulletList(listItem(paragraph(richSchema.text("item")))))));
  const flattened = run(nested, toPlainParagraph);
  assert.equal(flattened.ok, true);
  assert.equal(flattened.state.doc.firstChild?.type.name, "paragraph", "the note and the list are gone");
  assert.equal(serializeMarkdown(flattened.state.doc), "item");
  assert.equal(blockKindOf(flattened.state), "paragraph");
});

test("what the strip's block actions write over a range is the Markdown of the blocks", () => {
  const twoParagraphs = () => stateAt(docOf(paragraph(richSchema.text("one")), paragraph(richSchema.text("two"))), 1, 9);

  const quoted = run(twoParagraphs(), toggleQuote);
  assert.equal(quoted.ok, true);
  assert.equal(serializeMarkdown(quoted.state.doc), "> one\n>\n> two", "both paragraphs went into one quote");
  const noted = run(twoParagraphs(), makeNote);
  assert.equal(noted.ok, true);
  assert.equal(serializeMarkdown(noted.state.doc), "> [!NOTE]\n> one\n>\n> two", "and into one note");
  const listed = run(twoParagraphs(), toggleBulletList);
  assert.equal(listed.ok, true);
  assert.equal(serializeMarkdown(listed.state.doc), "- one\n- two", "the list gets one item per paragraph");
  const fenced = run(twoParagraphs(), toggleCodeBlock);
  assert.equal(fenced.ok, true);
  assert.equal(serializeMarkdown(fenced.state.doc), "```\none\n```\n\n```\ntwo\n```", "Code block fences each selected block");
});

test("one undo takes a strip action back, and the typing before it stays", () => {
  const base = EditorState.create({ doc: docOf(paragraph()), plugins: [history()] });
  const written = typed(base, "quoted");
  const quoted = run(written, toggleQuote);
  assert.equal(quoted.ok, true);
  assert.equal(serializeMarkdown(quoted.state.doc), "> quoted");
  const undone = run(quoted.state, undo);
  assert.equal(undone.ok, true);
  assert.equal(undone.state.doc.firstChild?.type.name, "paragraph", "the quote is one undo, not one per step");
  assert.equal(serializeMarkdown(undone.state.doc), "quoted", "and the typing under it is still there");
  const retyped = run(undone.state, undo);
  assert.equal(retyped.ok, true);
  assert.equal(retyped.state.doc.textContent, "", "the typing itself is the next undo");

  // A mark action is one undo too, over whatever the selection covers.
  const marking = EditorState.create({ doc: docOf(paragraph(richSchema.text("quoted"))), plugins: [history()] });
  const range = marking.apply(marking.tr.setSelection(TextSelection.create(marking.doc, 1, 7)));
  const bolded = run(range, toggleStrong);
  assert.equal(bolded.ok, true);
  assert.equal(serializeMarkdown(bolded.state.doc), "**quoted**");
  assert.deepEqual(inlineShape(run(bolded.state, undo).state.doc), [{ text: "quoted", marks: [] }], "one undo takes the mark off");
});

test("each action's pressed and disabled state is what the selection allows", () => {
  const prose = stateAt(docOf(paragraph(richSchema.text("abc"))), 1, 4);
  const state = formatState(prose);
  assert.deepEqual({ pressed: state.text.pressed, disabled: state.text.disabled }, { pressed: true, disabled: true },
    "a plain paragraph is what Text names, and there is no block to take away");
  assert.deepEqual({ pressed: state.quote.pressed, disabled: state.quote.disabled }, { pressed: false, disabled: false });
  assert.equal(state.bold.disabled, false, "a mark can always be added to a range");
  assert.equal(state.cut.disabled, false, "a selection can be cut");
  assert.equal(state.paste.disabled, false, "the clipboard items follow the selection, and the toolbar answers for Paste");

  const caret = formatState(stateAt(docOf(paragraph(richSchema.text("abc")))));
  assert.equal(caret.cut.disabled, true, "a caret has nothing to cut");
  assert.equal(caret.copy.disabled, true);
  assert.equal(caret.bold.disabled, false, "typing bold at a caret is still an edit");

  const insideNote = formatState(stateAt(docOf(note("tip", paragraph(richSchema.text("x"))))));
  assert.deepEqual({ pressed: insideNote.note.pressed, disabled: insideNote.note.disabled }, { pressed: true, disabled: true },
    "a note is already the block the selection sits in");
  assert.equal(insideNote.text.disabled, false, "and Text is what takes it away");

  const insideList = formatState(stateAt(docOf(bulletList(listItem(paragraph(richSchema.text("x")))))));
  assert.equal(insideList["bullet-list"].pressed, true);
  assert.equal(insideList.quote.pressed, false);
  assert.equal(blockKindOf(stateAt(docOf(bulletList(listItem(paragraph(richSchema.text("x"))))))), "list");
  assert.equal(blockKindOf(stateAt(docOf(codeBlock("x")))), "code");
  assert.equal(blockKindOf(stateAt(docOf(paragraph(richSchema.text("x"))))), "paragraph");
});

test("an action that takes several steps is still one transaction and one undo", () => {
  // A note inside a quote: `Text` lifts both containers, which is two transforms folded into the one transaction the
  // strip's single action may dispatch.
  const nested = docOf(blockquote(note("note", paragraph(richSchema.text("deep")))));
  const base = EditorState.create({ doc: nested, plugins: [history()] });
  const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 3)));
  const flattened = run(state, toPlainParagraph);
  assert.equal(flattened.ok, true);
  assert.equal(flattened.state.doc.childCount, 1, "the quote and the note are both gone");
  assert.equal(flattened.state.doc.firstChild?.type.name, "paragraph");
  assert.equal(serializeMarkdown(flattened.state.doc), "deep", "and the wire is the prose that was inside them");
  const undone = run(flattened.state, undo);
  assert.equal(undone.ok, true, "one undo");
  assert.equal(undone.state.doc.firstChild?.type.name, "blockquote", "restores the quote");
  assert.equal(undone.state.doc.firstChild?.firstChild?.type.name, "note", "and the note inside it");
  assert.equal(serializeMarkdown(undone.state.doc), "> > [!NOTE]\n> > deep", "with the wire it had");
});
