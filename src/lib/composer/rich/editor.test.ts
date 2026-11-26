/**
 * The composer editor's own rules the browser cannot be asked for: the placeholder's state, and which keys belong to the
 * surface. `data-empty` is what the sheet paints `data-placeholder` from, so it is set on the empty draft alone — one
 * paragraph holding nothing — and never over a block the operator made. A note, a quote, a heading or a fence is that
 * block whatever it holds, so an empty callout keeps the placeholder off its own title. A key is the surface's when it
 * happened on it, and ProseMirror's own key events — the Enter it answers for the browser on iOS — carry no target at
 * all, so only the editor can say such a key is the surface's, which is what the completion menus read to take a
 * suggestion instead of a line break. Each key is offered to those menus once, on the surface's capture phase, and a key
 * they take keeps away from ProseMirror and from the browser (this file's `SurfaceKeys`).
 *
 * These tests run without a browser, so the key events are the platform's own `Event`s — a real `preventDefault` and a
 * real `stopPropagation`, which is what ProseMirror and the browser read — with the `key` and `target` a keydown carries
 * defined on them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Node as SchemaNode } from "prosemirror-model";
import { test } from "vitest";
import { emptyDraft, keyBelongsToSurface, SurfaceKeys } from "./editor.ts";
import { parseMarkdown } from "./markdown.ts";
import { richSchema, schemaNode } from "./schema.ts";

/**
 * One keydown as the platform hands it over: a `key`, the element it happened on, and the two calls a menu may make on
 * it. ProseMirror's own replay is made with `document.createEvent`, so a key however made is an `Event` and no more.
 */
function keydown(key: string, target: Node | null = null): KeyboardEvent {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  Object.defineProperty(event, "target", { value: target });
  return event as unknown as KeyboardEvent;
}

/** The key's target as the menus read it: `event.target` is an `EventTarget`, and only a surface node answers one. */
const targetOf = (event: Event): Node | null => event.target as Node | null;

const docOf = (...content: SchemaNode[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: SchemaNode[]) => schemaNode(richSchema, "paragraph").create(null, content);
const noteOf = (kind: string, ...content: SchemaNode[]) => schemaNode(richSchema, "note").create({ kind }, content);
const quoteOf = (...content: SchemaNode[]) => schemaNode(richSchema, "blockquote").create(null, content);

test("the placeholder belongs to the empty draft and to nothing else", () => {
  // A cleared composer, and a draft the operator emptied again: one paragraph with no content.
  assert.equal(emptyDraft(docOf(paragraph())), true);

  // Every other draft carries a block, and the placeholder would be painted over it: an empty note, quote, heading or
  // fence is one — a callout whose body is empty still draws its own title where the placeholder would be.
  assert.equal(emptyDraft(docOf(noteOf("note", paragraph()))), false);
  assert.equal(emptyDraft(docOf(quoteOf(paragraph()))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "heading").create({ level: 2 }))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "code_block").create({ language: "" }))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "bullet_list").create(null, schemaNode(richSchema, "list_item").create(null, paragraph())))), false);

  // A draft with text, a second empty paragraph, and a paragraph holding only a line break are all drafts of the
  // operator's: the last one still holds a hard break, so it is not the empty paragraph the placeholder sits on.
  assert.equal(emptyDraft(docOf(paragraph(richSchema.text("hi")))), false);
  assert.equal(emptyDraft(docOf(paragraph(), paragraph())), false);
  assert.equal(emptyDraft(docOf(paragraph(schemaNode(richSchema, "hard_break").create()))), false);

  // The drafts the editor actually loads: a cleared composer, a callout with nothing typed in it, and a quote's marker
  // line on its own all come from the wire the way the tests above build them.
  assert.equal(emptyDraft(parseMarkdown("")), true);
  assert.equal(emptyDraft(parseMarkdown("> [!NOTE]")), false);
  assert.equal(emptyDraft(parseMarkdown(">")), false);
  // A note with a body is no more the placeholder's state than an empty one is.
  assert.equal(emptyDraft(parseMarkdown("> [!NOTE]\n> The body.")), false);
});

test("the surface's placeholder attribute is read from the draft, not from the text it shows", () => {
  const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");

  // `data-empty` is asked of the document through `emptyDraft`; the text a draft shows is not its state, because an
  // empty callout, quote or heading shows no text at all and is still a block the operator made.
  assert.match(editor, /#syncEmpty\(\): void \{\s*this\.#view\.dom\.toggleAttribute\("data-empty", emptyDraft\(this\.#view\.state\.doc\)\);/u);
  assert.doesNotMatch(editor, /toggleAttribute\("data-empty", this\.#view\.state\.doc\.textContent === ""\)/u);
});

test("a key belongs to the composer's surface, including the one ProseMirror answers for it", () => {
  // A key typed on the surface targets it; a key aimed elsewhere is not the composer's to answer.
  const onSurface = {} as Node;
  const elsewhere = {} as Node;
  const surface = { contains: (node: Node | null) => node === onSurface } as unknown as Node;
  assert.equal(keyBelongsToSurface(onSurface, surface, false), true);
  assert.equal(keyBelongsToSurface(elsewhere, surface, false), false);

  // ProseMirror answers the browser's own Enter itself, with a key event it never dispatched: nothing but the editor's
  // say can make that key the surface's, and a key nobody answered and nothing dispatched stays nobody's.
  assert.equal(keyBelongsToSurface(null, surface, true), true);
  assert.equal(keyBelongsToSurface(null, surface, false), false);

  // The menus ask the editor that question (`#isTarget`), and it is `#keyDown` and the capture offer that answer it.
  const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");
  assert.match(editor, /return keyBelongsToSurface\(target, this\.#view\.dom, this\.#keys\.answering\);/u);
});

test("the menus answer a key once, before ProseMirror can, and a key they take never reaches it", () => {
  // The surface's capture listener holds the offer: while the menus read the key, the editor says it is this surface's,
  // which is what `#isTarget` answers from, and a key they take is taken away from ProseMirror — which is why the Enter
  // it answers for the browser on iOS never becomes a line break, a replay, or a command taken 200 ms later.
  const surface = {} as Node;
  const keys = new SurfaceKeys();
  const taken = keydown("Enter", surface);
  let answeredOnSurface: boolean | undefined;
  keys.offer(taken, (event) => {
    answeredOnSurface = keyBelongsToSurface(targetOf(event), surface, keys.answering);
    event.preventDefault();
  });
  assert.equal(answeredOnSurface, true, "the menus read the key with the surface's name on it");
  assert.equal(taken.defaultPrevented, true, "they took it");
  assert.equal(taken.cancelBubble, true, "and it goes no further, so ProseMirror never handles it");
  assert.equal(keys.answering, false, "the flag lives exactly as long as their answer");

  // A key they leave reaches ProseMirror as it always did, and reaches them once: the capture listener offered the event
  // the browser dispatched, and `#keyDown` offers the same event again without a second key reaching the menus.
  const left = keydown("Enter", surface);
  let offers = 0;
  const menus = () => {
    offers += 1;
  };
  keys.offer(left, menus);
  keys.offer(left, menus);
  assert.equal(offers, 1, "one key, one offer");
  assert.equal(left.defaultPrevented, false, "nothing was prevented");
  assert.equal(left.cancelBubble, false, "so ProseMirror reads the key itself");
});

test("the replay ProseMirror makes for the browser's Enter is still the surface's", () => {
  // `dispatchKey(view, "Enter")` makes its own event and never dispatches it, so it has no target at all — on a phone
  // this is the only event the editor is handed for the operator's Enter, and the menus take their suggestion from it.
  const surface = {} as Node;
  const keys = new SurfaceKeys();
  const replay = keydown("Enter");
  assert.equal(replay.target, null, "a key ProseMirror made was never dispatched");
  let answeredOnSurface: boolean | undefined;
  keys.offer(replay, () => {
    answeredOnSurface = keyBelongsToSurface(targetOf(replay), surface, keys.answering);
  });
  assert.equal(answeredOnSurface, true, "the menus see a phone's Enter as the composer's");
  assert.equal(keyBelongsToSurface(targetOf(replay), surface, keys.answering), false, "and only while they answer it");
});

test("the surface offers its keys on the capture phase, and `#keyDown` offers through the same set", () => {
  const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");

  // One listener, on the surface itself and on the way down: ProseMirror's keydown handler is that element's own, in the
  // bubble phase, so the menus answer every key the browser dispatched before it can — on every platform, and on iOS
  // before the Enter it defers for 200 ms. A locked composer takes no keys, as ProseMirror's own handler does.
  assert.match(
    editor,
    /this\.#view\.dom\.addEventListener\("keydown", \(event\) => \{\s*if \(this\.#options\.locked\) return;\s*this\.#keys\.offer\(event, \(\) => this\.#options\.onBeforeKeyDown\(event\)\);\s*\}, \{ capture: true, signal \}\);/u,
  );
  assert.equal(editor.match(/addEventListener\("keydown"/gu)?.length, 2, "the surface's offer and the strip's Escape, no third listener");

  // The offer is the editor's own hand-off to the menus, before it reads the key: `#keyDown` offers the event ProseMirror
  // handed it — the replay, when every other key was offered on the way down — and only then reads the key itself.
  const keyDown = editor.slice(editor.indexOf("#keyDown(view: EditorView"), editor.indexOf("#edit(view: EditorView"));
  const offer = keyDown.indexOf("this.#keys.offer(event, () => {");
  const prevented = keyDown.indexOf("if (event.defaultPrevented) return true;");
  assert.ok(offer > 0 && prevented > offer, `${offer}, ${prevented}`);
});
