/**
 * The composer's keys as pure commands over `EditorState`/`EditorView`: what Enter, Shift+Enter, Tab, the formatting
 * chords and undo do, separate from the view that binds them.
 *
 * Enter policy. Enter sends in prose, and the integration binds that send; the editor only edits where an edit is what
 * Enter means:
 * - in a paragraph holding nothing but ```` ``` ```` or ```` ```lang ```` it opens a fenced code block with that
 *   language, so a fence starts on Enter as well as on the space the input rule converts;
 * - in a non-empty list item it splits the item, so a list grows without leaving it;
 * - on an empty list item it lifts the item out and ends the list;
 * - in a code block it inserts a newline, because a fence's lines are content, and on a last line that is only
 *   ```` ``` ```` it drops that line and leaves the block, where a paragraph can follow it; elsewhere that line stays
 *   and Enter adds a line after it;
 * - everywhere else it reports `false`, and the caller sends.
 * Shift+Enter always inserts a hard break. The Send button and Mod-Enter always send, whatever the cursor sits in.
 *
 * A fence is left from the keyboard too: ArrowDown at the end of a code block's content (`exitCodeBlockDown`) or Enter
 * on its closing fence line (`closeCodeFence`) moves the caret to the paragraph after it, adding one when the block ends
 * its container. Enter leaves the block only where a paragraph can follow it; otherwise it adds a line to the block.
 * Cmd/Ctrl+Shift+E still turns a fence back into a paragraph.
 *
 * Tab sinks a list item and Shift+Tab lifts it, both returning `false` outside a list so Tab still moves focus out of
 * the editor; inside a code block Tab indents by two spaces (the dialect's list indent) instead. Cmd/Ctrl+B, I and E
 * toggle strong, emphasis and inline code, Cmd/Ctrl+Shift+E fences the selection, and undo/redo/select-all are
 * prosemirror-history's and prosemirror-commands' own. In a literal draft (see `editor.ts`) the formatting chords are
 * consumed and change nothing (`richKeymap`'s `formatting`).
 */
import { chainCommands, selectAll, setBlockType, toggleMark } from "prosemirror-commands";
import { closeHistory, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { Plugin, TextSelection, type Command, type EditorState } from "prosemirror-state";
import { schemaMark, schemaNode } from "./schema.ts";

/** What Enter means where the cursor is (see the module header). */
export type EnterAction = "send" | "split-item" | "exit-item" | "newline" | "hard-break";

/** Two spaces, the same width as one list level, so code indented in the composer reads back unchanged. */
export const CODE_INDENT = "  ";

/** The nearest ancestor of the cursor that is a list item, when there is one. */
function listItemDepth(state: EditorState): number | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "list_item") return depth;
  }
  return undefined;
}

/** A list item holding nothing but an empty paragraph: Enter there ends the list instead of splitting it. */
function emptyListItem(state: EditorState): boolean {
  const depth = listItemDepth(state);
  if (depth === undefined) return false;
  const item = state.selection.$from.node(depth);
  const first = item.firstChild;
  return item.childCount === 1 && first?.type.name === "paragraph" && first.content.size === 0;
}

/** What Enter means right now. */
export function enterPolicy(state: EditorState, shift = false): EnterAction {
  if (shift) return "hard-break";
  if (state.selection.$from.parent.type.spec.code) return "newline";
  if (listItemDepth(state) === undefined) return "send";
  return emptyListItem(state) ? "exit-item" : "split-item";
}

/** The integration's send, as a command so a keymap can bind Enter or Mod-Enter to it. */
export function sendKey(send: () => void): Command {
  return () => {
    send();
    return true;
  };
}

/** A hard break in prose or a heading: Shift+Enter, where no code block holds the cursor. */
export const newline: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schemaNode(state.schema, "hard_break").create()).scrollIntoView());
  return true;
};

/** A newline character inside a code block, whose content is text and cannot hold a `hard_break` node. */
export const codeBlockNewline: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.insertText("\n").scrollIntoView());
  return true;
};

/** Splits the list item at the cursor. */
export const splitItem: Command = (state, dispatch, view) => splitListItem(schemaNode(state.schema, "list_item"))(state, dispatch, view);

/** Lifts an empty list item out of its list, ending the list when it was the last item. */
export const exitItem: Command = (state, dispatch, view) => liftListItem(schemaNode(state.schema, "list_item"))(state, dispatch, view);

/** A fence's opening markers, and the range the paragraph holding them spans. */
type OpeningFence = { start: number; end: number; language: string };

/**
 * The fence a paragraph holds whole, when the caret ends it: ```` ``` ```` or ```` ```lang ````, with one optional
 * trailing space and no code mark under the caret. A longer run, a heading, a fence with anything else around it and a
 * fence inside an inline code span are all just text, and so is a fence whose paragraph cannot become a code block
 * where it sits: a list item's first paragraph must stay one.
 */
function openingFence(state: EditorState): OpeningFence | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if ($from.parent.type !== schemaNode(state.schema, "paragraph")) return undefined;
  if ($from.parentOffset !== $from.parent.content.size) return undefined;
  // One text node, so a hard break after the markers is not read as part of a fence's paragraph.
  if ($from.parent.childCount !== 1) return undefined;
  const pendingCode = state.storedMarks?.some((mark) => mark.type.spec.code) ?? false;
  if (pendingCode || $from.marks().some((mark) => mark.type.spec.code)) return undefined;
  const match = /^```([A-Za-z0-9_+.#-]*) ?$/u.exec($from.parent.textContent);
  if (!match) return undefined;
  // The check the input rule makes before it converts (`textblockTypeInputRule`): where the paragraph cannot be replaced
  // by a code block, the markers stay text and Enter keeps its ordinary meaning.
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (!container.canReplaceWith(index, index + 1, schemaNode(state.schema, "code_block"))) return undefined;
  return { start: $from.start(), end: $from.end(), language: match[1] ?? "" };
}

/**
 * Enter on a paragraph that is only a fence opens the code block carrying that language, the markers gone. One
 * transaction, closed from the typed text's history event as the input rules' conversions are, so one undo restores the
 * literal fence byte for byte.
 */
export const openCodeFence: Command = (state, dispatch) => {
  const fence = openingFence(state);
  if (!fence) return false;
  if (dispatch) {
    const { start, end, language } = fence;
    const tr = state.tr.delete(start, end).setBlockType(start, start, schemaNode(state.schema, "code_block"), { language });
    tr.setSelection(TextSelection.create(tr.doc, start)).scrollIntoView();
    dispatch(closeHistory(tr));
  }
  return true;
};

/** Where a code block can be left: the position after it, and whether a paragraph has to be inserted there first. */
type CodeBlockExit = { after: number; insert: boolean };

/**
 * Leaving the caret's code block, when the caret ends its content: the paragraph that follows it, or a place for one
 * when it ends its container. `undefined` when the caret is not in a code block, not at its content's end, or when no
 * paragraph can follow it (another block does, or the container cannot hold one there).
 */
function codeBlockExit(state: EditorState): CodeBlockExit | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if (!$from.parent.type.spec.code) return undefined;
  if ($from.parentOffset !== $from.parent.content.size) return undefined;
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1) + 1;
  const after = $from.after(depth);
  const following = container.maybeChild(index);
  if (following) return following.type === schemaNode(state.schema, "paragraph") ? { after, insert: false } : undefined;
  const paragraph = schemaNode(state.schema, "paragraph");
  return container.canReplaceWith(index, index, paragraph) ? { after, insert: true } : undefined;
}

/**
 * ArrowDown at the end of a fence's content leaves the block for the paragraph after it, adding one when the block ends
 * its container; anywhere else the arrow stays the browser's, so it moves the caret through the code's lines.
 */
export const exitCodeBlockDown: Command = (state, dispatch) => {
  const exit = codeBlockExit(state);
  if (!exit) return false;
  if (dispatch) {
    const tr = state.tr;
    if (exit.insert) tr.insert(exit.after, schemaNode(state.schema, "paragraph").create());
    tr.setSelection(TextSelection.create(tr.doc, exit.after + 1)).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** The one line that closes a fence in the composer's dialect. */
const CLOSING_FENCE = "```";

/**
 * Enter on a code block's last line when that line is only ```` ``` ````: the line and the newline before it go, and the
 * caret leaves the block as ArrowDown does. A block holding nothing but that line becomes the paragraph itself, with the
 * caret inside it. A fence line with any line after it is an ordinary newline, so only a closing fence ends a block, and
 * only where a paragraph can follow it: with nowhere to go the line stays and Enter adds a line after it.
 */
export const closeCodeFence: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const { parent } = $from;
  if (!parent.type.spec.code) return false;
  if ($from.parentOffset !== parent.content.size) return false;
  const text = parent.textContent;
  if (text === CLOSING_FENCE) {
    // Nothing but the fence was in the block, so the block itself becomes the paragraph the caret stays in.
    if (!dispatch) return true;
    const start = $from.start();
    const tr = state.tr.delete(start, $from.end()).setBlockType(start, start, schemaNode(state.schema, "paragraph"));
    tr.setSelection(TextSelection.create(tr.doc, start)).scrollIntoView();
    dispatch(tr);
    return true;
  }
  if (!text.endsWith(`\n${CLOSING_FENCE}`)) return false;
  // The exit is read before the line goes: the structure is unchanged, and everything after that line moves up by it.
  // Nowhere to go is no closing fence, so nothing is deleted and Enter is an ordinary newline in the block.
  const exit = codeBlockExit(state);
  if (!exit) return false;
  if (!dispatch) return true;
  const shift = CLOSING_FENCE.length + 1;
  const after = exit.after - shift;
  const tr = state.tr.delete($from.end() - shift, $from.end());
  if (exit.insert) tr.insert(after, schemaNode(state.schema, "paragraph").create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
  dispatch(tr);
  return true;
};

/**
 * Enter as an edit. It reports `false` in prose, where Enter sends: the caller sends then, never the editor.
 */
export const enterKey: Command = (state, dispatch, view) => {
  // A closing fence line ends the block instead of adding a line after it.
  if (closeCodeFence(state, dispatch, view)) return true;
  const action = enterPolicy(state);
  if (action === "split-item") return splitItem(state, dispatch, view);
  if (action === "exit-item") return exitItem(state, dispatch, view);
  if (action === "newline") return codeBlockNewline(state, dispatch, view);
  return false;
};

/** Tab in a list sinks the item; `false` outside one, so focus leaves the editor. */
export const tabInList: Command = (state, dispatch, view) => sinkListItem(schemaNode(state.schema, "list_item"))(state, dispatch, view);

/** Shift+Tab in a list lifts the item; `false` outside one, so focus leaves the editor. */
export const shiftTabInList: Command = (state, dispatch, view) => liftListItem(schemaNode(state.schema, "list_item"))(state, dispatch, view);

/** Tab in a code block inserts two spaces. */
export const indentCodeBlock: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.insertText(CODE_INDENT).scrollIntoView());
  return true;
};

/** Shift+Tab in a code block removes up to two spaces of the current line's indentation. */
export const outdentCodeBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.type.spec.code) return false;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - CODE_INDENT.length), $from.parentOffset, undefined, "\ufffc");
  if (!before || !/^ +$/u.test(before)) return false;
  if (dispatch) dispatch(state.tr.delete($from.pos - before.length, $from.pos).scrollIntoView());
  return true;
};

export const toggleStrong: Command = (state, dispatch, view) => toggleMark(schemaMark(state.schema, "strong"))(state, dispatch, view);

export const toggleEmphasis: Command = (state, dispatch, view) => toggleMark(schemaMark(state.schema, "em"))(state, dispatch, view);

export const toggleInlineCode: Command = (state, dispatch, view) => toggleMark(schemaMark(state.schema, "code"))(state, dispatch, view);

/** Cmd/Ctrl+Shift+E: the selection becomes a fenced code block, or a code block goes back to a paragraph. */
export const fenceSelection: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  const paragraph = schemaNode(state.schema, "paragraph");
  const code = schemaNode(state.schema, "code_block");
  if ($from.parent.type.spec.code) return setBlockType(paragraph)(state, dispatch, view);
  return setBlockType(code, { language: "" })(state, dispatch, view);
};

export { redo, selectAll, undo };

/**
 * The composer's key bindings, for the view to install: Enter follows `enterPolicy` (sending through `onSend`),
 * Shift+Enter hard-breaks, ArrowDown leaves a fence at its end, Tab and Shift+Tab indent code or change a list's depth,
 * and the formatting chords and history are bound to the commands above. `formatting` says whether the chords act; while
 * it is false a chord is consumed without a transaction. A consumed key is handled, so the view prevents its default
 * action and the browser's own bold, italic or code command does not run for it.
 */
export function richKeymap(options: { onSend: () => void; formatting?: () => boolean }): Plugin {
  const formatting = options.formatting ?? (() => true);
  const chord = (command: Command): Command => (state, dispatch, view) => (formatting() ? command(state, dispatch, view) : true);
  return keymap({
    Enter: (state, dispatch, view) => enterPolicy(state) === "send" ? (options.onSend(), true) : enterKey(state, dispatch, view),
    "Shift-Enter": chainCommands(codeBlockNewline, newline),
    "Mod-Enter": sendKey(options.onSend),
    ArrowDown: exitCodeBlockDown,
    Tab: chainCommands(indentCodeBlock, tabInList),
    "Shift-Tab": chainCommands(outdentCodeBlock, shiftTabInList),
    "Mod-b": chord(toggleStrong),
    "Mod-i": chord(toggleEmphasis),
    "Mod-e": chord(toggleInlineCode),
    "Mod-Shift-e": chord(fenceSelection),
    "Mod-z": undo,
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    "Mod-a": selectAll,
  });
}
