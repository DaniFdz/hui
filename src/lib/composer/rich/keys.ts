/**
 * The composer's keys as pure commands over `EditorState`/`EditorView`: what Enter, Shift+Enter, Tab, the formatting
 * chords and undo do, separate from the view that binds them.
 *
 * Enter policy. Enter sends in prose, and the integration binds that send; the editor only edits where an edit is what
 * Enter means:
 * - in a paragraph holding nothing but ```` ``` ```` or ```` ```lang ```` it opens a fenced code block with that
 *   language, so a fence starts on Enter as well as on the space the input rule converts, and in a paragraph holding
 *   nothing but a `[!NOTE]` marker (any of the five kinds) inside a quote's first paragraph it opens that note, so a
 *   callout starts on Enter as well as on the space the marker's rule converts;
 * - in a non-empty list item it splits the item, so a list grows without leaving it;
 * - on an empty list item it lifts the item out and ends the list;
 * - in a code block it inserts a newline, because a fence's lines are content, and on a last line that is only
 *   ```` ``` ```` it drops that line and leaves the block, where a paragraph can follow it; elsewhere that line stays
 *   and Enter adds a line after it;
 * - in a heading, and anywhere inside a quote or a note (`block`), it adds a line rather than sending: the block splits
 *   where the caret is, so a quote or a note takes a second and a third empty line at its end, and a heading ends in the
 *   paragraph its own split puts below it. Enter never leaves a quote, a note or a heading, and never sends from one;
 * - everywhere else it reports `false`, and the caller sends.
 * Shift+Enter always inserts a hard break. The Send button and Mod-Enter always send, whatever the cursor sits in.
 *
 * The way out of a quote, a note or a fence is Backspace on the empty line that gesture leaves (`exitEmptyLineBackward`):
 * at the start of a quote's or a note's empty last paragraph, with real content before it in the block, the block's
 * trailing empty paragraphs go and the caret moves to a plain paragraph below the block, the text the operator typed
 * kept; in a fence, at the end of text that ends in one or more newlines with text before them, those newlines go the
 * same way. Only that empty line is ever the exit: a Backspace that would delete typed text reports `false` and lets
 * `baseKeymap` delete a character, an empty line in the middle of a block stays a join, and a quote or a note holding
 * nothing but empty paragraphs is not left this way. Backspace at the start of an empty heading, or of a quote or a note
 * holding one empty paragraph, turns that block back into the plain paragraph it wraps (`exitBlockBackward`). Each exit
 * is one transaction, closed from the typed text's history event, so one undo restores the block and the empty line it
 * had.
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
 *
 * The selection toolbar's actions are commands here too (`COMPOSER_ACTIONS`): the inline toggles add or remove one mark,
 * and the block ones move the selected blocks into a quote, a note, a bullet list or a fence and back out again — `Text`
 * takes every one of those away. Each block action is a `sequence` of the steps it may need, so it is one transaction and
 * one undo, and the strip's disabled state is a dry run of the same command. `blockKindOf` and `markActive` are the
 * pressed state it reads: over a range they ask whether the whole selection carries the block or the mark, and at a caret
 * they answer what the next typed character would be.
 */
import { chainCommands, lift, selectAll, setBlockType, splitBlock, toggleMark, wrapIn } from "prosemirror-commands";
import { closeHistory, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { NodeRange, type ResolvedPos } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { liftTarget, Mapping } from "prosemirror-transform";
import type { AlertType } from "../../markdown/parser.ts";
import { noteFromMarker } from "./rules.ts";
import { schemaMark, schemaNode } from "./schema.ts";

/** What Enter means where the cursor is (see the module header). */
export type EnterAction = "send" | "block" | "split-item" | "exit-item" | "newline" | "hard-break";

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

/**
 * The node names a caret can sit inside as an annotation: the containers Enter adds a line to, and whose empty last line
 * Backspace leaves. A note joins this set, so it is read exactly as a quote is: a container is always read by membership
 * here and never by a second name of its own.
 */
const CONTAINER_EXITS: ReadonlySet<string> = new Set(["blockquote", "note"]);

/** The block Enter and Backspace act on around the caret. */
type BlockAnchor = {
  /** The depth of the block: the heading itself, or the outermost container around the caret. */
  depth: number;
  /** Whether that block is the caret's own textblock, a heading, rather than the container holding it. */
  own: boolean;
};

/**
 * The block Enter and Backspace act on, when the caret sits in a heading or inside a container: the outermost one, which
 * is what makes Enter an edit rather than a send. `undefined` in prose, in a list item and in a fence, which keep their
 * own meaning for those keys.
 */
function blockAnchor(state: EditorState): BlockAnchor | undefined {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return undefined;
  if (listItemDepth(state) !== undefined) return undefined;
  let depth = $from.depth;
  while (depth > 1 && CONTAINER_EXITS.has($from.node(depth - 1).type.name)) depth -= 1;
  if (depth === $from.depth && $from.parent.type !== schemaNode(state.schema, "heading")) return undefined;
  return { depth, own: depth === $from.depth };
}

/** Where a block can be left: the position after it, and whether a paragraph has to be added there first. */
type BlockBelow = { after: number; insert: boolean };

/**
 * The paragraph after the block at `depth`, or a place for one when that block ends its container: `undefined` when no
 * paragraph can follow it, because another block does or the container cannot hold one there. Both a fence's ArrowDown
 * exit and the Backspace that leaves a block by its empty last line are read through it.
 */
function paragraphBelow(state: EditorState, depth: number): BlockBelow | undefined {
  const { $from } = state.selection;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1) + 1;
  const after = $from.after(depth);
  const paragraph = schemaNode(state.schema, "paragraph");
  const following = container.maybeChild(index);
  if (following) return following.type === paragraph ? { after, insert: false } : undefined;
  return container.canReplaceWith(index, index, paragraph) ? { after, insert: true } : undefined;
}

/** The block at the caret becomes a plain paragraph, in one transaction the next undo takes back. */
function toParagraph(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const closed = dispatch && ((transaction: Transaction) => dispatch(closeHistory(transaction)));
  return setBlockType(schemaNode(state.schema, "paragraph"))(state, closed);
}

/**
 * Lifts the caret's block out of every container holding it, so a quote or a note holding one empty paragraph is that
 * paragraph. `lift` does the transform; the caret is placed at the block's start, and the exit is one undo of its own.
 */
function liftOut(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 1 && CONTAINER_EXITS.has($from.node(depth - 1).type.name)) depth -= 1;
  const caret = $from.before(depth) + 1;
  const closed = dispatch && ((transaction: Transaction) => {
    transaction.setSelection(TextSelection.create(transaction.doc, caret));
    dispatch(closeHistory(transaction));
  });
  return lift(state, closed);
}

/** What Enter means right now. */
export function enterPolicy(state: EditorState, shift = false): EnterAction {
  if (shift) return "hard-break";
  if (state.selection.$from.parent.type.spec.code) return "newline";
  if (listItemDepth(state) !== undefined) return emptyListItem(state) ? "exit-item" : "split-item";
  if (blockAnchor(state) !== undefined) return "block";
  return "send";
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

/** The marker a paragraph of a quote holds whole: `[!NOTE]` … `[!CAUTION]`, any case, one optional trailing space. */
const NOTE_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\] ?$/iu;

/** A quote's first paragraph that holds nothing but a note marker: the range it spans and the kind the marker names. */
type OpeningNote = { start: number; end: number; kind: AlertType };

/**
 * The note a paragraph of a quote opens on Enter, when it holds nothing else: the marker, any of the five kinds in any
 * case, with or without the trailing space. `undefined` for a paragraph that holds more than the marker, one that is not
 * a quote's first paragraph (a later one is the quote's body), and a marker whose quote cannot be a note where it sits:
 * the check the input rule makes before it converts.
 */
function openingNote(state: EditorState): OpeningNote | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if ($from.parent.type !== schemaNode(state.schema, "paragraph")) return undefined;
  if ($from.parentOffset !== $from.parent.content.size) return undefined;
  // One text node, so a hard break after the marker is not read as part of the marker's paragraph.
  if ($from.parent.childCount !== 1) return undefined;
  const pendingCode = state.storedMarks?.some((mark) => mark.type.spec.code) ?? false;
  if (pendingCode || $from.marks().some((mark) => mark.type.spec.code)) return undefined;
  const match = NOTE_MARKER_RE.exec($from.parent.textContent);
  if (!match) return undefined;
  const depth = $from.depth;
  if (depth < 2) return undefined;
  if ($from.node(depth - 1).type !== schemaNode(state.schema, "blockquote")) return undefined;
  // Only the quote's first paragraph opens a note: a later one is the quote's body.
  if ($from.index(depth - 1) !== 0) return undefined;
  const container = $from.node(depth - 2);
  const index = $from.index(depth - 2);
  if (!container.canReplaceWith(index, index + 1, schemaNode(state.schema, "note"))) return undefined;
  return { start: $from.start(), end: $from.end(), kind: (match[1] ?? "note").toLowerCase() as AlertType };
}

/**
 * Enter on a paragraph that is only a note marker turns its quote into the note of that kind, the marker gone: the same
 * conversion the input rule makes on the space (`rules.ts`' `noteFromMarker`), one transaction, closed from the typed
 * text's history event, so one undo restores the literal marker byte for byte.
 */
export const openNote: Command = (state, dispatch) => {
  const note = openingNote(state);
  if (!note) return false;
  if (dispatch) {
    const tr = noteFromMarker(state, note.start, note.end, note.kind);
    if (!tr) return false;
    dispatch(closeHistory(tr));
  }
  return true;
};

/**
 * Leaving the caret's code block, when the caret ends its content: the paragraph that follows it, or a place for one
 * when it ends its container. `undefined` when the caret is not in a code block, not at its content's end, or when no
 * paragraph can follow it (another block does, or the container cannot hold one there).
 */
function codeBlockExit(state: EditorState): BlockBelow | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if (!$from.parent.type.spec.code) return undefined;
  if ($from.parentOffset !== $from.parent.content.size) return undefined;
  return paragraphBelow(state, $from.depth);
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
 * Enter in a quote, a note or a heading: the block splits where the caret is, so the quote or the note takes a new empty
 * line at its end and a heading ends in the paragraph its split puts below it. Enter never leaves a block and never
 * sends from one: `exitEmptyLineBackward` is what leaves the empty line it adds. Lists and fences never reach here.
 */
export const enterBlock: Command = (state, dispatch, view) => {
  if (blockAnchor(state) === undefined) return false;
  // The split is closed from the typed text's history event, so it is one undo of its own.
  const split = dispatch && ((transaction: Transaction) => dispatch(closeHistory(transaction)));
  return splitBlock(state, split, view);
};

/**
 * Backspace at the start of an empty heading, or of a quote or a note holding one empty paragraph: it becomes the plain
 * paragraph it wraps, with the caret at its start. Only an empty textblock is this key's, so a Backspace that would
 * delete typed text is never an exit; a quote holding several blocks, a list item and a fence keep their own Backspace,
 * and `false` leaves the key to `baseKeymap`, which is what keeps deleting a character working.
 */
export const exitBlockBackward: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!state.selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  if ($from.parent.content.size !== 0) return false;
  if ($from.parentOffset !== 0 || listItemDepth(state) !== undefined) return false;
  if ($from.parent.type === schemaNode(state.schema, "heading")) return toParagraph(state, dispatch);
  const anchor = blockAnchor(state);
  if (!anchor || anchor.own) return false;
  // A quote holding several blocks keeps today's Backspace: the caret's block is one of them, not the quote.
  if ($from.depth !== anchor.depth + 1 || $from.node(anchor.depth).childCount !== 1) return false;
  return liftOut(state, dispatch);
};

/**
 * What Backspace on an empty line takes out, and where the caret lands: the range inside the block that goes, and the
 * position after the block where a plain paragraph takes the caret, added there when the block ends its container.
 */
type EmptyLineExit = { from: number; to: number; after: number; insert: boolean };

/** The depth of the innermost quote or note holding the caret's textblock, when there is one and no list item is. */
function innermostContainer(state: EditorState): number | undefined {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return undefined;
  if (listItemDepth(state) !== undefined) return undefined;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if (CONTAINER_EXITS.has($from.node(depth).type.name)) return depth;
  }
  return undefined;
}

/**
 * The exit a quote's or a note's empty last line is, when the caret sits at its start: the empty paragraphs the gesture
 * left go and the block keeps the content before them. `undefined` when the caret is not on such a line, when an empty
 * line is all the block holds (a join, or `exitBlockBackward`'s empty block), and when no paragraph can follow the block.
 */
function containerEmptyLine(state: EditorState): EmptyLineExit | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  const paragraph = schemaNode(state.schema, "paragraph");
  if ($from.parent.type !== paragraph || $from.parent.content.size !== 0) return undefined;
  if ($from.parentOffset !== 0) return undefined;
  const depth = innermostContainer(state);
  // The caret's paragraph is the container's own child, so an empty line of a nested block is not this one's.
  if (depth === undefined || $from.depth !== depth + 1) return undefined;
  const container = $from.node(depth);
  // Only the container's last block is a trailing empty line: one with a block after it is a join.
  const index = $from.index(depth);
  if (index !== container.childCount - 1) return undefined;
  // Walk back over the empty paragraphs the gesture left, which are the block's trailing empty lines.
  let kept = index;
  while (kept > 0) {
    const before = container.child(kept - 1);
    if (before.type !== paragraph || before.content.size !== 0) break;
    kept -= 1;
  }
  // Nothing typed is nothing to keep: a block of empty lines is a join, never this exit.
  if (kept === 0 || container.child(kept - 1).content.size === 0) return undefined;
  const below = paragraphBelow(state, depth);
  if (!below) return undefined;
  let from = $from.start(depth);
  for (let child = 0; child < kept; child += 1) from += container.child(child).nodeSize;
  return { from, to: $from.end(depth), after: below.after, insert: below.insert };
}

/**
 * The exit a fence's empty last line is, when the caret ends the block's text and that text ends in newlines with text
 * before them: those newlines go and the caret moves to the paragraph below. `undefined` at any other end of a fence, so
 * Backspace keeps deleting characters and a fence holding nothing but newlines is never left this way.
 */
function codeEmptyLine(state: EditorState): EmptyLineExit | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if (!$from.parent.type.spec.code) return undefined;
  if ($from.parentOffset !== $from.parent.content.size) return undefined;
  const text = $from.parent.textContent;
  const kept = text.replace(/\n+$/u, "");
  if (kept === text || kept.length === 0) return undefined;
  const below = paragraphBelow(state, $from.depth);
  if (!below) return undefined;
  const end = $from.end();
  return { from: end - (text.length - kept.length), to: end, after: below.after, insert: below.insert };
}

/**
 * Backspace on the empty line Enter left, in a quote, a note or a fence: that line goes and the caret moves to a plain
 * paragraph below the block, the block's own content kept. One transaction, closed from the typed text's history event,
 * so one undo brings the block and the empty line back. `false` everywhere else, and in particular wherever the caret
 * would delete typed text, so `baseKeymap` goes on deleting a character as it always did.
 */
export const exitEmptyLineBackward: Command = (state, dispatch) => {
  const exit = containerEmptyLine(state) ?? codeEmptyLine(state);
  if (!exit) return false;
  if (dispatch) {
    const tr = state.tr.delete(exit.from, exit.to);
    const after = exit.after - (exit.to - exit.from);
    if (exit.insert) tr.insert(after, schemaNode(state.schema, "paragraph").create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
    dispatch(closeHistory(tr));
  }
  return true;
};

/**
 * Enter as an edit. It reports `false` in prose, where Enter sends: the caller sends then, never the editor.
 */
export const enterKey: Command = (state, dispatch, view) => {
  // A closing fence line ends the block instead of adding a line after it.
  if (closeCodeFence(state, dispatch, view)) return true;
  const action = enterPolicy(state);
  if (action === "block") return enterBlock(state, dispatch, view);
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

/**
 * Runs commands in order as the steps of one transaction: each sees the document the ones before it made, and the
 * operator's undo takes the whole action back at once. A command that does not apply is skipped, so a block action can be
 * written as the changes it may need; a command that dispatches several transactions (a lift out of each container) is
 * folded into the same one.
 */
export function sequence(...commands: readonly Command[]): Command {
  return (state, dispatch) => {
    let current = state;
    const built: Transaction[] = [];
    for (const command of commands) {
      command(current, (transaction) => {
        built.push(transaction);
        current = current.apply(transaction);
      });
    }
    if (built.length === 0) return false;
    if (!dispatch) return true;
    const combined = state.tr;
    for (const transaction of built) for (const step of transaction.steps) combined.step(step);
    // The last selection is resolved against the document the last step made, which is this one's content but not this
    // Node; an empty mapping puts it back on the transaction's own document.
    const last = built[built.length - 1]!;
    combined.setSelection(last.selection.map(combined.doc, new Mapping())).scrollIntoView();
    dispatch(closeHistory(combined));
    return true;
  };
}

/** The outermost depth at which an ancestor of `$from` carries one of these node names, when there is one. */
function outerDepth($from: ResolvedPos, names: ReadonlySet<string>): number | undefined {
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    if (names.has($from.node(depth).type.name)) return depth;
  }
  return undefined;
}

/** A quote, and nothing else: what the quote toggle moves the selection in and out of. */
const QUOTE_NAMES: ReadonlySet<string> = new Set(["blockquote"]);

/** A bullet or ordered list, the block the bullet-list toggle wraps and lifts. */
const LIST_NAMES: ReadonlySet<string> = new Set(["bullet_list", "ordered_list"]);

/** The block a block action changes around the selection (see `blockKindOf`). */
export type BlockKind = "paragraph" | "heading" | "quote" | "note" | "list" | "code";

/**
 * The block the block actions change: the fence or the heading the caret's own textblock is, else the outermost quote,
 * note or list holding the selection, else a plain paragraph. Every block toggle branches on it and every block button
 * reads its `aria-pressed` from it, so the button an operator sees pressed is the one their next press undoes.
 */
export function blockKindOf(state: EditorState): BlockKind {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) return "code";
  if ($from.parent.type === schemaNode(state.schema, "heading")) return "heading";
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const name = $from.node(depth).type.name;
    if (QUOTE_NAMES.has(name)) return "quote";
    if (name === "note") return "note";
    if (LIST_NAMES.has(name)) return "list";
  }
  return "paragraph";
}

/**
 * Whether the whole selection carries the mark `name`. At a caret it is the mark the next typed character would carry,
 * which is what makes the strip's button show what typing there means.
 */
export function markActive(state: EditorState, name: string): boolean {
  const type = schemaMark(state.schema, name);
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  let carries = false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!all) return false;
    // A hard break is inline but holds no text, so it carries no mark and is not part of "the whole selection".
    if (!node.isText) return true;
    if (type.isInSet(node.marks)) carries = true;
    else all = false;
    return false;
  });
  return all && carries;
}

/** The transaction that takes the block at `depth` out of its container: a lift where it can move up, and otherwise the
 * container replaced by the blocks it held, which is the only thing a quote at the top of the document allows. */
function unwrapAt(state: EditorState, depth: number): Transaction {
  const { $from } = state.selection;
  const from = $from.before(depth);
  const to = $from.after(depth);
  const range = new NodeRange(state.doc.resolve(from), state.doc.resolve(to), depth - 1);
  const target = liftTarget(range);
  if (target !== null) {
    const lifted = state.tr.lift(range, target);
    if (lifted.docChanged) return lifted.scrollIntoView();
  }
  const transaction = state.tr.replaceWith(from, to, $from.node(depth).content).scrollIntoView();
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(from + 1, transaction.doc.content.size))));
  return transaction;
}

/** Lifts the selection's blocks out of every container of these names, outermost first. */
function unwrapBlocks(names: ReadonlySet<string>): Command {
  return (state, dispatch) => {
    let current = state;
    let changed = false;
    // Four levels is more nesting than the dialect can express around one caret, and the loop ends when none is left.
    for (let level = 0; level < 4; level += 1) {
      const depth = outerDepth(current.selection.$from, names);
      if (depth === undefined) break;
      const transaction = unwrapAt(current, depth);
      current = current.apply(transaction);
      changed = changed || transaction.docChanged;
      dispatch?.(transaction);
    }
    return changed;
  };
}

/** Wraps the selected blocks in a block node of `name`. */
function wrapBlocks(name: string, attrs?: Record<string, unknown>): Command {
  return (state, dispatch, view) => wrapIn(schemaNode(state.schema, name), attrs)(state, dispatch, view);
}

/** Wraps the selected blocks in list items. */
const wrapList: Command = (state, dispatch, view) => wrapInList(schemaNode(state.schema, "bullet_list"))(state, dispatch, view);

/** Lifts the selection's list items out of their list, back to plain blocks. */
const liftList: Command = (state, dispatch, view) => (
  outerDepth(state.selection.$from, LIST_NAMES) === undefined
    ? false
    : liftListItem(schemaNode(state.schema, "list_item"))(state, dispatch, view)
);

/** The selected textblocks become plain paragraphs, whatever they were. */
const paragraphBlocks: Command = (state, dispatch, view) => setBlockType(schemaNode(state.schema, "paragraph"))(state, dispatch, view);

/** The outermost quote around the selection becomes a note of that kind, keeping the blocks it holds. */
const quoteToNote: Command = (state, dispatch) => {
  const depth = outerDepth(state.selection.$from, QUOTE_NAMES);
  if (depth === undefined) return false;
  const { $from } = state.selection;
  const note = schemaNode(state.schema, "note");
  const index = $from.index(depth - 1);
  if (!$from.node(depth - 1).canReplaceWith(index, index + 1, note)) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(depth), note, { kind: "note" }));
  return true;
};

/** Strikethrough: `~~the selection~~`, as `<s>` carries it. */
export const toggleStrike: Command = sequence((state, dispatch, view) => toggleMark(schemaMark(state.schema, "s"))(state, dispatch, view));

/** Quote: the selected blocks go into a quote, or the quote around them goes and they stay prose. */
export const toggleQuote: Command = (state, dispatch) => (
  blockKindOf(state) === "quote" ? sequence(unwrapBlocks(QUOTE_NAMES))(state, dispatch) : sequence(wrapBlocks("blockquote"))(state, dispatch)
);

/** Note: a quote around the selection becomes the note, and any other block is wrapped in one. */
export const makeNote: Command = (state, dispatch) => {
  const kind = blockKindOf(state);
  // A note is not a toggle: `Text` is what takes one away, so pressing Note inside one changes nothing.
  if (kind === "note") return false;
  if (kind === "quote") return sequence(quoteToNote)(state, dispatch);
  return sequence(wrapBlocks("note", { kind: "note" }))(state, dispatch);
};

/** Bullet list: the selected blocks become list items, or the list around them goes. */
export const toggleBulletList: Command = (state, dispatch) => (
  blockKindOf(state) === "list" ? sequence(liftList)(state, dispatch) : sequence(wrapList)(state, dispatch)
);

/** Code block: the selected blocks become a fence, or the fence the caret sits in goes back to a paragraph. */
export const toggleCodeBlock: Command = sequence(fenceSelection);

/** Text: the selected blocks lose the quote, note, list, fence or heading around them and are plain paragraphs. */
export const toPlainParagraph: Command = sequence(unwrapBlocks(CONTAINER_EXITS), liftList, paragraphBlocks);

/** The actions the selection toolbar draws, in the order it draws them. */
export type ComposerActionId =
  | "bold"
  | "italic"
  | "strike"
  | "inline-code"
  | "quote"
  | "note"
  | "bullet-list"
  | "code-block"
  | "text"
  | "cut"
  | "copy"
  | "paste";

/** One button of the toolbar: what it says, what it runs and what makes it look pressed or unavailable. */
export type ComposerAction = {
  id: ComposerActionId;
  /** The button's accessible name, and the whole of what it says. */
  label: string;
  /** The group the button is drawn in: the toolbar separates the groups. */
  group: "mark" | "block" | "clipboard";
  /** The command the button runs. Absent for the clipboard items, which the editor runs itself. */
  command?: Command;
  /** Whether the selection already carries the mark or the block: the button's `aria-pressed`. */
  pressed?: (state: EditorState) => boolean;
  /** Whether the action can act on the selection at all: the button's `disabled`. A dry run of `command` by default. */
  enabled?: (state: EditorState) => boolean;
};

/** Whether there is a selection to act on: what the clipboard items are available for. */
const hasSelection = (state: EditorState): boolean => !state.selection.empty;

/**
 * The toolbar's actions, which the strip draws and the editor runs: one row the buttons, the commands and the pressed
 * states come from, so a button can never run something other than what it shows.
 */
export const COMPOSER_ACTIONS: readonly ComposerAction[] = [
  { id: "bold", label: "Bold", group: "mark", command: toggleStrong, pressed: (state) => markActive(state, "strong") },
  { id: "italic", label: "Italic", group: "mark", command: toggleEmphasis, pressed: (state) => markActive(state, "em") },
  { id: "strike", label: "Strikethrough", group: "mark", command: toggleStrike, pressed: (state) => markActive(state, "s") },
  { id: "inline-code", label: "Inline code", group: "mark", command: toggleInlineCode, pressed: (state) => markActive(state, "code") },
  { id: "quote", label: "Quote", group: "block", command: toggleQuote, pressed: (state) => blockKindOf(state) === "quote" },
  { id: "note", label: "Note", group: "block", command: makeNote, pressed: (state) => blockKindOf(state) === "note" },
  { id: "bullet-list", label: "Bullet list", group: "block", command: toggleBulletList, pressed: (state) => blockKindOf(state) === "list" },
  { id: "code-block", label: "Code block", group: "block", command: toggleCodeBlock, pressed: (state) => blockKindOf(state) === "code" },
  { id: "text", label: "Text", group: "block", command: toPlainParagraph, pressed: (state) => blockKindOf(state) === "paragraph" },
  { id: "cut", label: "Cut", group: "clipboard", enabled: hasSelection },
  { id: "copy", label: "Copy", group: "clipboard", enabled: hasSelection },
  { id: "paste", label: "Paste", group: "clipboard", enabled: hasSelection },
];

/** One action's state on screen: whether the selection carries it, and whether it can act on the selection at all. */
export type ActionState = { pressed: boolean; disabled: boolean };

/** Every action's state, keyed by its id: what the toolbar's buttons show. */
export type FormatState = Readonly<Record<ComposerActionId, ActionState>>;

/**
 * What the toolbar shows for this selection: `aria-pressed` from the mark or block the action names, and the disabled
 * state from a dry run of the command itself — the same check the key makes, so a button is never offered for an edit
 * the document cannot take. The clipboard items carry no command; the toolbar answers for their availability.
 */
export function formatState(state: EditorState): FormatState {
  const entries = COMPOSER_ACTIONS.map((action) => [
    action.id,
    {
      pressed: action.pressed?.(state) ?? false,
      disabled: !(action.enabled?.(state) ?? action.command?.(state, undefined) ?? hasSelection(state)),
    },
  ] as const);
  return Object.fromEntries(entries) as FormatState;
}

export { redo, selectAll, undo };

/**
 * The composer's key bindings, for the view to install: Enter follows `enterPolicy` (sending through `onSend`),
 * Shift+Enter hard-breaks, ArrowDown leaves a fence at its end, Backspace on the empty line Enter left leaves a quote, a
 * note or a fence and Backspace at an empty heading's or container's start makes it prose, Tab and Shift+Tab indent code
 * or change a list's depth, and the formatting chords and history are bound to the commands above. `formatting` says
 * whether the chords act; while it is false a chord is consumed without a transaction. A consumed key is handled, so the
 * view prevents its default action and the browser's own bold, italic or code command does not run for it.
 */
export function richKeymap(options: { onSend: () => void; formatting?: () => boolean }): Plugin {
  const formatting = options.formatting ?? (() => true);
  const chord = (command: Command): Command => (state, dispatch, view) => (formatting() ? command(state, dispatch, view) : true);
  return keymap({
    Enter: (state, dispatch, view) => enterPolicy(state) === "send" ? (options.onSend(), true) : enterKey(state, dispatch, view),
    "Shift-Enter": chainCommands(codeBlockNewline, newline),
    "Mod-Enter": sendKey(options.onSend),
    ArrowDown: exitCodeBlockDown,
    Backspace: chainCommands(exitEmptyLineBackward, exitBlockBackward),
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
