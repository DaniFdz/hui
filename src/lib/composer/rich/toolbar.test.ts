/**
 * The composer's selection toolbar: its role and accessible names, the pressed and disabled state of every button, the
 * roving focus its keys move, its placement inside a phone and a desktop viewport, and the promise that a closed strip
 * never re-anchors to the selection it forgot.
 *
 * These tests run without a browser, so a small stand-in DOM — elements, their attributes, focus and their own listeners,
 * and nothing more — is what the toolbar is built into. The documents are real ProseMirror states, so what the buttons
 * show is `formatState`'s own answer, and a clipboard is a stand-in for the platform's.
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { formatState } from "./keys.ts";
import { richSchema, schemaNode } from "./schema.ts";
import { ComposerToolbar, placeToolbar, roveTarget, type ToolbarAnchor } from "./toolbar.ts";

/** One event the stand-in DOM delivers: what a listener reads, and the two calls it may make on it. */
type TestEvent = { type: string; key?: string; defaultPrevented: boolean; preventDefault(): void };

/** One element of the stand-in DOM: the properties the toolbar sets and reads, and its own listeners. */
class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly #document: FakeDocument;
  readonly #listeners = new Map<string, ((event: TestEvent) => void)[]>();
  className = "";
  type = "";
  textContent = "";
  disabled = false;
  tabIndex = -1;
  parent: FakeElement | null = null;
  /** Whether the popover is showing, which is what `showPopover`/`hidePopover` keep. */
  shown = false;
  /** The box it reports, which the placement is measured from. */
  size = { width: 320, height: 40 };

  constructor(tagName: string, owner: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.#document = owner;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "tabindex") this.tabIndex = Number(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove(): void {
    if (!this.parent) return;
    const at = this.parent.children.indexOf(this);
    if (at >= 0) this.parent.children.splice(at, 1);
    this.parent = null;
  }

  addEventListener(type: string, handler: (event: TestEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), handler]);
  }

  /** Hands the element's listeners one event, as the browser would. */
  dispatch(type: string, event: Partial<TestEvent> = {}): void {
    for (const handler of this.#listeners.get(type) ?? []) {
      handler({ type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event } as TestEvent);
    }
  }

  getBoundingClientRect(): { width: number; height: number } {
    return { ...this.size };
  }

  focus(): void {
    this.#document.activeElement = this;
  }

  showPopover(): void {
    if (this.shown) throw new Error("InvalidStateError: the popover is already showing");
    this.shown = true;
  }

  hidePopover(): void {
    if (!this.shown) throw new Error("InvalidStateError: the popover is not showing");
    this.shown = false;
  }

  contains(node: FakeElement | null): boolean {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
}

/** The document the stand-in DOM belongs to: its body, the focused element, and the clipboard command. */
class FakeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  readonly clipboard: string[] = [];
  /** Whether `execCommand` answers true: a browser that refuses the command copies through the clipboard API instead. */
  command = true;

  constructor() {
    this.body = new FakeElement("body", this);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  execCommand(command: string): boolean {
    this.clipboard.push(command);
    return this.command;
  }
}

/** A visual viewport the way a phone with a keyboard up reports one: the window may be smaller than the layout. */
class FakeViewport {
  width: number;
  height: number;
  offsetLeft = 0;
  offsetTop = 0;
  readonly #listeners = new Map<string, (() => void)[]>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  addEventListener(type: string, handler: () => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), handler]);
  }

  dispatch(type: string): void {
    for (const handler of this.#listeners.get(type) ?? []) handler();
  }
}

/** What the toolbar is mounted into, and what it reached for. */
type Mounted = {
  toolbar: ComposerToolbar;
  element: FakeElement;
  viewport: FakeViewport;
  document: FakeDocument;
  frames: FrameRequestCallback[];
  run: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
  focusEditor: ReturnType<typeof vi.fn>;
  buttons: () => FakeElement[];
};

/** Mounts one toolbar into a stand-in DOM of a given viewport size. */
function mount(options: { width?: number; height?: number; clipboard?: Promise<string> } = {}): Mounted {
  const document = new FakeDocument();
  const viewport = new FakeViewport(options.width ?? 1440, options.height ?? 900);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { innerWidth: viewport.width, innerHeight: viewport.height, visualViewport: viewport });
  vi.stubGlobal("navigator", { clipboard: { readText: () => options.clipboard ?? Promise.resolve("pasted text"), writeText: () => Promise.resolve() } });
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const run = vi.fn();
  const insertText = vi.fn();
  const focusEditor = vi.fn();
  const toolbar = new ComposerToolbar({ run, insertText, focusEditor, closed: () => {} });
  return {
    toolbar,
    element: toolbar.element() as unknown as FakeElement,
    viewport,
    document,
    frames,
    run,
    insertText,
    focusEditor,
    buttons: () => (toolbar.element() as unknown as FakeElement).children.filter((child) => child.tagName === "BUTTON"),
  };
}

const paragraph = (...content: ProseMirrorNode[]) => schemaNode(richSchema, "paragraph").create(null, content);
const docOf = (...content: ProseMirrorNode[]) => schemaNode(richSchema, "doc").create(null, content);
const note = (...content: ProseMirrorNode[]) => schemaNode(richSchema, "note").create({ kind: "note" }, content);

/** A state whose selection spans the whole of the document's first textblock, however deeply a block wraps it. */
function selected(doc: ProseMirrorNode): EditorState {
  let start = -1;
  let end = -1;
  doc.descendants((node, position) => {
    if (start >= 0) return false;
    if (!node.isTextblock) return true;
    start = position + 1;
    end = start + node.content.size;
    return false;
  });
  const base = EditorState.create({ doc });
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, start, end)));
}

const ANCHOR: ToolbarAnchor = { left: 100, top: 300, right: 240, bottom: 320 };

/** Every accessible name the strip carries, in the order it draws them. */
const LABELS = ["Bold", "Italic", "Strikethrough", "Inline code", "Quote", "Note", "Bullet list", "Code block", "Text", "Cut", "Copy", "Paste"];

test("the strip is a labelled toolbar of real buttons, drawn in the top layer", () => {
  const { toolbar, element, buttons, document } = mount();

  assert.equal(element.getAttribute("role"), "toolbar", "the strip is the toolbar role");
  assert.equal(element.getAttribute("aria-label"), "Format selection", "and carries the name a screen reader reads");
  assert.equal(element.getAttribute("popover"), "manual", "it is a manual popover, so it draws in the top layer");
  assert.ok(element.parent === document.body, "appended to the body, never into the composer");
  assert.deepEqual(buttons().map((button) => button.getAttribute("aria-label")), LABELS, "every action, named");
  for (const button of buttons()) {
    assert.equal(button.type, "button", "a real button, which never submits the composer's form");
    assert.equal(button.getAttribute("data-hui-tooltip"), button.getAttribute("aria-label"), "and HUI's own tooltip says the same");
  }
  // The separators are what draws the mark, the block and the clipboard groups apart.
  assert.equal(element.children.filter((child) => child.getAttribute("role") === "separator").length, 2, "three groups, two seams");
  assert.equal(toolbar.isOpen, false, "mounting draws nothing: there is no permanent row");
  assert.equal(element.getAttribute("hidden"), "", "and the element is hidden as well as closed");
  toolbar.open(ANCHOR, formatState(selected(docOf(paragraph(richSchema.text("plain"))))));
  assert.equal(element.getAttribute("hidden"), null, "opening shows it");
  assert.equal(element.shown, true, "as a popover in the top layer");
  toolbar.close();
  assert.equal(element.getAttribute("hidden"), "", "closing hides the element again");
});

test("pressed and disabled come from the selection's marks and from a dry run of each command", async () => {
  const { toolbar, buttons } = mount();
  const byName = () => new Map(buttons().map((button) => [button.getAttribute("aria-label"), button]));

  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  toolbar.open(ANCHOR, formatState(state));
  await Promise.resolve();
  const plain = byName();
  assert.equal(plain.get("Bold")?.getAttribute("aria-pressed"), "false", "plain prose carries no mark");
  assert.equal(plain.get("Quote")?.getAttribute("aria-pressed"), "false");
  assert.equal(plain.get("Text")?.getAttribute("aria-pressed"), "true", "a paragraph is what Text names");
  // A dry run of `Text` on a paragraph finds no block to take away, so the button says so instead of doing nothing.
  assert.equal(plain.get("Text")?.disabled, true, "the block the selection already is cannot be applied again");
  assert.equal(plain.get("Quote")?.disabled, false, "wrapping a paragraph in a quote is available");
  assert.equal(plain.get("Paste")?.disabled, false, "the clipboard read answered");

  const strong = richSchema.marks["strong"]!.create();
  toolbar.update(formatState(selected(docOf(paragraph(richSchema.text("bold", [strong]))))));
  assert.equal(byName().get("Bold")?.getAttribute("aria-pressed"), "true", "the whole selection carries strong");
  // Half a marked run is not "the whole selection": the button offers to finish the job instead.
  const half = docOf(paragraph(richSchema.text("bo"), richSchema.text("ld", [strong])));
  toolbar.update(formatState(selected(half)));
  assert.equal(byName().get("Bold")?.getAttribute("aria-pressed"), "false", "only half of the selection is bold");

  toolbar.open(ANCHOR, formatState(selected(docOf(note(paragraph(richSchema.text("body")))))));
  await Promise.resolve();
  assert.equal(byName().get("Note")?.getAttribute("aria-pressed"), "true", "the selection sits in a note");
  assert.equal(byName().get("Note")?.disabled, true, "and Note cannot make a second one");
});

test("arrow keys, Home and End move focus between the enabled buttons", async () => {
  const { toolbar, element, document, buttons } = mount();
  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  toolbar.open(ANCHOR, formatState(state), { focus: true });
  await Promise.resolve();

  const enabled = buttons().filter((button) => !button.disabled);
  assert.ok(enabled.length > 2, "most of the strip can act on a plain selection");
  assert.equal(document.activeElement, enabled[0], "opening from the keyboard focuses the first enabled button");
  assert.equal(enabled.filter((button) => button.tabIndex === 0).length, 1, "one button is on the tab order");

  element.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(document.activeElement, enabled[1], "the arrow steps to the next enabled button");
  element.dispatch("keydown", { key: "End" });
  assert.equal(document.activeElement, enabled[enabled.length - 1], "End goes to the last one");
  element.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(document.activeElement, enabled[0], "and it wraps around");
  element.dispatch("keydown", { key: "Home" });
  assert.equal(document.activeElement, enabled[0], "Home goes to the first one");
  element.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(document.activeElement, enabled[enabled.length - 1], "the other arrow wraps the other way");
  // A key the toolbar does not own leaves focus where it is.
  element.dispatch("keydown", { key: "a" });
  assert.equal(document.activeElement, enabled[enabled.length - 1]);
});

test("Escape closes the strip and gives the editor its focus back", async () => {
  const { toolbar, element, focusEditor } = mount();
  toolbar.open(ANCHOR, formatState(selected(docOf(paragraph(richSchema.text("plain"))))), { focus: true });
  await Promise.resolve();
  element.dispatch("keydown", { key: "Escape" });
  assert.equal(toolbar.isOpen, false, "Escape closes it");
  assert.equal(element.shown, false, "and the popover is hidden with it");
  assert.equal(focusEditor.mock.calls.length, 1, "focus goes back to the editor, which still holds the selection");
});

test("the strip sits inside a phone's viewport, above the selection or below it", () => {
  const phone = mount({ width: 390, height: 844 });
  // A selection near the right edge: the strip is centred on it and keeps 8px from the edge.
  phone.toolbar.open({ left: 350, top: 400, right: 380, bottom: 420 }, formatState(selected(docOf(paragraph(richSchema.text("x"))))));
  assert.equal(phone.element.style["left"], "62px", "390 - 8 - 320, the rightmost the strip may start");
  assert.equal(phone.element.style["top"], "352px", "above the selection, with its 8px gap");
  // A selection at the top: there is no room above, so the strip goes below it.
  phone.toolbar.open({ left: 20, top: 10, right: 80, bottom: 30 }, formatState(selected(docOf(paragraph(richSchema.text("x"))))));
  assert.equal(phone.element.style["top"], "38px", "below the selection when the top has no room");
  // A selection near the bottom still has the whole page above it, so the strip stays above and inside the viewport.
  phone.toolbar.open({ left: 20, top: 800, right: 80, bottom: 840 }, formatState(selected(docOf(paragraph(richSchema.text("x"))))));
  assert.equal(phone.element.style["top"], "752px", "800 - 8 - 40, above a selection that ends the page");

  const desktop = mount({ width: 1440, height: 900 });
  desktop.toolbar.open({ left: 700, top: 500, right: 900, bottom: 520 }, formatState(selected(docOf(paragraph(richSchema.text("x"))))));
  assert.equal(desktop.element.style["left"], "640px", "centred on a wide selection");
  assert.equal(desktop.element.style["top"], "452px");
});

test("the placement flips and clamps, and keeps its 8px padding at every edge", () => {
  const size = { width: 300, height: 40 };
  const viewport = { left: 0, top: 0, right: 390, bottom: 844 };
  assert.deepEqual(placeToolbar({ anchor: { left: 10, top: 200, right: 50, bottom: 220 }, size, viewport }), { left: 8, top: 152 }, "the left edge clamps to 8");
  assert.deepEqual(
    placeToolbar({ anchor: { left: 380, top: 200, right: 390, bottom: 220 }, size, viewport }),
    { left: 82, top: 152 },
    "the right edge clamps to 390 - 8 - 300",
  );
  assert.deepEqual(placeToolbar({ anchor: { left: 150, top: 500, right: 250, bottom: 520 }, size, viewport }), { left: 50, top: 452 }, "centred where it fits");
  assert.deepEqual(placeToolbar({ anchor: { left: 0, top: 0, right: 390, bottom: 10 }, size, viewport }), { left: 45, top: 18 }, "no room above flips it below");
  // A viewport a phone's keyboard left short of the strip: no room above, none below, so it is clamped inside both.
  assert.deepEqual(
    placeToolbar({ anchor: { left: 100, top: 20, right: 160, bottom: 50 }, size, viewport: { left: 0, top: 0, right: 390, bottom: 100 } }),
    { left: 8, top: 8 },
    "a strip with room nowhere keeps its 8px padding and never leaves the viewport",
  );
  // A visual viewport that a keyboard pushed up: the clamp follows it, not the layout viewport.
  assert.deepEqual(
    placeToolbar({ anchor: { left: 150, top: 300, right: 250, bottom: 320 }, size, viewport: { left: 0, top: 200, right: 390, bottom: 544 } }),
    { left: 50, top: 252 },
    "the strip is placed against the visual viewport's own box",
  );
});

test("a closed strip forgets its selection and never re-anchors to it", async () => {
  const { toolbar, element, viewport, document } = mount({ width: 1440, height: 900 });
  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  toolbar.open(ANCHOR, formatState(state));
  await Promise.resolve();
  const placed = { left: element.style["left"], top: element.style["top"] };
  toolbar.close();
  assert.equal(toolbar.isOpen, false);

  // The viewport changes under a closed strip: neither a resize nor a scroll moves it back onto the old selection.
  viewport.width = 390;
  viewport.height = 844;
  viewport.dispatch("resize");
  viewport.dispatch("scroll");
  assert.deepEqual({ left: element.style["left"], top: element.style["top"] }, placed, "a closed strip keeps its last box and follows nothing");
  assert.equal(element.shown, false, "and stays closed");
  assert.ok(element.parent === document.body, "it is still mounted: the editor closes it, only destroying removes it");

  // An open strip is clamped again on the same events, which is what a phone's on-screen keyboard needs.
  toolbar.open({ left: 1000, top: 600, right: 1200, bottom: 620 }, formatState(state));
  await Promise.resolve();
  assert.equal(element.style["left"], "62px", "the strip moved with the viewport it is clamped to");
});

test("an outside press or a selection that left the viewport closes the strip", async () => {
  const { toolbar, viewport } = mount({ width: 1440, height: 900 });
  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  toolbar.open({ left: 100, top: 200, right: 200, bottom: 220 }, formatState(state));
  await Promise.resolve();
  // A viewport scrolled away from the selection: the strip goes with it rather than floating over nothing.
  viewport.offsetTop = 400;
  viewport.dispatch("scroll");
  assert.equal(toolbar.isOpen, false, "the strip closes once its selection is out of the viewport");
});

test("a formatting button runs its action and keeps the strip open", async () => {
  const { toolbar, run, buttons } = mount();
  toolbar.open(ANCHOR, formatState(selected(docOf(paragraph(richSchema.text("plain text"))))));
  await Promise.resolve();
  const bold = buttons().find((button) => button.getAttribute("aria-label") === "Bold");
  bold?.dispatch("click");
  assert.deepEqual(run.mock.calls, [["bold"]], "the table's action, run by the editor");
  assert.equal(toolbar.isOpen, true, "the editor decides whether the strip stays: a pointer press does not close it");
});

test("Cut and Copy keep the browser's own flavours, and Paste inserts what was read", async () => {
  const mounted = mount({ clipboard: Promise.resolve("first line\nsecond line") });
  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  mounted.toolbar.open(ANCHOR, formatState(state));
  await Promise.resolve();
  const byName = new Map(mounted.buttons().map((button) => [button.getAttribute("aria-label"), button]));

  byName.get("Cut")?.dispatch("click");
  assert.deepEqual(mounted.document.clipboard, ["cut"], "the browser's own command writes the clipboard");
  assert.equal(mounted.focusEditor.mock.calls.length, 1, "with the editor focused, so it copies the selection it draws");

  byName.get("Copy")?.dispatch("click");
  assert.deepEqual(mounted.document.clipboard, ["cut", "copy"]);
  // A refused command falls back to the clipboard API's plain text.
  mounted.document.command = false;
  byName.get("Copy")?.dispatch("click");
  assert.deepEqual(mounted.document.clipboard, ["cut", "copy", "copy"], "the command was tried");

  byName.get("Paste")?.dispatch("click");
  assert.deepEqual(mounted.insertText.mock.calls, [["first line\nsecond line"]], "the text read when the strip opened");
});

test("Paste is disabled while the clipboard read is refused", async () => {
  const mounted = mount({ clipboard: Promise.reject(new Error("denied")) });
  mounted.toolbar.open(ANCHOR, formatState(selected(docOf(paragraph(richSchema.text("plain text"))))));
  await Promise.resolve();
  await Promise.resolve();
  const paste = mounted.buttons().find((button) => button.getAttribute("aria-label") === "Paste");
  assert.equal(paste?.disabled, true, "a refused read leaves Paste unavailable rather than failing on the click");
  paste?.dispatch("click");
  assert.deepEqual(mounted.insertText.mock.calls, [], "and a press does nothing");
});

test("the roving target wraps the enabled buttons and ignores other keys", () => {
  assert.equal(roveTarget(3, 0, "ArrowRight"), 1);
  assert.equal(roveTarget(3, 2, "ArrowRight"), 0, "the last button wraps to the first");
  assert.equal(roveTarget(3, 0, "ArrowLeft"), 2, "and the first wraps to the last");
  assert.equal(roveTarget(3, 1, "Home"), 0);
  assert.equal(roveTarget(3, 1, "End"), 2);
  assert.equal(roveTarget(3, 1, "Tab"), undefined, "a key the strip does not own is left to the browser");
  assert.equal(roveTarget(0, 0, "ArrowRight"), undefined, "no enabled button, nowhere to go");
  assert.equal(roveTarget(3, -1, "ArrowRight"), 0, "from nowhere, the arrow enters at the start");
});

test("a state whose formatting is all unavailable still offers the clipboard", async () => {
  const { toolbar, buttons } = mount();
  const state = selected(docOf(paragraph(richSchema.text("plain text"))));
  const wire = formatState(state);
  const literal = Object.fromEntries(Object.entries(wire).map(([id, entry]) => [id, {
    pressed: false,
    disabled: ["cut", "copy", "paste"].includes(id) ? entry.disabled : true,
  }]));
  toolbar.open(ANCHOR, literal as typeof wire);
  await Promise.resolve();
  const byName = new Map(buttons().map((button) => [button.getAttribute("aria-label"), button]));
  for (const label of ["Bold", "Italic", "Strikethrough", "Inline code", "Quote", "Note", "Bullet list", "Code block", "Text"]) {
    assert.equal(byName.get(label)?.disabled, true, `${label} is drawn unavailable`);
  }
  assert.equal(byName.get("Copy")?.disabled, false, "copying the text still works");
});
