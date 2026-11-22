/**
 * The composer's keys as pure commands over `EditorState`/`EditorView`: what Enter, Shift+Enter, Tab, the formatting
 * chords and undo do, separate from the view that binds them.
 *
 * Enter policy. Enter sends in prose, and the integration binds that send; the editor only edits where an edit is what
 * Enter means:
 * - in a non-empty list item it splits the item, so a list grows without leaving it;
 * - on an empty list item it lifts the item out and ends the list;
 * - in a code block it inserts a newline, because a fence's lines are content;
 * - everywhere else it reports `false`, and the caller sends.
 * Shift+Enter always inserts a hard break. The Send button and Mod-Enter always send, whatever the cursor sits in.
 *
 * Tab sinks a list item and Shift+Tab lifts it, both returning `false` outside a list so Tab still moves focus out of
 * the editor; inside a code block Tab indents by two spaces (the dialect's list indent) instead. Cmd/Ctrl+B, I and E
 * toggle strong, emphasis and inline code, Cmd/Ctrl+Shift+E fences the selection, and undo/redo/select-all are
 * prosemirror-history's and prosemirror-commands' own. In a literal draft (see `editor.ts`) the formatting chords are
 * consumed and change nothing (`richKeymap`'s `formatting`).
 */
import { chainCommands, selectAll, setBlockType, toggleMark } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { Plugin, type Command, type EditorState } from "prosemirror-state";
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

/**
 * Enter as an edit. It reports `false` in prose, where Enter sends: the caller sends then, never the editor.
 */
export const enterKey: Command = (state, dispatch, view) => {
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
 * Shift+Enter hard-breaks, Tab and Shift+Tab indent code or change a list's depth, and the formatting chords and
 * history are bound to the commands above. `formatting` says whether the chords act; while it is false a chord is
 * consumed without a transaction. A consumed key is handled, so the view prevents its default action and the browser's
 * own bold, italic or code command does not run for it.
 */
export function richKeymap(options: { onSend: () => void; formatting?: () => boolean }): Plugin {
  const formatting = options.formatting ?? (() => true);
  const chord = (command: Command): Command => (state, dispatch, view) => (formatting() ? command(state, dispatch, view) : true);
  return keymap({
    Enter: (state, dispatch, view) => enterPolicy(state) === "send" ? (options.onSend(), true) : enterKey(state, dispatch, view),
    "Shift-Enter": chainCommands(codeBlockNewline, newline),
    "Mod-Enter": sendKey(options.onSend),
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
