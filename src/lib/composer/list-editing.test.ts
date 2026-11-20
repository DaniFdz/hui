/**
 * The list-edit and wrap rules the composer's keys run: what each one changes, where the caret lands, and when it
 * changes nothing at all (so Tab still leaves the draft).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { endEmptyListItem, indentListSelection, outdentListSelection, toggleWrap, wrapFenceSelection } from "./list-editing.ts";

/** Applies an edit to the draft and says what the textarea would then hold and select. */
function apply(edit: { text: string; start: number; end: number } | undefined) {
  return edit && { text: edit.text, selected: edit.text.slice(edit.start, edit.end), start: edit.start, end: edit.end };
}

test("Tab adds one list level per line, at a caret or across a selection", () => {
  assert.deepEqual(apply(indentListSelection("- item", 2, 2)), { text: "   - item", selected: "", start: 5, end: 5 });
  assert.deepEqual(apply(indentListSelection("   - item", 5, 5)), { text: "      - item", selected: "", start: 8, end: 8 });
  assert.deepEqual(apply(indentListSelection("      - item", 8, 8)), { text: "         - item", selected: "", start: 11, end: 11 });
  // Three levels is the deepest a list line goes.
  assert.equal(indentListSelection("         - item", 11, 11), undefined);
  // A caret at a line start ends after the indent that line just gained, where its marker now begins.
  assert.deepEqual(apply(indentListSelection("- one\n- two", 6, 6)), { text: "- one\n   - two", selected: "", start: 9, end: 9 });
  // Every touched list line moves; the prose around them does not.
  const mixed = indentListSelection("- one\nplain\n1. two", 0, 18);
  assert.equal(mixed?.text, "   - one\nplain\n   1. two");
  // The selection maps with the text: 0 at a line start moves to where that line's text now begins.
  assert.deepEqual({ start: mixed?.start, end: mixed?.end }, { start: 3, end: 24 });
});

test("a selection that ends at the next line's start does not reach it", () => {
  const end = "- one\n".length;
  assert.deepEqual(apply(indentListSelection("- one\n- two", 0, end)), { text: "   - one\n- two", selected: "- one\n", start: 3, end: end + 3 });
  // Tab over prose alone changes nothing, so the browser may move focus instead.
  assert.equal(indentListSelection("plain text", 3, 3), undefined);
  assert.equal(indentListSelection("- item\nplain", 8, 8), undefined);
});

test("Shift+Tab removes one level from every selected list line", () => {
  assert.deepEqual(apply(outdentListSelection("      - item", 8, 8)), { text: "   - item", selected: "", start: 5, end: 5 });
  assert.deepEqual(apply(outdentListSelection("   - item", 5, 5)), { text: "- item", selected: "", start: 2, end: 2 });
  // A tab counts as one level and goes whole.
  assert.deepEqual(apply(outdentListSelection("\t- item", 3, 3)), { text: "- item", selected: "", start: 2, end: 2 });
  // A caret inside the indent lands where the marker now starts.
  assert.deepEqual(apply(outdentListSelection("      - item", 2, 2)), { text: "   - item", selected: "", start: 0, end: 0 });
  const levels = "      - a\n   - b";
  assert.deepEqual(apply(outdentListSelection(levels, 0, levels.length)), { text: "   - a\n- b", selected: "   - a\n- b", start: 0, end: 10 });
  // A list at the margin, or prose, has nothing to outdent.
  assert.equal(outdentListSelection("- item", 2, 2), undefined);
  assert.equal(outdentListSelection("plain", 2, 2), undefined);
  assert.equal(outdentListSelection("      - item\nplain", 15, 15), undefined);
});

test("Enter on an empty list item ends the list instead of adding a line", () => {
  assert.deepEqual(endEmptyListItem("- ", 2), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("* ", 2), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("+   ", 4), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("1. ", 3), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("12) ", 4), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("   - ", 5), { text: "", caret: 0 });
  assert.deepEqual(endEmptyListItem("- a\n- \nb", 6), { text: "- a\n\nb", caret: 4 });
  assert.deepEqual(endEmptyListItem("```\n- \n```", 6), { text: "```\n\n```", caret: 4 });
  // Only a whole empty item is consumed: text after the marker, and a bare dash, are ordinary lines.
  for (const line of ["- x", "-", "*", "1.", "- -", "plain", "", "- \t x"]) {
    assert.equal(endEmptyListItem(line, line.length), undefined, line);
  }
});

test("a wrap marker toggles around the selection or the caret", () => {
  assert.deepEqual(apply(toggleWrap("hello", 0, 5, "**")), { text: "**hello**", selected: "hello", start: 2, end: 7 });
  assert.deepEqual(apply(toggleWrap("**hello**", 2, 7, "**")), { text: "hello", selected: "hello", start: 0, end: 5 });
  assert.deepEqual(apply(toggleWrap("**hello**", 0, 9, "**")), { text: "hello", selected: "hello", start: 0, end: 5 });
  assert.deepEqual(apply(toggleWrap("", 0, 0, "**")), { text: "****", selected: "", start: 2, end: 2 });
  assert.deepEqual(apply(toggleWrap("****", 2, 2, "**")), { text: "", selected: "", start: 0, end: 0 });
  // A caret inside a run unwraps that run; outside one it opens an empty pair.
  assert.deepEqual(apply(toggleWrap("**bold**", 4, 4, "**")), { text: "bold", selected: "", start: 2, end: 2 });
  assert.deepEqual(apply(toggleWrap("plain", 2, 2, "`")), { text: "pl``ain", selected: "", start: 3, end: 3 });
  assert.deepEqual(apply(toggleWrap("*it*", 1, 3, "*")), { text: "it", selected: "it", start: 0, end: 2 });
});

test("a fence wraps a multi-line selection, or opens an empty block for the caret", () => {
  const block = wrapFenceSelection("one\ntwo\nthree", 4, 7);
  assert.deepEqual(apply(block), { text: "one\n```\ntwo\n```\nthree", selected: "two", start: 8, end: 11 });
  assert.deepEqual(apply(wrapFenceSelection("", 0, 0)), { text: "```\n\n```", selected: "", start: 4, end: 4 });
  // Mid-line the block takes the break it needs rather than mangling the draft.
  assert.deepEqual(apply(wrapFenceSelection("hello", 5, 5)), { text: "hello\n```\n\n```", selected: "", start: 10, end: 10 });
});
