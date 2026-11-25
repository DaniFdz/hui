/**
 * The composer's rich editor: the DOM glue that binds one composer surface — the `.agent-chat__composer-combobox` a view
 * renders — to the ProseMirror document the rest of this directory defines, and keeps the form's hidden field carrying
 * the Markdown wire.
 *
 * One host holds two things: a `div.ProseMirror` contenteditable, the only surface the operator edits, and the hidden
 * input the form submits (`name="text"` in the chat, `name="prompt"` on New Session). The visible editor carries
 * rendered text; only the hidden field carries Markdown, so a send never has to read the DOM. An unedited draft sends the
 * exact source it was loaded with, and a rich edit sends `serializeMarkdown`'s canonical form. A draft that ends on a
 * blank line keeps an empty paragraph there, so the caret and the operator's next word sit below the quote they loaded,
 * not inside it.
 *
 * A draft the schema cannot hold (raw HTML, a table, math, an image, a link reference, a `session:` chip) is a
 * literal draft instead. It loads as its own text, one paragraph with every marker and pipe visible, and the hidden field
 * keeps its exact bytes until the operator edits it. A literal draft is never formatted as it is typed: typed, pasted and
 * dropped text enter as plain text and line breaks, the input rules are off, and the formatting chords do nothing. So
 * every character the editor shows is one the wire carries, and after an edit the wire is that text (`literalWire`), not
 * the serializer's rewrite. The trade-off is deliberate: an unrepresentable draft sends what it shows, but editing it
 * cannot turn it into formatting. It stays literal until a load of a draft the schema can hold replaces it (a send's
 * clear, a rewind, a restored draft).
 *
 * Keys, paste and typing are the integration's: `onBeforeKeyDown` runs first so the slash and mention menus answer a key
 * before Enter, Tab or a formatting chord. `enterPolicy` decides whether Enter is an edit (a list split, a list exit, a
 * newline in a fence, the block change a quote, a note or a heading takes) or the send `composerEnterMode` names, a
 * paragraph that is only a fence opens a code block and one that is only a note marker opens that note before either,
 * Shift+Enter always inserts one hard break, and Mod-Enter always sends. A quote, a note and a heading are never sent
 * from, on a phone either: their Enter is the block command below, never the line break prose gets there. Tab, Shift+Tab
 * and the formatting chords are `keys.ts`'. The app re-reads its completion queries from the caret, so a position it has
 * already read is not reported again: the keyup of an Enter that took a suggestion must not reopen the menu that choice
 * just closed.
 *
 * A secondary click over a selection — or the keyboard's ContextMenu key, Shift+F10 — opens the selection toolbar
 * (`toolbar.ts`) instead of the browser menu, on a fine pointer that reports no touch only: a phone, and a touch laptop
 * whose long press is still the platform's menu, keep their own, which is where their cut, copy and paste live. The strip
 * is the editor's, not the view's: it acts on the selection the editor holds, an action of its own keeps it open over the
 * result (`#toolbarAction`) without reading the clipboard again, and anything else that moves the caret, scrolls, presses
 * outside it or empties the selection closes it. Escape closes it too, and one press is enough while it is open: the
 * editor answers the key on the document's capture phase (`#listenStripEscape`), ahead of the tooltip a button the
 * keyboard focus grew and of the strip's own handler, and gives the editor its focus back.
 */
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { closeHistory, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Fragment, Slice, type Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { PromptMode } from "../../../api/sessions.ts";
import { composerEnterMode } from "../state.ts";
import {
  COMPOSER_ACTIONS,
  codeBlockNewline,
  enterKey,
  enterPolicy,
  formatState,
  newline,
  openCodeFence,
  openNote,
  richKeymap,
  type ComposerActionId,
  type FormatState,
} from "./keys.ts";
import { literalDocument, literalInline, literalWire, parseMarkdown, serializeMarkdown, sourceMode } from "./markdown.ts";
import { htmlSlice, plainTextSlice } from "./paste.ts";
import { richInputRules } from "./rules.ts";
import { richSchema, schemaNode } from "./schema.ts";
import { ComposerToolbar, type ToolbarAnchor } from "./toolbar.ts";

/** The composer as the controller and the view's own glue see it. */
export type ComposerControl = {
  /** The wire the form sends: the loaded source, the serializer's output, or a literal draft's text. */
  markdown(): string;
  /** The current textblock's text, with a leading newline when it is not the document's first block. */
  text(): string;
  /** The selection in `text()`'s coordinates. */
  selection(): { start: number; end: number };
  /** Replaces `[from, to)` of `text()` and puts the caret at `caret`; one transaction, never a whole-document rewrite. */
  replaceRange(from: number, to: number, insert: string, caret: number): void;
  focus(): void;
  caretAtEnd(): void;
  editable(): boolean;
  /** Whether a key or focus event came from this composer. */
  isTarget(target: Node | null): boolean;
};

/** Everything one render hands the editor. A changed `markdown` reloads the draft; anything else patches in place. */
export type ComposerEditorOptions = {
  /** The hidden field's name: `text` in the chat, `prompt` on New Session. */
  name: "text" | "prompt";
  /** The accessible name of the editing surface, and of the hidden field's label. */
  label: string;
  placeholder: string;
  /** The draft's Markdown wire. */
  markdown: string;
  /** A send, a start or a boot in flight: the composer takes no edits. */
  locked: boolean;
  /** Whether a run is in flight, which is what plain Enter means while it is. */
  streaming: boolean;
  /** The operator's Enter preference; `modifierEnter` leaves plain Enter as a line break. */
  sendShortcut?: "enter" | "modifierEnter";
  /** The `aria-keyshortcuts` the chat composer announces. */
  keyShortcuts?: string;
  /** The completion menus the editor announces on the surface. */
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaActiveDescendant?: string;
  /** The id the surface carries, such as `launch-prompt`. */
  id?: string;
  onChange(markdown: string): void;
  onSelection(): void;
  /** The slash and mention menus, before the editor reads the key itself. */
  onBeforeKeyDown(event: KeyboardEvent): void;
  onSubmit(mode: PromptMode): void;
  /** Images and pasted long text the composer turns into attachments. True when it took the clipboard. */
  onPaste(event: ClipboardEvent): boolean;
  onFocus?(): void;
  onBlur?(event: FocusEvent): void;
};

/** One mounted composer. `update` is idempotent: a render may call it as often as it likes. */
export type ComposerEditor = {
  control: ComposerControl;
  update(options: ComposerEditorOptions): void;
  /** Loads an external draft — a send clear, a rewind, a quote, a share seed, a recovered draft. */
  setMarkdown(source: string): void;
  focus(): void;
  caretAtEnd(): void;
  destroy(): void;
};

const editors = new WeakMap<HTMLElement, ComposerEditor>();

/** The editor mounted on `host`, if one is. A render asks this instead of holding the instance across renders. */
export function composerEditorFor(host: HTMLElement): ComposerEditor | undefined {
  return editors.get(host);
}

/** Mounts the editor once per host and updates it after: a render may call this on every pass. */
export function mountComposerEditor(host: HTMLElement, options: ComposerEditorOptions): ComposerEditor {
  const existing = editors.get(host);
  if (existing) {
    existing.update(options);
    return existing;
  }
  const editor = new ComposerEditorImpl(host, options);
  editors.set(host, editor);
  return editor;
}

/** A phone or a tablet: plain Enter is a line break there, whatever the preference says. */
function coarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true || navigator.maxTouchPoints > 0;
}

/** A mouse or a trackpad, and no touch at all: the pointer that gets a formatting toolbar instead of the platform's own
 * menu. A touch laptop or a tablet with a trackpad matches `(pointer: fine)` as well, and its long press is still the
 * platform's menu, so a device that reports any touch keeps the menu it has. */
export function stripPointer(pointer: { fine: boolean; coarse: boolean }): boolean {
  return pointer.fine && !pointer.coarse;
}

/** Whether this device's secondary click opens the strip rather than the platform's menu (`stripPointer`). */
function finePointer(): boolean {
  if (typeof window === "undefined") return false;
  return stripPointer({ fine: window.matchMedia?.("(pointer: fine)").matches === true, coarse: coarsePointer() });
}

/** An empty draft: one paragraph, which is what a cleared composer shows. */
function emptyDocument(): ProseMirrorNode {
  return schemaNode(richSchema, "doc").create(null, schemaNode(richSchema, "paragraph").create());
}

/** Whether the wire ends on a blank line: the operator's own place to write, below a quote or a list. */
function endsOnBlankLine(source: string): boolean {
  return /\n[ \t]*\n$/u.test(source);
}

/**
 * The document a loaded draft becomes. A source that ends on a blank line — a reply's quote — keeps one empty paragraph
 * there, because Markdown has nowhere else to put the operator's caret: a blockquote's last line would otherwise take the
 * first thing the operator types. The serializer writes no line for it.
 */
function draftDocument(source: string): ProseMirrorNode {
  const doc = source === "" ? emptyDocument() : parseMarkdown(source);
  if (!endsOnBlankLine(source)) return doc;
  const last = doc.lastChild;
  if (last === null || (last.type === richSchema.nodes.paragraph && last.content.size === 0)) return doc;
  const blocks: ProseMirrorNode[] = [];
  doc.forEach((block) => blocks.push(block));
  blocks.push(schemaNode(richSchema, "paragraph").create());
  return doc.type.create(doc.attrs, blocks);
}

/** Whether a pasted slice holds anything a plain-text paste would lose: a block that is not a paragraph, a mark, or a
 * node that is not text. A paste of plain paragraphs takes the literal path instead, so its Markdown stays text. */
function hasStructure(slice: Slice): boolean {
  let structured = false;
  slice.content.forEach((block) => {
    if (block.type !== richSchema.nodes.paragraph) {
      structured = true;
      return;
    }
    block.forEach((inline) => {
      if (inline.marks.length > 0 || inline.type !== richSchema.nodes.text) structured = true;
    });
  });
  return structured;
}

/** Shift+Enter: one newline inside a fence, one hard break everywhere else. */
const hardBreak: Command = chainCommands(codeBlockNewline, newline);

class ComposerEditorImpl implements ComposerEditor {
  readonly control: ComposerControl = {
    markdown: () => this.#hidden.value,
    text: () => this.#text(),
    selection: () => this.#selection(),
    replaceRange: (from, to, insert, caret) => this.#replaceRange(from, to, insert, caret),
    focus: () => this.focus(),
    caretAtEnd: () => this.caretAtEnd(),
    editable: () => !this.#options.locked,
    isTarget: (target) => this.#isTarget(target),
  };
  readonly #host: HTMLElement;
  readonly #view: EditorView;
  readonly #hidden: HTMLInputElement;
  readonly #toolbar: ComposerToolbar;
  readonly #plugins: readonly Plugin[];
  readonly #events = new AbortController();
  #options: ComposerEditorOptions;
  /** Whether the document is a literal draft: its text is the wire, and no rule or chord formats it. */
  #literal = false;
  #destroyed = false;
  /** The lock the view's `editable` prop was last set from, and the attributes the surface carries. */
  #locked: boolean;
  #applied: readonly string[] = [];
  /** The selection the app last read, so a key or click that moved nothing asks for no read of its own. */
  #reported: string | null = null;
  /** The selection the open toolbar belongs to: a caret that moves away from it is not the strip's any more. */
  #toolbarSelection: EditorState["selection"] | undefined;
  /** Whether the transaction being dispatched is the toolbar's own, which re-anchors it instead of closing it. */
  #toolbarAction = false;
  /** The document listener that answers Escape for the open strip: it lives exactly as long as the strip is open. */
  #stripEscape: AbortController | undefined;
  /** Set while an action's own `scrollIntoView` is still settling: that scroll is the action's, not the operator's. */
  #ownScroll = false;
  #ownScrollFrame: number | null = null;
  #scrollObserver: ResizeObserver | undefined;
  #scrollFrame: number | null = null;

  constructor(host: HTMLElement, options: ComposerEditorOptions) {
    this.#host = host;
    this.#options = options;
    this.#locked = options.locked;
    this.#toolbar = new ComposerToolbar({
      run: (action) => this.#run(action),
      insertText: (text) => this.#pasteText(text),
      focusEditor: () => this.focus(),
      closed: () => {
        this.#toolbarSelection = undefined;
        this.#listenStripEscape(false);
      },
    });
    this.#plugins = [
      history(),
      richInputRules(richSchema, () => !this.#literal),
      richKeymap({ onSend: () => this.#send(this.#enterMode()), formatting: () => !this.#literal }),
      keymap(baseKeymap),
    ];
    this.#view = new EditorView(host, {
      state: this.#state(emptyDocument()),
      editable: () => !this.#options.locked,
      dispatchTransaction: (transaction) => this.#dispatch(transaction),
      handleKeyDown: (view, event) => this.#keyDown(view, event),
      handleTextInput: (view, from, to, text) => this.#textInput(view, from, to, text),
      handlePaste: (view, event) => this.#paste(view, event),
      handleDrop: (view, event, _slice, moved) => this.#drop(view, event, moved),
      handleDOMEvents: {
        focus: () => {
          this.#options.onFocus?.();
          return false;
        },
        blur: (_view, event) => {
          this.#options.onBlur?.(event as FocusEvent);
          return false;
        },
        // A secondary click over a selection is the strip's, and only on a fine pointer: a phone keeps its own menu.
        contextmenu: (_view, event) => this.#contextMenu(event as MouseEvent),
        // The keyboard's own menu key arrives before the keymaps, so the strip answers it rather than the document.
        keydown: (_view, event) => this.#menuKey(event as KeyboardEvent),
      },
      attributes: () => this.#attributes(),
    });
    this.#hidden = document.createElement("input");
    this.#hidden.type = "hidden";
    this.#hidden.name = options.name;
    this.#hidden.dataset.testid = "composer-markdown";
    host.append(this.#hidden);
    this.#listen();
    this.#syncSurface();
    this.setMarkdown(options.markdown);
    // A ref runs before its element is connected, so the measured height waits for the commit: once in a microtask, and
    // once more on the next frame for a host that was still detached at the microtask.
    queueMicrotask(() => this.#afterMount());
    requestAnimationFrame(() => this.#afterMount());
  }

  /** The part of a mount that needs the element in the document: its measured height. Idempotent. */
  #afterMount(): void {
    if (this.#destroyed) return;
    this.#measureScroll();
  }

  update(options: ComposerEditorOptions): void {
    if (this.#destroyed) return;
    this.#options = options;
    if (options.markdown !== this.#hidden.value) this.setMarkdown(options.markdown);
    this.#syncSurface();
  }

  setMarkdown(source: string): void {
    if (this.#destroyed) return;
    this.#hidden.value = source;
    // A draft the schema cannot hold loads as its own text (see the module header); any other draft loads as a document.
    if (source !== "" && sourceMode(source)) this.#load(literalDocument(source), true);
    else this.#load(draftDocument(source), false);
    this.#syncSurface();
    this.#syncEmpty();
  }

  focus(): void {
    if (this.#destroyed) return;
    this.#view.focus();
  }

  caretAtEnd(): void {
    if (this.#destroyed) return;
    const { state } = this.#view;
    const end = TextSelection.atEnd(state.doc);
    if (!state.selection.eq(end)) this.#view.dispatch(state.tr.setSelection(end));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#events.abort();
    this.#listenStripEscape(false);
    this.#toolbar.destroy();
    this.#toolbarSelection = undefined;
    if (this.#ownScrollFrame !== null) cancelAnimationFrame(this.#ownScrollFrame);
    this.#ownScrollFrame = null;
    this.#scrollObserver?.disconnect();
    this.#scrollObserver = undefined;
    if (this.#scrollFrame !== null) cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = null;
    this.#view.destroy();
    this.#hidden.remove();
    if (editors.get(this.#host) === this) editors.delete(this.#host);
  }

  /** A fresh state: a loaded draft starts with empty history, so undo never walks back to a previous draft. */
  #state(doc: ProseMirrorNode): EditorState {
    return EditorState.create({ doc, schema: richSchema, selection: TextSelection.atEnd(doc), plugins: this.#plugins });
  }

  #dispatch(transaction: Transaction): void {
    const state = this.#view.state.apply(transaction);
    this.#view.updateState(state);
    // A transaction is a change the app has not read yet, whether it moved the caret or rewrote the text under it.
    if (!transaction.docChanged) {
      this.#reportSelection(true);
      this.#followSelection();
      return;
    }
    // A rich edit's wire is the serializer's own Markdown; a literal draft's is the text its document shows.
    this.#hidden.value = this.#literal ? literalWire(state.doc) : serializeMarkdown(state.doc);
    this.#syncEmpty();
    this.#measureScroll();
    this.#options.onChange(this.#hidden.value);
    this.#reportSelection(true);
    this.#followSelection();
  }

  /**
   * The toolbar follows the selection it was opened on: an action of its own re-anchors it over the result and keeps it
   * open, and any other transaction — a keystroke, a click, a paste — closes it, because the selection it shows is not
   * the selection any more. A collapsed selection has nothing to format: the strip goes with it.
   */
  #followSelection(): void {
    if (this.#toolbarSelection === undefined) return;
    if (this.#toolbarAction) {
      this.#anchorToolbar();
      return;
    }
    this.#closeToolbar();
  }

  /**
   * The app re-reads its completion queries from the caret, so one report per position is enough: a key or a click the
   * browser answered without a transaction asks again only when the caret actually moved. Pressing Enter to take a
   * suggestion writes it in a transaction, and the key's own keyup must not reopen the menu that choice just closed.
   */
  #reportSelection(force = false): void {
    const { start, end } = this.#selection();
    const key = `${start}:${end}`;
    if (!force && key === this.#reported) return;
    this.#reported = key;
    this.#options.onSelection();
  }

  /** Loads a document as a fresh state, and says whether it is a literal draft. The app's last read no longer applies. */
  #load(doc: ProseMirrorNode, literal: boolean): void {
    // A loaded draft is a new document: the strip over the old selection has nowhere to be.
    this.#closeToolbar();
    this.#literal = literal;
    this.#view.updateState(this.#state(doc));
    this.#reported = null;
  }

  /** The selection's textblock, with the position its content starts at and the newline that prefixes `text()`. */
  #block(): { node: ProseMirrorNode; start: number; prefix: string } {
    const state = this.#view.state;
    const { $from } = state.selection;
    if ($from.parent.isTextblock) {
      return { node: $from.parent, start: $from.start($from.depth), prefix: $from.before($from.depth) === 0 ? "" : "\n" };
    }
    // A whole-document or node selection reports the first textblock, so a completion never reads a draft nobody saw.
    let found: { node: ProseMirrorNode; start: number } | undefined;
    state.doc.descendants((node, position) => {
      if (found) return false;
      if (!node.isTextblock) return true;
      found = { node, start: position + 1 };
      return false;
    });
    if (!found) return { node: state.doc, start: 0, prefix: "" };
    const first: { node: ProseMirrorNode; start: number } = found;
    return { ...first, prefix: first.start === 1 ? "" : "\n" };
  }

  #text(): string {
    const { node, prefix } = this.#block();
    // A hard break is one character of the text the completions read, so offsets stay in the operator's coordinates.
    return prefix + node.textBetween(0, node.content.size, undefined, "\n");
  }

  #selection(): { start: number; end: number } {
    const { node, prefix } = this.#block();
    const { $from, $to } = this.#view.state.selection;
    const start = prefix.length + ($from.parent === node ? $from.parentOffset : 0);
    const end = prefix.length + ($to.parent === node ? $to.parentOffset : node.content.size);
    return { start, end: Math.max(start, end) };
  }

  #replaceRange(from: number, to: number, insert: string, caret: number): void {
    const { node, start, prefix } = this.#block();
    const position = (offset: number) => start + Math.max(0, Math.min(node.content.size, offset - prefix.length));
    const head = position(from);
    const tail = position(Math.max(from, to));
    const transaction = this.#view.state.tr.insertText(insert, head, tail);
    const at = Math.max(0, Math.min(transaction.doc.content.size, head + Math.max(0, caret - from)));
    transaction.setSelection(TextSelection.create(transaction.doc, at));
    this.#view.dispatch(transaction.scrollIntoView());
    this.#view.focus();
  }

  #isTarget(target: Node | null): boolean {
    return target !== null && this.#view.dom.contains(target);
  }

  /**
   * The selection's box in viewport coordinates: the union of where it starts and where it ends, which is what the strip
   * is anchored to. `undefined` for a caret, which has nothing to format and keeps the platform's own menu.
   */
  #selectionRect(): ToolbarAnchor | undefined {
    const { selection } = this.#view.state;
    if (selection.empty) return undefined;
    const start = this.#view.coordsAtPos(selection.from, 1);
    const end = this.#view.coordsAtPos(selection.to, -1);
    return {
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    };
  }

  /** What the strip shows for the selection. A literal draft takes no formatting, so only its clipboard items act. */
  #formatState(): FormatState {
    const state = formatState(this.#view.state);
    if (!this.#literal) return state;
    const entries = COMPOSER_ACTIONS.map((action) => [action.id, {
      pressed: false,
      disabled: action.group === "clipboard" ? state[action.id].disabled : true,
    }] as const);
    return Object.fromEntries(entries) as FormatState;
  }

  /**
   * Runs one action of the strip as a single transaction, so its wire and the app's change callback follow at once and
   * one undo takes it back. Its own transaction keeps the strip open (`#followSelection`).
   */
  #run(action: ComposerActionId): void {
    if (this.#destroyed) return;
    const item = COMPOSER_ACTIONS.find((candidate) => candidate.id === action);
    // A literal draft's text is its wire: a mark or a block change has no spelling in it, so nothing formats it.
    if (!item?.command || this.#literal) return;
    this.#toolbarAction = true;
    // An action scrolls its result into view, and that scroll is not the operator scrolling the strip away.
    this.#ownScroll = true;
    if (this.#ownScrollFrame !== null) cancelAnimationFrame(this.#ownScrollFrame);
    this.#ownScrollFrame = requestAnimationFrame(() => {
      this.#ownScroll = false;
      this.#ownScrollFrame = null;
    });
    try {
      item.command(this.#view.state, (transaction) => this.#dispatch(closeHistory(transaction)));
    } finally {
      this.#toolbarAction = false;
    }
  }

  /** Plain text from the strip's Paste, through the paste mapping: its lines become paragraphs and breaks. */
  #pasteText(text: string): void {
    if (this.#destroyed || text === "") return;
    const slice = this.#literal
      ? new Slice(Fragment.from(literalInline(text)), 0, 0)
      : plainTextSlice(richSchema, text);
    if (slice.size === 0) return;
    this.#view.dispatch(this.#view.state.tr.replaceSelection(slice).scrollIntoView());
    this.#view.focus();
  }

  /** Opens the strip over the selection, or leaves the platform's menu alone when there is nothing to format. */
  #openToolbar(focus: boolean): boolean {
    const rect = this.#selectionRect();
    if (!rect) return false;
    this.#toolbarSelection = this.#view.state.selection;
    this.#toolbar.open(rect, this.#formatState(), { focus });
    this.#listenStripEscape(true);
    return true;
  }

  /** Re-places the open strip over the selection its own action left, without reading the clipboard again. */
  #anchorToolbar(): void {
    const rect = this.#selectionRect();
    if (!rect) {
      this.#closeToolbar();
      return;
    }
    this.#toolbarSelection = this.#view.state.selection;
    this.#toolbar.reanchor(rect, this.#formatState());
  }

  #closeToolbar(): void {
    this.#toolbarSelection = undefined;
    this.#listenStripEscape(false);
    this.#toolbar.close();
  }

  /** Whether the caret is on the selection the open strip belongs to. */
  #sameSelection(): boolean {
    const captured = this.#toolbarSelection;
    if (!captured) return true;
    const { selection } = this.#view.state;
    return !selection.empty && selection.eq(captured);
  }

  /** Closes the strip once its selection is not the selection any more: a caret that moved, or one that went away. */
  #selectionMoved(): void {
    if (this.#toolbarSelection === undefined) return;
    if (!this.#sameSelection()) this.#closeToolbar();
  }

  /**
   * A secondary click over a selection opens the strip instead of the browser menu, and only on a fine pointer: a phone
   * keeps its own long-press menu, which is where cut, copy and paste are there. An empty selection falls through too,
   * because the platform's menu is what pastes into a caret.
   */
  #contextMenu(event: MouseEvent): boolean {
    if (!finePointer()) return false;
    if (!this.#openToolbar(false)) return false;
    event.preventDefault();
    return true;
  }

  /** The keyboard's menu key: the same strip, with focus moved onto it, because a key press has no pointer to aim. */
  #menuKey(event: KeyboardEvent): boolean {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
    if (!finePointer()) return false;
    if (!this.#openToolbar(true)) return false;
    event.preventDefault();
    return true;
  }

  /** What Enter means right now, from the operator's device, preference and the running turn. */
  #enterMode(shiftKey = false, ctrlKey = false, metaKey = false): PromptMode | "newline" | undefined {
    return composerEnterMode({
      streaming: this.#options.streaming,
      shiftKey,
      ctrlKey,
      metaKey,
      isComposing: false,
      coarsePointer: coarsePointer(),
      sendShortcut: this.#options.sendShortcut,
    });
  }

  #send(mode: PromptMode | "newline" | undefined): void {
    if (!mode || mode === "newline") return;
    this.#options.onSubmit(mode);
  }

  #keyDown(view: EditorView, event: KeyboardEvent): boolean {
    this.#options.onBeforeKeyDown(event);
    if (event.defaultPrevented) return true;
    if (view.composing || event.isComposing) return false;
    // Escape is the open strip's own (`#listenStripEscape`), answered before this handler, so every key here is the
    // keymap's: a literal draft's formatting chords are consumed there.
    if (event.key !== "Enter" || event.altKey) return false;
    // Shift+Enter is always one hard break, and Mod-Enter always sends, whatever the cursor sits in.
    if (event.shiftKey) return this.#edit(view, hardBreak);
    if (event.metaKey || event.ctrlKey) {
      this.#send(this.#enterMode(false, event.ctrlKey, event.metaKey));
      return true;
    }
    // A fence opens the block Enter would otherwise send or break, and so does a note's marker; a literal draft keeps
    // its own markers.
    if (!this.#literal && openCodeFence(view.state, view.dispatch, view)) return true;
    if (!this.#literal && openNote(view.state, view.dispatch, view)) return true;
    const mode = this.#enterMode();
    // A coarse pointer, or the modifier-Enter preference, keeps plain Enter an edit.
    if (mode === undefined) return false;
    if (mode !== "newline" && enterPolicy(view.state) === "send") {
      this.#options.onSubmit(mode);
      return true;
    }
    // A quote's or a heading's Enter is an edit on every device: `enterKey` takes it as the block change it is, so on a
    // coarse pointer, where Enter is otherwise a line break, the block command runs rather than the hard break below.
    return this.#edit(view, enterKey);
  }

  /** Runs an edit command, and gives prose the line break the command leaves alone. */
  #edit(view: EditorView, command: Command): boolean {
    if (command(view.state, view.dispatch, view)) return true;
    return hardBreak(view.state, view.dispatch, view);
  }

  #textInput(view: EditorView, from: number, to: number, text: string): boolean {
    // A literal draft takes typed text as it is: no rule runs and no stored mark is applied, so the text stays the wire.
    if (this.#literal) {
      view.dispatch(view.state.tr.replaceWith(from, to, literalInline(text)).scrollIntoView());
      return true;
    }
    // A multi-line fill or a pasted block arrives as one insertion: its newlines become hard breaks, never Markdown.
    if (!text.includes("\n")) return false;
    const { state } = view;
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const content: ProseMirrorNode[] = [];
    for (const [index, line] of text.split("\n").entries()) {
      if (index > 0) content.push(schemaNode(richSchema, "hard_break").create());
      if (line) content.push(richSchema.text(line, marks));
    }
    view.dispatch(state.tr.replaceWith(from, to, content).scrollIntoView());
    return true;
  }

  #paste(view: EditorView, event: ClipboardEvent): boolean {
    if (this.#options.onPaste(event)) return true;
    const data = event.clipboardData;
    if (!data) return false;
    if (this.#literal) {
      // A literal draft takes the clipboard's plain text, as a textarea does: pasted markup would bring marks the wire drops.
      const text = data.getData("text/plain");
      if (text) view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(literalInline(text)), 0, 0)).scrollIntoView());
      return true;
    }
    const html = data.getData("text/html");
    const plain = data.getData("text/plain");
    const mapped = html ? htmlSlice(richSchema, html) : undefined;
    const slice = mapped && (hasStructure(mapped) || !plain) ? mapped : plain ? plainTextSlice(richSchema, plain) : undefined;
    if (!slice || slice.size === 0) return false;
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    return true;
  }

  /** A literal draft takes dropped text as plain text, as its paste does. A move inside the draft, and files, are not its. */
  #drop(view: EditorView, event: DragEvent, moved: boolean): boolean {
    if (!this.#literal || moved || !event.dataTransfer || event.dataTransfer.files.length > 0) return false;
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain");
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (text && at) view.dispatch(view.state.tr.insert(at.pos, literalInline(text)).scrollIntoView());
    view.focus();
    return true;
  }

  #listen(): void {
    const signal = this.#events.signal;
    for (const type of ["click", "select", "keyup"] as const) {
      // A caret this browser moved without a transaction (a click, an arrow key) still has to re-read the completions.
      this.#view.dom.addEventListener(type, () => {
        this.#reportSelection();
        this.#selectionMoved();
      }, { signal });
    }
    // The strip is drawn outside this element, so its own listeners are the document's, and each one asks first whether
    // the strip is showing: a closed strip follows nothing.
    document.addEventListener("selectionchange", () => this.#selectionMoved(), { signal });
    document.addEventListener("pointerdown", (event) => {
      if (this.#toolbarSelection === undefined) return;
      const target = event.target;
      if (target instanceof Node && this.#toolbar.element().contains(target)) return;
      this.#closeToolbar();
    }, { capture: true, signal });
    document.addEventListener("scroll", () => {
      if (this.#toolbarSelection === undefined || this.#ownScroll) return;
      this.#closeToolbar();
    }, { capture: true, passive: true, signal });
  }

  /**
   * The strip's Escape, registered while it is open and taken away the moment it closes. It answers on the document's
   * capture phase, ahead of everything the strip drew: a button the keyboard focus grew shows HUI's tooltip
   * (`components/badge-hovercard.ts`), and a tooltip takes Escape first wherever it is open, so a listener on the strip
   * or in the editor would only ever see the second press. One press closes the strip and gives the editor its focus
   * back, whether the pointer or the keyboard opened it.
   */
  #listenStripEscape(open: boolean): void {
    if (!open) {
      this.#stripEscape?.abort();
      this.#stripEscape = undefined;
      return;
    }
    if (this.#stripEscape) return;
    const controller = new AbortController();
    this.#stripEscape = controller;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || this.#toolbarSelection === undefined) return;
      // A key pressed somewhere else — a dialog opened over the composer — is that surface's Escape, not the strip's.
      const target = event.target;
      if (target instanceof Node && !this.#view.dom.contains(target) && !this.#toolbar.element().contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      this.#closeToolbar();
      this.focus();
    }, { capture: true, signal: controller.signal });
  }

  /** The surface's identity: the combobox attributes and the id it carries, and the lock the editor applies to it. */
  #syncSurface(): void {
    if (this.#destroyed) return;
    const { id, locked } = this.#options;
    const rich = this.#view.dom;
    const attributes = this.#attributes();
    for (const name of this.#applied) if (!(name in attributes)) rich.removeAttribute(name);
    for (const [name, value] of Object.entries(attributes)) rich.setAttribute(name, value);
    this.#applied = Object.keys(attributes);
    rich.removeAttribute("id");
    if (id) rich.id = id;
    if (this.#locked !== locked) {
      this.#locked = locked;
      this.#view.setProps({ editable: () => !locked });
    }
  }

  #attributes(): Record<string, string> {
    const { label, placeholder, locked, keyShortcuts, ariaExpanded, ariaControls, ariaActiveDescendant } = this.#options;
    const attributes: Record<string, string> = {
      role: "combobox",
      "aria-multiline": "true",
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "aria-label": label,
      "aria-placeholder": placeholder,
      // The rich surface is not a form control, so the sheet draws its own placeholder from `data-placeholder`; the
      // `placeholder` attribute is there because a control found by placeholder is how a test and an operator reach the
      // draft.
      placeholder,
      dir: "auto",
      "data-placeholder": placeholder,
    };
    if (keyShortcuts) attributes["aria-keyshortcuts"] = keyShortcuts;
    // A locked composer takes no edits: a contenteditable cannot be disabled the way a textarea could, so it says so the
    // way ARIA spells it, and a control that reads the disabled state still finds it.
    if (locked) attributes["aria-disabled"] = "true";
    if (ariaExpanded !== undefined) attributes["aria-expanded"] = String(ariaExpanded);
    if (ariaControls) attributes["aria-controls"] = ariaControls;
    if (ariaActiveDescendant) attributes["aria-activedescendant"] = ariaActiveDescendant;
    return attributes;
  }

  /** The placeholder shows while the rich document holds no text at all. */
  #syncEmpty(): void {
    this.#view.dom.toggleAttribute("data-empty", this.#view.state.doc.textContent === "");
  }

  /** A scrollable draft keeps the sheet's fade; measured after a frame, never from inside a transaction. */
  #measureScroll(): void {
    if (this.#destroyed) return;
    if (typeof ResizeObserver === "function" && !this.#scrollObserver) {
      this.#scrollObserver = new ResizeObserver(() => this.#measureScroll());
      this.#scrollObserver.observe(this.#view.dom);
    }
    if (this.#scrollFrame !== null) return;
    this.#scrollFrame = requestAnimationFrame(() => {
      this.#scrollFrame = null;
      if (this.#destroyed) return;
      const dom = this.#view.dom;
      const scrollable = dom.scrollHeight > dom.clientHeight + 1;
      dom.toggleAttribute("data-scrollable", scrollable);
      dom.toggleAttribute("data-scroll-fade-top", scrollable && dom.scrollTop > 1);
      dom.toggleAttribute("data-scroll-fade-bottom", scrollable && dom.scrollTop + dom.clientHeight < dom.scrollHeight - 1);
    });
  }
}
