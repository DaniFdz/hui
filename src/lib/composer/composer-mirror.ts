/**
 * The composer mirror's DOM glue: it paints `markdown-draft.ts`'s lines into the paint-only div under the chat
 * composer's textarea, and keeps that div's box, text metrics and scroll exactly on the textarea's so the two overlay
 * character for character.
 *
 * It only ever reads the textarea (value, clientWidth, scroll, computed style) and marks it ready while a mirror is
 * mounted: the textarea stays the editor, so nothing here calls `requestUpdate`, writes `value`, or takes focus. Any
 * number of inputs inside one frame cost one redraw, composition pauses it while an IME owns the draft, and a resize or
 * a late webfont re-copies the metrics.
 */
import { formatDraft, renderDraftHtml } from "./markdown-draft.ts";

/** The mirror is the textarea's previous sibling inside the composer's combobox. */
export const COMPOSER_MIRROR_CLASS = "agent-chat__composer-mirror";

/** Set on a textarea only while its mirror is mounted: the paint-only rules that hide the textarea's own glyphs hang
 * off it, so a composer whose mirror never mounted keeps its text instead of drawing an empty box. */
export const COMPOSER_MIRROR_READY_ATTRIBUTE = "data-composer-mirror-ready";

/** The box and text metrics that decide where every glyph sits and where the draft wraps, so they are copied as they
 * compute rather than restated in CSS. */
const METRICS = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant-ligatures",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "direction",
  "white-space",
  "overflow-wrap",
  "word-break",
  "tab-size",
  "padding",
  "text-indent",
  "text-align",
] as const;

/** What the mirror paints and highlights, and the scroll fade the textarea already carries. */
type ComposerMirrorState = {
  mirror: HTMLElement;
  /** The value the mirror's markup was built from: a frame only rebuilds it when the draft changed, so a streaming
   * transcript's renders cost metrics and scroll, never a parse and a layout of the whole draft. */
  lastValue: string | null;
  frame: number | null;
  composing: boolean;
  observer: ResizeObserver | null;
  events: AbortController;
  fonts: FontFaceSet | null;
  onFonts: (() => void) | null;
};

const states = new WeakMap<HTMLTextAreaElement, ComposerMirrorState>();

const requestFrame = (callback: () => void): number => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(() => callback());
  // A test double without frames still paints, just after the frame handle is recorded.
  queueMicrotask(callback);
  return 0;
};
const cancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
};

function composerMirrorFor(textarea: HTMLTextAreaElement): HTMLElement | null {
  const sibling = textarea.previousElementSibling as HTMLElement | null;
  return sibling?.classList?.contains(COMPOSER_MIRROR_CLASS) ? sibling : null;
}

function setStyle(element: HTMLElement, property: string, value: string | null): void {
  if (value === null) element.style.removeProperty(property);
  else element.style.setProperty(property, value);
}

/** Copies what decides a glyph's position, then the width the draft wraps in: the textarea's padding box. */
function copyMetrics(textarea: HTMLTextAreaElement, state: ComposerMirrorState): void {
  const computed = typeof getComputedStyle === "function" ? getComputedStyle(textarea) : undefined;
  if (computed) for (const property of METRICS) setStyle(state.mirror, property, computed.getPropertyValue(property));
  // Border-box, so padding is part of it; a control measured before layout keeps the inset rule instead of a 0 width.
  setStyle(state.mirror, "width", textarea.clientWidth > 0 ? `${textarea.clientWidth}px` : null);
}

function syncScroll(textarea: HTMLTextAreaElement, state: ComposerMirrorState): void {
  const mirror = state.mirror;
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  for (const attribute of ["data-scroll-fade-top", "data-scroll-fade-bottom"]) {
    if (textarea.hasAttribute(attribute)) mirror.setAttribute(attribute, "");
    else mirror.removeAttribute(attribute);
  }
}

/** Replays the draft under the textarea. The frame reads the live value, so a draft a rewind, a reply, a recovered
 * send or a stored draft replaced is painted whether or not an input event arrived. Only a changed value rebuilds the
 * markup: the frame still copies the box and the fade every time, so a reflow lands on the mirror too. */
function paint(textarea: HTMLTextAreaElement): void {
  const state = states.get(textarea);
  if (!state || state.composing) return;
  if (state.lastValue !== textarea.value) {
    state.mirror.innerHTML = renderDraftHtml(formatDraft(textarea.value));
    state.lastValue = textarea.value;
  }
  copyMetrics(textarea, state);
  syncScroll(textarea, state);
}

/** Coalesces any number of changes inside one animation frame into one redraw. */
export function scheduleComposerMirror(textarea: HTMLTextAreaElement): void {
  const state = states.get(textarea);
  if (!state || state.frame !== null) return;
  state.frame = requestFrame(() => {
    if (states.get(textarea) !== state) return;
    state.frame = null;
    paint(textarea);
  });
}

/** Pauses the mirror while an IME owns the draft: the textarea shows its own text until composition ends. */
export function setComposerMirrorComposing(textarea: HTMLTextAreaElement, composing: boolean): void {
  const state = states.get(textarea);
  if (!state) return;
  state.composing = composing;
  if (composing) textarea.parentElement?.setAttribute("data-composing", "");
  else textarea.parentElement?.removeAttribute("data-composing");
  if (!composing) scheduleComposerMirror(textarea);
}

/** Mounts the mirror for a textarea, replacing any earlier mount: Lit hands the same textarea back on every render. */
export function mountComposerMirror(textarea: HTMLTextAreaElement, mirror: HTMLElement | null = composerMirrorFor(textarea)): void {
  const previous = states.get(textarea);
  if (previous) {
    if (previous.mirror === mirror) {
      scheduleComposerMirror(textarea);
      return;
    }
    disconnectComposerMirror(textarea);
  }
  if (!mirror) {
    // No mirror under this textarea: nothing paints the draft, so the textarea keeps its own glyphs.
    textarea.toggleAttribute(COMPOSER_MIRROR_READY_ATTRIBUTE, false);
    return;
  }
  const state: ComposerMirrorState = {
    // A new mirror element holds no markup yet: its first frame paints even a value the previous one already had.
    mirror,
    lastValue: null,
    frame: null,
    composing: false,
    observer: null,
    events: new AbortController(),
    fonts: null,
    onFonts: null,
  };
  states.set(textarea, state);
  textarea.toggleAttribute(COMPOSER_MIRROR_READY_ATTRIBUTE, true);
  const options = { passive: true, signal: state.events.signal };
  textarea.addEventListener("input", () => scheduleComposerMirror(textarea), options);
  textarea.addEventListener("scroll", () => syncScroll(textarea, state), options);
  if (typeof ResizeObserver === "function") {
    state.observer = new ResizeObserver(() => {
      if (states.get(textarea) !== state) return;
      copyMetrics(textarea, state);
      scheduleComposerMirror(textarea);
    });
    state.observer.observe(textarea);
  }
  // A webfont arriving after first paint changes every advance: re-copy rather than keep the fallback face's wrapping.
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (fonts) {
    state.fonts = fonts;
    state.onFonts = () => {
      copyMetrics(textarea, state);
      scheduleComposerMirror(textarea);
    };
    fonts.addEventListener("loadingdone", state.onFonts);
  }
  scheduleComposerMirror(textarea);
}

/** Drops a textarea's mirror: its listeners, its pending frame and its observers. */
export function disconnectComposerMirror(textarea: HTMLTextAreaElement): void {
  const state = states.get(textarea);
  if (!state) return;
  states.delete(textarea);
  textarea.toggleAttribute(COMPOSER_MIRROR_READY_ATTRIBUTE, false);
  if (state.frame !== null) cancelFrame(state.frame);
  state.observer?.disconnect();
  state.events.abort();
  if (state.fonts && state.onFonts) state.fonts.removeEventListener("loadingdone", state.onFonts);
  if (state.composing) textarea.parentElement?.removeAttribute("data-composing");
}
