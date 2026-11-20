/**
 * The mirror's scheduling and painting against a fake textarea, mirror and animation frame: one redraw per frame
 * however many changes arrive, none while an IME owns the draft, and the text box, metrics and scroll copied every
 * time. The browser's own proof is the visual verification; this pins the wiring.
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { disconnectComposerMirror, COMPOSER_MIRROR_READY_ATTRIBUTE, mountComposerMirror, scheduleComposerMirror, setComposerMirrorComposing } from "./composer-mirror.ts";
import { MAX_FORMATTED_LENGTH } from "./markdown-draft.ts";

type FakeTextarea = {
  value: string;
  clientWidth: number;
  scrollTop: number;
  scrollLeft: number;
  parentElement: FakeParent;
  addEventListener(type: string, handler: () => void, options?: { signal?: AbortSignal }): void;
  hasAttribute(name: string): boolean;
  fire(type: string): void;
  listenerCount(type: string): number;
  toggleAttribute(name: string, on: boolean): void;
};

type FakeParent = { attributes: Set<string>; setAttribute(name: string): void; removeAttribute(name: string): void };

type FakeMirror = {
  innerHTML: string;
  scrollTop: number;
  scrollLeft: number;
  attributes: Set<string>;
  style: { setProperty(property: string, value: string): void; removeProperty(property: string): void; get(property: string): string | undefined; has(property: string): boolean };
  writes: number;
  setAttribute(name: string): void;
  removeAttribute(name: string): void;
};

function fakeParent(): FakeParent {
  const attributes = new Set<string>();
  return { attributes, setAttribute: (name) => void attributes.add(name), removeAttribute: (name) => void attributes.delete(name) };
}

function fakeTextarea(): FakeTextarea {
  const listeners = new Map<string, Set<() => void>>();
  const attributes = new Set<string>();
  const textarea: FakeTextarea = {
    value: "",
    clientWidth: 320,
    scrollTop: 0,
    scrollLeft: 0,
    parentElement: fakeParent(),
    addEventListener(type, handler, options) {
      if (options?.signal?.aborted) return;
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(handler);
      options?.signal?.addEventListener("abort", () => set.delete(handler));
    },
    hasAttribute: (name) => attributes.has(name),
    fire: (type) => {
      for (const handler of [...(listeners.get(type) ?? [])]) handler();
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    toggleAttribute: (name, on) => (on ? attributes.add(name) : attributes.delete(name)),
  };
  return textarea;
}

function fakeMirror(): FakeMirror {
  const values = new Map<string, string>();
  const style = {
    setProperty: (property: string, value: string) => void values.set(property, value),
    removeProperty: (property: string) => void values.delete(property),
    get: (property: string) => values.get(property),
    has: (property: string) => values.has(property),
  };
  const attributes = new Set<string>();
  let painted = "";
  const mirror: FakeMirror = {
    innerHTML: "",
    scrollTop: 0,
    scrollLeft: 0,
    attributes,
    style,
    writes: 0,
    setAttribute: (name) => void attributes.add(name),
    removeAttribute: (name) => void attributes.delete(name),
  };
  // The markup the mirror would show: counted, so a frame's writes are exactly what the test reads.
  Object.defineProperty(mirror, "innerHTML", {
    get: () => painted,
    set: (value: string) => {
      painted = value;
      mirror.writes += 1;
    },
  });
  return mirror;
}

/** A frame queue the test drains by hand, so one drain is exactly one animation frame. */
function fakeFrames() {
  const queue: (() => void)[] = [];
  const cancelled: number[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => queue.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => cancelled.push(handle));
  return {
    pending: () => queue.length,
    flush() {
      // One frame: the callbacks queued when it began. A paint never queues another.
      const frame = queue.splice(0, queue.length);
      for (const callback of frame) callback();
    },
    cancelled,
  };
}

const STYLE: Record<string, string> = {
  "font-family": "Inter, sans-serif",
  "font-size": "16px",
  "line-height": "24px",
  "white-space": "pre-wrap",
  "overflow-wrap": "break-word",
  padding: "6px 0px",
  "tab-size": "8",
};

test("any number of changes inside one frame cost one redraw", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (property: string) => STYLE[property] ?? "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  assert.equal(frames.pending(), 1, "mounting paints the draft the textarea already holds");
  frames.flush();
  assert.equal(mirror.writes, 1);

  for (const draft of ["M", "Ma", "Mak", "Make", "Make ", "Make i", "Make it", "Make it ", "Make it *", "Make it **x**"]) {
    textarea.value = draft;
    textarea.fire("input");
  }
  assert.equal(frames.pending(), 1, "ten inputs coalesce into one frame");
  frames.flush();
  assert.equal(mirror.writes, 2);
  assert.match(mirror.innerHTML, /hui-draft-marker">\*\*<\/span><span class="hui-draft-bold">x<\/span>/u);

  // A draft a rewind or a stored draft replaced arrives without an input event.
  textarea.value = "**replaced**";
  scheduleComposerMirror(textarea as unknown as HTMLTextAreaElement);
  assert.equal(frames.pending(), 1);
  frames.flush();
  assert.equal(mirror.writes, 3);
  assert.match(mirror.innerHTML, /hui-draft-bold">replaced/u);
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
});

test("a frame with the same draft paints no new markup but still copies the box, the scroll and the fade", () => {
  const frames = fakeFrames();
  const style: Record<string, string> = { ...STYLE };
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (property: string) => style[property] ?? "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  frames.flush();
  assert.equal(mirror.writes, 1);
  assert.equal(mirror.style.get("font-size"), "16px");

  // A render schedules a frame even when the draft it hands back is the one already painted.
  style["font-size"] = "18px";
  textarea.scrollTop = 24;
  textarea.toggleAttribute("data-scroll-fade-bottom", true);
  scheduleComposerMirror(textarea as unknown as HTMLTextAreaElement);
  frames.flush();
  assert.equal(mirror.writes, 1, "an unchanged draft is not parsed and relaid out again");
  assert.equal(mirror.style.get("font-size"), "18px", "the frame still copies the metrics");
  assert.equal(mirror.scrollTop, 24, "and syncs the scroll");
  assert.ok(mirror.attributes.has("data-scroll-fade-bottom"), "and the fade");

  // One changed draft, one frame: exactly the one write.
  textarea.value = "**bold**";
  textarea.fire("input");
  scheduleComposerMirror(textarea as unknown as HTMLTextAreaElement);
  assert.equal(frames.pending(), 1, "the input and the render coalesce into one frame");
  frames.flush();
  assert.equal(mirror.writes, 2);
  assert.match(mirror.innerHTML, /hui-draft-bold">bold/u);

  // A new mirror element holds no markup: it paints the value the textarea already had.
  const replacement = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, replacement as unknown as HTMLElement);
  frames.flush();
  assert.equal(replacement.writes, 1, "a replaced mirror is painted even when the draft did not change");
  assert.match(replacement.innerHTML, /hui-draft-bold">bold/u);
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
});

test("composition pauses the mirror while the IME owns the draft", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  frames.flush();
  const painted = mirror.writes;

  setComposerMirrorComposing(textarea as unknown as HTMLTextAreaElement, true);
  assert.ok(textarea.parentElement.attributes.has("data-composing"), "the textarea shows its own text while composing");
  textarea.value = "**に**";
  textarea.fire("input");
  frames.flush();
  assert.equal(mirror.writes, painted, "a composing draft is not painted");

  setComposerMirrorComposing(textarea as unknown as HTMLTextAreaElement, false);
  assert.ok(!textarea.parentElement.attributes.has("data-composing"));
  assert.equal(frames.pending(), 1, "the end of composition repaints");
  frames.flush();
  assert.equal(mirror.writes, painted + 1);
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
});

test("the mirror copies the box, the text metrics, the scroll and the fade", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (property: string) => STYLE[property] ?? "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  textarea.scrollTop = 42;
  textarea.scrollLeft = 7;
  textarea.toggleAttribute("data-scroll-fade-top", true);
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  frames.flush();

  assert.equal(mirror.style.get("font-family"), "Inter, sans-serif");
  assert.equal(mirror.style.get("font-size"), "16px");
  assert.equal(mirror.style.get("line-height"), "24px");
  assert.equal(mirror.style.get("white-space"), "pre-wrap");
  assert.equal(mirror.style.get("padding"), "6px 0px");
  assert.equal(mirror.style.get("width"), `${textarea.clientWidth}px`, "border-box, so the draft wraps where the textarea does");
  assert.equal(mirror.scrollTop, 42);
  assert.equal(mirror.scrollLeft, 7);
  assert.ok(mirror.attributes.has("data-scroll-fade-top"));
  assert.ok(!mirror.attributes.has("data-scroll-fade-bottom"));

  // Scrolling follows the textarea without waiting for a frame.
  textarea.scrollTop = 90;
  textarea.scrollLeft = 0;
  textarea.toggleAttribute("data-scroll-fade-top", false);
  textarea.toggleAttribute("data-scroll-fade-bottom", true);
  textarea.fire("scroll");
  assert.equal(mirror.scrollTop, 90);
  assert.equal(mirror.scrollLeft, 0);
  assert.ok(!mirror.attributes.has("data-scroll-fade-top"));
  assert.ok(mirror.attributes.has("data-scroll-fade-bottom"));

  // A control measured before layout keeps the stylesheet's inset instead of a 0 width.
  textarea.clientWidth = 0;
  textarea.value = "x";
  textarea.fire("input");
  frames.flush();
  assert.equal(mirror.style.has("width"), false);
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
});

test("a draft above the formatter's cap paints plain lines", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  frames.flush();

  textarea.value = `**bold** ${"a".repeat(MAX_FORMATTED_LENGTH)}`;
  textarea.fire("input");
  frames.flush();
  assert.doesNotMatch(mirror.innerHTML, /hui-draft-(?:bold|marker)|<div class="hui-draft-line hui-draft/u);
  assert.equal((mirror.innerHTML.match(/<div class="hui-draft-line">/gu) ?? []).length, 1, "one plain line, in one redraw");

  // Dropping back below the cap restores the formatting.
  textarea.value = "**bold**";
  textarea.fire("input");
  frames.flush();
  assert.match(mirror.innerHTML, /hui-draft-bold/u);
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
});

test("mounting twice keeps one listener and one frame, and disconnecting drops both", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  assert.equal(textarea.listenerCount("input"), 1);
  assert.equal(frames.pending(), 1);
  frames.flush();

  textarea.value = "**a**";
  textarea.fire("input");
  frames.flush();
  assert.equal(mirror.writes, 2);

  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
  assert.equal(textarea.listenerCount("input"), 0);
  scheduleComposerMirror(textarea as unknown as HTMLTextAreaElement);
  assert.equal(frames.pending(), 0, "a disconnected textarea schedules nothing");
});

test("a textarea is marked ready only while a mirror is mounted under it", () => {
  const frames = fakeFrames();
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const textarea = fakeTextarea();
  const mirror = fakeMirror();
  const ready = (): boolean => textarea.hasAttribute(COMPOSER_MIRROR_READY_ATTRIBUTE);
  assert.equal(ready(), false, "a textarea that mounted nothing keeps its own glyphs");

  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, mirror as unknown as HTMLElement);
  assert.equal(ready(), true, "the paint-only rules may hide the textarea's glyphs once a mirror paints the draft");
  frames.flush();

  // A mount that finds no mirror under the textarea leaves its text visible instead of drawing an empty box.
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, null);
  assert.equal(ready(), false, "a replaced or missing mirror gives the glyphs back");
  assert.equal(textarea.listenerCount("input"), 0);
  assert.equal(frames.pending(), 0);

  const again = fakeMirror();
  mountComposerMirror(textarea as unknown as HTMLTextAreaElement, again as unknown as HTMLElement);
  assert.equal(ready(), true);
  frames.flush();
  disconnectComposerMirror(textarea as unknown as HTMLTextAreaElement);
  assert.equal(ready(), false, "a discarded composer's textarea is not left painting nothing");
});
