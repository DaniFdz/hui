/**
 * The composer's rich editor: the DOM glue that binds one composer surface — the `.agent-chat__composer-combobox` a view
 * renders — to the ProseMirror document the rest of this directory defines, and keeps the form's hidden field carrying
 * the Markdown wire.
 *
 * One host holds three things: a `div.ProseMirror` contenteditable, a source `<textarea>` for a draft the schema cannot
 * represent, and the hidden input the form submits (`name="text"` in the chat, `name="prompt"` on New Session). The
 * visible editor carries rendered text; only the hidden field carries Markdown, so a send never has to read the DOM. An
 * unedited draft sends the exact source it was loaded with, a rich edit sends `serializeMarkdown`'s canonical form, and
 * an edit in the source editor sends the exact bytes typed there.
 *
 * The Markdown toggle lives in the composer's lead (`[data-composer-mode-toggle]`) and is the only way between the two:
 * a draft holding raw HTML, math, a table, an alert, an image or anything else the schema has no node for opens in the
 * source editor and stays there until it is representable again. The toggle never sends.
 *
 * Keys, paste and typing are the integration's: `onBeforeKeyDown` runs first so the slash and mention menus answer a key
 * before Enter, Tab or a formatting chord. `enterPolicy` decides whether Enter is an edit (a list split, a list exit, a
 * newline in a fence) or the send `composerEnterMode` names, Shift+Enter always inserts one hard break, and Mod-Enter
 * always sends. Tab, Shift+Tab and the formatting chords are `keys.ts`'.
 */
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as ProseMirrorNode, Slice } from "prosemirror-model";
import { EditorState, TextSelection, type Command, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { PromptMode } from "../../../api/sessions.ts";
import { composerEnterMode } from "../state.ts";
import { adjustTextareaHeight, disconnectTextareaOverflowObserver, observeTextareaOverflow } from "../textarea.ts";
import { codeBlockNewline, enterKey, enterPolicy, newline, richKeymap } from "./keys.ts";
import { parseMarkdown, serializeMarkdown, sourceMode } from "./markdown.ts";
import { htmlSlice, plainTextSlice } from "./paste.ts";
import { richInputRules } from "./rules.ts";
import { richSchema, schemaNode } from "./schema.ts";

/** The composer as the controller and the view's own glue see it, whichever mode it is in. */
export type ComposerControl = {
  /** The wire the form sends: the loaded source, the serializer's output, or the exact source typed in source mode. */
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
  /** Whether a key or focus event came from this composer, in either mode. */
  isTarget(target: Node | null): boolean;
};

/** Everything one render hands the editor. A changed `markdown` reloads the draft; anything else patches in place. */
export type ComposerEditorOptions = {
  /** The hidden field's name: `text` in the chat, `prompt` on New Session. */
  name: "text" | "prompt";
  /** The accessible name of whichever surface is editing, and of the hidden field's label. */
  label: string;
  placeholder: string;
  /** The draft's Markdown wire. */
  markdown: string;
  /** A send, a start or a boot in flight: the composer takes no edits. */
  locked: boolean;
  /** Extra classes for the source textarea, which the reference composer sheet styles through the host. */
  className?: string;
  /** The id the active surface carries, such as `launch-prompt`. */
  id?: string;
  /** Whether a run is in flight, which is what plain Enter means while it is. */
  streaming: boolean;
  /** The operator's Enter preference; `modifierEnter` leaves plain Enter as a line break. */
  sendShortcut?: "enter" | "modifierEnter";
  /** The `aria-keyshortcuts` the chat composer announces. */
  keyShortcuts?: string;
  /** The completion menus the editor announces on whichever surface is active. */
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaActiveDescendant?: string;
  onChange(markdown: string): void;
  onSelection(): void;
  /** The slash and mention menus, before the editor reads the key itself. */
  onBeforeKeyDown(event: KeyboardEvent): void;
  onSubmit(mode: PromptMode): void;
  /** Images and pasted long text the composer turns into attachments. True when it took the clipboard. */
  onPaste(event: ClipboardEvent): boolean;
  onFocus?(): void;
  onBlur?(event: FocusEvent): void;
  onSourceModeChange?(source: boolean): void;
};

/** One mounted composer. `update` is idempotent: a render may call it as often as it likes. */
export type ComposerEditor = {
  control: ComposerControl;
  update(options: ComposerEditorOptions): void;
  /** Loads an external draft — a send clear, a rewind, a quote, a share seed, a recovered draft. */
  setMarkdown(source: string): void;
  focus(): void;
  caretAtEnd(): void;
  sourceMode(): boolean;
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

/** An empty draft: one paragraph, which is what a cleared composer shows. */
function emptyDocument(): ProseMirrorNode {
  return schemaNode(richSchema, "doc").create(null, schemaNode(richSchema, "paragraph").create());
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
  readonly #source: HTMLTextAreaElement;
  readonly #hidden: HTMLInputElement;
  readonly #plugins: readonly Plugin[];
  readonly #events = new AbortController();
  #options: ComposerEditorOptions;
  #toggle: HTMLButtonElement | undefined;
  #sourceMode = false;
  #destroyed = false;
  /** The lock the view's `editable` prop was last set from, and the attributes the active surface carries. */
  #locked: boolean;
  #applied: readonly string[] = [];
  #scrollObserver: ResizeObserver | undefined;
  #scrollFrame: number | null = null;

  constructor(host: HTMLElement, options: ComposerEditorOptions) {
    this.#host = host;
    this.#options = options;
    this.#locked = options.locked;
    this.#source = document.createElement("textarea");
    this.#source.rows = 1;
    this.#source.dir = "auto";
    this.#source.hidden = true;
    host.append(this.#source);
    this.#plugins = [
      history(),
      richInputRules(richSchema),
      richKeymap({ onSend: () => this.#send(this.#enterMode()) }),
      keymap(baseKeymap),
    ];
    this.#view = new EditorView(host, {
      state: this.#state(emptyDocument()),
      editable: () => !this.#options.locked,
      dispatchTransaction: (transaction) => this.#dispatch(transaction),
      handleKeyDown: (view, event) => this.#keyDown(view, event),
      handleTextInput: (view, from, to, text) => this.#textInput(view, from, to, text),
      handlePaste: (view, event) => this.#paste(view, event),
      handleDOMEvents: {
        focus: () => {
          this.#options.onFocus?.();
          return false;
        },
        blur: (_view, event) => {
          this.#options.onBlur?.(event as FocusEvent);
          return false;
        },
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
    // A ref runs before its element is connected, so the toggle's container in the composer's lead is looked up once the
    // render has committed, and once more on the next frame for a host that was still detached at the microtask.
    queueMicrotask(() => this.#afterMount());
    requestAnimationFrame(() => this.#afterMount());
  }

  /** The parts of a mount that need the element in the document: its toggle and its measured height. Both are idempotent. */
  #afterMount(): void {
    if (this.#destroyed) return;
    this.#syncToggle();
    this.#measureScroll();
  }

  update(options: ComposerEditorOptions): void {
    if (this.#destroyed) return;
    this.#options = options;
    if (options.markdown !== this.#hidden.value) this.setMarkdown(options.markdown);
    this.#source.className = options.className ?? "";
    this.#syncSurface();
    this.#syncToggle();
  }

  setMarkdown(source: string): void {
    if (this.#destroyed) return;
    this.#hidden.value = source;
    if (source !== "" && sourceMode(source)) {
      this.#openSource(source);
      return;
    }
    this.#loadRich(source === "" ? emptyDocument() : parseMarkdown(source));
    this.#syncSurface();
    this.#syncEmpty();
    this.#syncToggle();
  }

  focus(): void {
    if (this.#destroyed) return;
    if (this.#sourceMode) this.#source.focus({ preventScroll: true });
    else this.#view.focus();
  }

  caretAtEnd(): void {
    if (this.#destroyed) return;
    if (this.#sourceMode) {
      const end = this.#source.value.length;
      this.#source.setSelectionRange(end, end);
      return;
    }
    const { state } = this.#view;
    const end = TextSelection.atEnd(state.doc);
    if (!state.selection.eq(end)) this.#view.dispatch(state.tr.setSelection(end));
  }

  sourceMode(): boolean {
    return this.#sourceMode;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#events.abort();
    this.#scrollObserver?.disconnect();
    this.#scrollObserver = undefined;
    if (this.#scrollFrame !== null) cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = null;
    disconnectTextareaOverflowObserver(this.#source);
    this.#view.destroy();
    this.#source.remove();
    this.#hidden.remove();
    this.#toggle?.remove();
    this.#toggle = undefined;
    if (editors.get(this.#host) === this) editors.delete(this.#host);
  }

  /** A fresh state: a loaded draft starts with empty history, so undo never walks back to a previous draft. */
  #state(doc: ProseMirrorNode): EditorState {
    return EditorState.create({ doc, schema: richSchema, selection: TextSelection.atEnd(doc), plugins: this.#plugins });
  }

  #dispatch(transaction: Transaction): void {
    const state = this.#view.state.apply(transaction);
    this.#view.updateState(state);
    if (!transaction.docChanged) {
      this.#options.onSelection();
      return;
    }
    // A rich edit's wire is the serializer's own Markdown; the visible document never holds a marker.
    this.#hidden.value = serializeMarkdown(state.doc);
    this.#syncEmpty();
    this.#syncToggle();
    this.#measureScroll();
    this.#options.onChange(this.#hidden.value);
    this.#options.onSelection();
  }

  /** Loads a representable document and leaves source mode if it was in it. Clears history, puts the caret at the end. */
  #loadRich(doc: ProseMirrorNode): void {
    this.#view.updateState(this.#state(doc));
    if (this.#sourceMode) {
      this.#sourceMode = false;
      disconnectTextareaOverflowObserver(this.#source);
      this.#options.onSourceModeChange?.(false);
    }
    this.#syncEmpty();
  }

  /** Shows the source editor with these exact bytes: the draft cannot be drawn as rich text. */
  #openSource(source: string): void {
    this.#source.value = source;
    const entered = !this.#sourceMode;
    this.#sourceMode = true;
    this.#syncSurface();
    this.#syncEmpty();
    observeTextareaOverflow(this.#source);
    adjustTextareaHeight(this.#source);
    this.#syncToggle();
    if (entered) this.#options.onSourceModeChange?.(true);
  }

  /** The source editor holds the bytes: the wire is its value, and the draft follows it. */
  #fromSource(): void {
    this.#hidden.value = this.#source.value;
    this.#syncToggle();
    this.#options.onChange(this.#source.value);
    this.#options.onSelection();
  }

  /** An emptied source-mode draft is a rich empty draft again, with the caret back in it. */
  #enterRich(): void {
    this.#loadRich(emptyDocument());
    this.#syncSurface();
    this.#hidden.value = "";
    this.#syncToggle();
    this.#options.onChange("");
    this.focus();
    this.caretAtEnd();
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
    if (this.#sourceMode) return this.#source.value;
    const { node, prefix } = this.#block();
    // A hard break is one character of the text the completions read, so offsets stay in the operator's coordinates.
    return prefix + node.textBetween(0, node.content.size, undefined, "\n");
  }

  #selection(): { start: number; end: number } {
    if (this.#sourceMode) return { start: this.#source.selectionStart, end: this.#source.selectionEnd };
    const { node, prefix } = this.#block();
    const { $from, $to } = this.#view.state.selection;
    const start = prefix.length + ($from.parent === node ? $from.parentOffset : 0);
    const end = prefix.length + ($to.parent === node ? $to.parentOffset : node.content.size);
    return { start, end: Math.max(start, end) };
  }

  #replaceRange(from: number, to: number, insert: string, caret: number): void {
    if (this.#sourceMode) {
      const value = this.#source.value;
      const head = Math.max(0, Math.min(value.length, from));
      const tail = Math.max(head, Math.min(value.length, to));
      this.#source.setRangeText(insert, head, tail, "end");
      const at = Math.max(0, Math.min(this.#source.value.length, caret));
      this.#source.setSelectionRange(at, at);
      this.#source.focus({ preventScroll: true });
      adjustTextareaHeight(this.#source);
      this.#fromSource();
      return;
    }
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
    if (target === null) return false;
    return target === this.#source || target === this.#view.dom || this.#view.dom.contains(target);
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
    if (event.key !== "Enter" || event.altKey) return false;
    // Shift+Enter is always one hard break, and Mod-Enter always sends, whatever the cursor sits in.
    if (event.shiftKey) return this.#edit(view, hardBreak);
    if (event.metaKey || event.ctrlKey) {
      this.#send(this.#enterMode(false, event.ctrlKey, event.metaKey));
      return true;
    }
    const mode = this.#enterMode();
    // A coarse pointer, or the modifier-Enter preference, keeps plain Enter an edit.
    if (mode === undefined) return false;
    if (mode !== "newline" && enterPolicy(view.state) === "send") {
      this.#options.onSubmit(mode);
      return true;
    }
    return this.#edit(view, enterKey);
  }

  /** Runs an edit command, and gives prose the line break the command leaves alone. */
  #edit(view: EditorView, command: Command): boolean {
    if (command(view.state, view.dispatch, view)) return true;
    return hardBreak(view.state, view.dispatch, view);
  }

  #textInput(view: EditorView, from: number, to: number, text: string): boolean {
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
    const html = data.getData("text/html");
    const plain = data.getData("text/plain");
    const mapped = html ? htmlSlice(richSchema, html) : undefined;
    const slice = mapped && (hasStructure(mapped) || !plain) ? mapped : plain ? plainTextSlice(richSchema, plain) : undefined;
    if (!slice || slice.size === 0) return false;
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    return true;
  }

  /** After an edit the toggle says what the wire needs, and the source editor why it cannot become rich. */
  #syncToggle(): void {
    if (this.#destroyed) return;
    const container = this.#host.closest("form")?.querySelector<HTMLElement>("[data-composer-mode-toggle]");
    if (container && !this.#toggle) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agent-chat__composer-mode-toggle";
      button.textContent = "Markdown";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.#toggleSource();
      }, { signal: this.#events.signal });
      container.append(button);
      this.#toggle = button;
    }
    const toggle = this.#toggle;
    if (!toggle) return;
    // A rich edit's wire is the serializer's own output, so only a source draft has to be checked for representability:
    // this runs on every keystroke, and it is the one parse the rich path would be paying for nothing.
    const representable = !this.#sourceMode || !sourceMode(this.#hidden.value);
    toggle.setAttribute("aria-pressed", String(this.#sourceMode));
    toggle.title = this.#sourceMode
      ? representable ? "Show the formatted draft" : "This draft holds Markdown the formatted editor cannot show"
      : "Edit the Markdown source";
    if (this.#sourceMode && !representable) {
      this.#source.setAttribute("aria-description", `${toggle.title}. It sends exactly these bytes.`);
    } else {
      this.#source.removeAttribute("aria-description");
    }
  }

  /** The toggle: rich → source shows the current wire, source → rich needs a representable draft. An empty one is. */
  #toggleSource(): void {
    if (this.#options.locked) return;
    if (!this.#sourceMode) {
      this.#openSource(this.#hidden.value);
      this.#source.focus({ preventScroll: true });
      return;
    }
    if (sourceMode(this.#source.value)) {
      this.#syncToggle();
      return;
    }
    this.#hidden.value = this.#source.value;
    this.#loadRich(this.#source.value === "" ? emptyDocument() : parseMarkdown(this.#source.value));
    this.#syncSurface();
    this.#syncToggle();
    this.#view.focus();
  }

  #listen(): void {
    const signal = this.#events.signal;
    this.#source.addEventListener("input", () => {
      if (!this.#sourceMode) return;
      if (this.#source.value === "") {
        this.#enterRich();
        return;
      }
      adjustTextareaHeight(this.#source);
      this.#fromSource();
    }, { signal });
    this.#source.addEventListener("keydown", (event) => this.#sourceKeyDown(event), { signal });
    this.#source.addEventListener("paste", (event) => {
      if (this.#options.onPaste(event)) event.preventDefault();
    }, { signal });
    for (const type of ["click", "select", "keyup"] as const) {
      // A caret this browser moved without a transaction (a click, an arrow key) still has to re-read the completions.
      this.#source.addEventListener(type, () => {
        if (this.#sourceMode) this.#options.onSelection();
      }, { signal });
      this.#view.dom.addEventListener(type, () => {
        if (!this.#sourceMode) this.#options.onSelection();
      }, { signal });
    }
    this.#source.addEventListener("focus", () => this.#options.onFocus?.(), { signal });
    this.#source.addEventListener("blur", (event) => this.#options.onBlur?.(event), { signal });
  }

  /** The source editor's keys: the menus first, then Enter as the composer's Enter means it. Tab leaves. */
  #sourceKeyDown(event: KeyboardEvent): void {
    this.#options.onBeforeKeyDown(event);
    if (event.defaultPrevented || event.isComposing || event.key !== "Enter" || event.altKey) return;
    // Shift+Enter is the textarea's own newline, which is exactly the hard break the rich editor writes.
    if (event.shiftKey) return;
    const mode = this.#enterMode(false, event.ctrlKey, event.metaKey);
    if (!mode || mode === "newline") return;
    event.preventDefault();
    this.#options.onSubmit(mode);
  }

  /** The active surface's identity: one labeled editor at a time, and the completion menus on whichever it is. */
  #syncSurface(): void {
    if (this.#destroyed) return;
    const { id, placeholder, locked } = this.#options;
    const rich = this.#view.dom;
    const active = this.#sourceMode ? this.#source : rich;
    const inactive = this.#sourceMode ? rich : this.#source;
    const attributes = this.#attributes();
    // One control at a time carries the combobox: the other surface loses every attribute this one sets, including a
    // menu attribute this render no longer has.
    for (const name of new Set([...this.#applied, ...Object.keys(attributes)])) {
      inactive.removeAttribute(name);
      if (!(name in attributes)) active.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attributes)) active.setAttribute(name, value);
    this.#applied = Object.keys(attributes);
    for (const element of [rich, this.#source]) element.removeAttribute("id");
    if (id) active.id = id;
    this.#source.placeholder = placeholder;
    this.#source.hidden = !this.#sourceMode;
    rich.hidden = this.#sourceMode;
    this.#source.disabled = locked;
    if (this.#locked !== locked) {
      this.#locked = locked;
      this.#view.setProps({ editable: () => !locked });
    }
  }

  #attributes(): Record<string, string> {
    const { label, placeholder, keyShortcuts, ariaExpanded, ariaControls, ariaActiveDescendant } = this.#options;
    const attributes: Record<string, string> = {
      role: "combobox",
      "aria-multiline": "true",
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "aria-label": label,
      "aria-placeholder": placeholder,
      dir: "auto",
      "data-placeholder": placeholder,
    };
    if (keyShortcuts) attributes["aria-keyshortcuts"] = keyShortcuts;
    if (ariaExpanded !== undefined) attributes["aria-expanded"] = String(ariaExpanded);
    if (ariaControls) attributes["aria-controls"] = ariaControls;
    if (ariaActiveDescendant) attributes["aria-activedescendant"] = ariaActiveDescendant;
    return attributes;
  }

  /** The placeholder shows while the rich document holds no text at all. */
  #syncEmpty(): void {
    const empty = this.#sourceMode ? this.#source.value === "" : this.#view.state.doc.textContent === "";
    this.#view.dom.toggleAttribute("data-empty", empty && !this.#sourceMode);
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
