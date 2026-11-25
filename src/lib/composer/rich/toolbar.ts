/**
 * The composer selection's formatting toolbar: the compact strip a secondary click — or the keyboard's ContextMenu key,
 * Shift+F10 — opens over a selection in the rich composer.
 *
 * It owns the strip as a surface: its buttons, where it sits on screen, which of them the keyboard is on, and the three
 * clipboard items. It never owns the document's content: a formatting button runs a command through the editor
 * (`COMPOSER_ACTIONS`, in `keys.ts`), and pasted text goes back through the editor's own plain-text paste mapping.
 *
 * The strip is a manual popover appended to `document.body`, so it draws in the top layer: the composer's own
 * `overflow`, its fade mask and the container query around it cannot clip it, and it never takes room in the composer.
 * It is `position: fixed`, sits above the selection with an 8px gap, flips below it when there is no room above, and is
 * clamped 8px inside the visual viewport — a phone with its keyboard up moves that viewport, and the strip follows it
 * until the selection it was opened on leaves it.
 *
 * Keyboard: one button is on the tab order at a time (roving `tabindex`), arrows step between the enabled buttons and
 * Home/End go to the ends, and Escape closes the strip and gives the editor its focus back. A disabled button is a real
 * `disabled` one: `formatState`'s dry run of the command is what says the document cannot take that action.
 *
 * Clipboard: Cut and Copy run `document.execCommand` inside the click's own gesture, so the clipboard keeps the flavours
 * the browser wrote (Copy falls back to `navigator.clipboard.writeText` where the command is refused). Paste is read
 * through `navigator.clipboard.readText()` when the strip opens, and stays disabled while that read is refused. An empty
 * selection never opens the strip, so the platform's own menu — and its paste — is still there.
 */
import { COMPOSER_ACTIONS, type ComposerAction, type ComposerActionId, type FormatState } from "./keys.ts";

/** The viewport the strip is clamped to, in the coordinates `window.visualViewport` reports. */
export type ViewportRect = { left: number; top: number; right: number; bottom: number };

/** The selection the strip is anchored to: its client rect, in viewport coordinates. */
export type ToolbarAnchor = { left: number; top: number; right: number; bottom: number };

/** A box the strip is placed against and a box it must stay inside. */
export type PlacementInput = {
  anchor: ToolbarAnchor;
  size: { width: number; height: number };
  viewport: ViewportRect;
};

/** The room the strip keeps from the viewport's edges, and the gap it keeps from the selection. */
export const TOOLBAR_PADDING = 8;
export const TOOLBAR_GAP = 8;

/** The strip's buttons: the actions table, in the groups the toolbar draws. */
const ACTIONS: readonly ComposerAction[] = COMPOSER_ACTIONS;

/** What a button says when it is too narrow for its label: the glyph, never the accessible name. */
const GLYPHS: Readonly<Record<ComposerActionId, string>> = {
  bold: "B",
  italic: "I",
  strike: "S",
  "inline-code": "</>",
  quote: "❝",
  note: "ⓘ",
  "bullet-list": "•",
  "code-block": "▦",
  text: "¶",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
};

/** Keeps a number between `low` and `high`, and at `low` when there is no room for either. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Where the strip goes: centred on the anchor and above it, below it when there is no room above, and always clamped
 * `TOOLBAR_PADDING` inside the viewport — so a selection near an edge or under a keyboard still gets a whole strip.
 */
export function placeToolbar({ anchor, size, viewport }: PlacementInput): { left: number; top: number } {
  const low = TOOLBAR_PADDING;
  const highest = viewport.top + low;
  const lowest = viewport.bottom - low - size.height;
  const above = anchor.top - TOOLBAR_GAP - size.height;
  const below = anchor.bottom + TOOLBAR_GAP;
  const top = above >= highest ? above : below <= lowest ? below : clamp(above, highest, lowest);
  const left = clamp((anchor.left + anchor.right) / 2 - size.width / 2, viewport.left + low, viewport.right - low - size.width);
  return { left, top: clamp(top, highest, lowest) };
}

/**
 * The button a key moves focus to, counted among the enabled ones: arrows step and wrap, Home and End go to the ends.
 * `undefined` when the key is not the toolbar's, or when no button is enabled.
 */
export function roveTarget(count: number, current: number, key: string): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (step === 0) return undefined;
  if (current < 0 || current >= count) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** The visual viewport, or the window when the browser does not report one. */
function viewportRect(): ViewportRect {
  const visual = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!visual) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  return { left: visual.offsetLeft, top: visual.offsetTop, right: visual.offsetLeft + visual.width, bottom: visual.offsetTop + visual.height };
}

/** Whether a rect still shows inside the viewport: a selection scrolled out of it is no place for a strip. */
function insideViewport(anchor: ToolbarAnchor, viewport: ViewportRect): boolean {
  return anchor.bottom >= viewport.top && anchor.top <= viewport.bottom && anchor.right >= viewport.left && anchor.left <= viewport.right;
}

/** Everything the strip needs from the editor it belongs to. */
export type ComposerToolbarOptions = {
  /** Runs one formatting action through the editor: the strip's buttons are the table's own. */
  run(action: ComposerActionId): void;
  /** Inserts pasted plain text through the editor's own mapping, so its lines become paragraphs and breaks. */
  insertText(text: string): void;
  /** Gives the editor its focus back, with the selection it holds. */
  focusEditor(): void;
  /** Told when the strip closes itself, so the editor stops following the selection it was opened on. */
  closed(): void;
};

/** The strip itself: one per editor, alive for as long as the editor is. */
export class ComposerToolbar {
  readonly #options: ComposerToolbarOptions;
  readonly #root: HTMLDivElement;
  readonly #buttons: { action: ComposerAction; button: HTMLButtonElement }[] = [];
  readonly #viewport = new AbortController();
  #anchor: ToolbarAnchor | undefined;
  #paste: { status: "reading" | "ready" | "refused"; text: string } = { status: "reading", text: "" };
  #frame: number | null = null;
  #destroyed = false;

  constructor(options: ComposerToolbarOptions) {
    this.#options = options;
    this.#root = document.createElement("div");
    this.#root.className = "composer-toolbar";
    this.#root.setAttribute("role", "toolbar");
    this.#root.setAttribute("aria-label", "Format selection");
    this.#root.setAttribute("popover", "manual");
    // Hidden as well as closed: a browser without the popover API has no `[popover]` default display to fall back on.
    this.#root.setAttribute("hidden", "");
    this.#root.addEventListener("keydown", (event) => this.#onKeyDown(event));
    // A press on the strip keeps the editor's selection: the action must act on what it was opened over, and the editor
    // must not lose its caret to a button. `mousedown` as well, because only it moves the document's focus in a mouse.
    for (const type of ["pointerdown", "mousedown"] as const) this.#root.addEventListener(type, (event) => event.preventDefault());
    let group: ComposerAction["group"] | undefined;
    for (const action of ACTIONS) {
      if (group !== undefined && action.group !== group) this.#root.append(this.#separator());
      group = action.group;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "composer-toolbar__item";
      button.textContent = GLYPHS[action.id];
      button.setAttribute("aria-label", action.label);
      button.setAttribute("data-hui-tooltip", action.label);
      button.setAttribute("tabindex", "-1");
      button.addEventListener("click", () => this.#activate(action));
      this.#buttons.push({ action, button });
      this.#root.append(button);
    }
    document.body.append(this.#root);
    const signal = this.#viewport.signal;
    window.visualViewport?.addEventListener("resize", () => this.#reanchor(), { signal });
    window.visualViewport?.addEventListener("scroll", () => this.#reanchor(), { signal });
  }

  /** Whether the strip is showing. */
  get isOpen(): boolean {
    return this.#anchor !== undefined;
  }

  /** Shows the strip against `anchor`, keeping the editor's selection. `focus` moves the keyboard onto its first button. */
  open(anchor: ToolbarAnchor, state: FormatState, options: { focus?: boolean } = {}): void {
    if (this.#destroyed) return;
    this.#anchor = anchor;
    this.#paste = { status: "reading", text: "" };
    this.update(state);
    this.#show();
    this.#place();
    this.#readPaste();
    if (options.focus) this.#buttons.find((item) => !item.button.disabled)?.button.focus();
  }

  /** Closes the strip and forgets the selection it was opened on: a closed strip never re-anchors to a stale one. */
  close(): void {
    if (this.#anchor === undefined) return;
    this.#anchor = undefined;
    this.#paste = { status: "reading", text: "" };
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#root.setAttribute("hidden", "");
    try {
      this.#root.hidePopover();
    } catch {
      // A browser without the popover API, or one that already closed it: there is nothing left to hide.
    }
    this.#options.closed();
  }

  /** Refreshes the buttons: what the selection carries, and what the document cannot do to it. */
  update(state: FormatState): void {
    for (const { action, button } of this.#buttons) {
      const entry = state[action.id];
      button.disabled = entry.disabled || (action.id === "paste" && this.#paste.status !== "ready");
      if (!action.command) continue;
      button.setAttribute("aria-pressed", String(entry.pressed));
    }
    this.#roveFocus();
  }

  /** Removes the strip from the document. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.close();
    this.#viewport.abort();
    this.#root.remove();
  }

  /** The strip's own element, which an outside press is measured against. */
  element(): HTMLElement {
    return this.#root;
  }

  #separator(): HTMLElement {
    const separator = document.createElement("span");
    separator.className = "composer-toolbar__separator";
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-orientation", "vertical");
    return separator;
  }

  #show(): void {
    this.#root.removeAttribute("hidden");
    try {
      this.#root.showPopover();
    } catch {
      // A browser without the popover API draws the strip in place: the CSS makes it fixed either way.
    }
  }

  /** Puts the strip above the anchor, or below it, inside the viewport. Measured, then placed, then placed once more on
   * the next frame for the layout that follows being shown. */
  #place(): void {
    const anchor = this.#anchor;
    if (!anchor) return;
    const box = this.#root.getBoundingClientRect();
    const { left, top } = placeToolbar({ anchor, size: { width: box.width, height: box.height }, viewport: viewportRect() });
    this.#root.style.left = `${left}px`;
    this.#root.style.top = `${top}px`;
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      const current = this.#anchor;
      if (!current || this.#destroyed) return;
      const measured = this.#root.getBoundingClientRect();
      const placed = placeToolbar({ anchor: current, size: { width: measured.width, height: measured.height }, viewport: viewportRect() });
      this.#root.style.left = `${placed.left}px`;
      this.#root.style.top = `${placed.top}px`;
    });
  }

  /** A viewport resize or scroll: the strip follows, and closes once its selection has left the viewport. */
  #reanchor(): void {
    const anchor = this.#anchor;
    if (!anchor) return;
    if (!insideViewport(anchor, viewportRect())) {
      this.close();
      return;
    }
    this.#place();
  }

  /** The clipboard's text, read once per opening: a refused read leaves Paste disabled, never a prompt mid-action. */
  #readPaste(): void {
    const read = navigator.clipboard?.readText?.();
    if (!read) {
      this.#paste = { status: "refused", text: "" };
      this.#refreshPaste();
      return;
    }
    read.then((text) => {
      if (this.#anchor === undefined) return;
      this.#paste = { status: "ready", text };
      this.#refreshPaste();
    }, () => {
      if (this.#anchor === undefined) return;
      this.#paste = { status: "refused", text: "" };
      this.#refreshPaste();
    });
  }

  /** Only the Paste button answers a clipboard read: nothing else of the strip changed. */
  #refreshPaste(): void {
    for (const { action, button } of this.#buttons) {
      if (action.id === "paste") button.disabled = this.#paste.status !== "ready";
    }
    this.#roveFocus();
  }

  /** One button on the tab order: the one the keyboard is on, or the first enabled one. */
  #roveFocus(): void {
    const enabled = this.#buttons.filter((item) => !item.button.disabled);
    for (const { button } of this.#buttons) button.setAttribute("tabindex", "-1");
    const current = enabled.find((item) => item.button === document.activeElement) ?? enabled[0];
    current?.button.setAttribute("tabindex", "0");
  }

  #activate(action: ComposerAction): void {
    if (this.#destroyed) return;
    if (action.group === "clipboard") {
      this.#clipboard(action.id);
      return;
    }
    this.#options.run(action.id);
  }

  /**
   * Cut and Copy run the browser's own command with the editor focused, so the clipboard keeps the flavours the rich
   * document wrote; Paste inserts the text read when the strip opened.
   */
  #clipboard(id: ComposerActionId): void {
    if (id === "paste") {
      if (this.#paste.status === "ready") this.#options.insertText(this.#paste.text);
      return;
    }
    this.#options.focusEditor();
    const copied = typeof document.execCommand === "function" && document.execCommand(id);
    if (copied || id !== "copy") return;
    // Where the command is refused, the plain text of the selection still reaches the clipboard.
    const text = window.getSelection?.()?.toString() ?? "";
    if (text) void navigator.clipboard?.writeText?.(text);
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      this.#options.focusEditor();
      return;
    }
    const enabled = this.#buttons.filter((item) => !item.button.disabled).map((item) => item.button);
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const target = roveTarget(enabled.length, current, event.key);
    if (target === undefined) return;
    event.preventDefault();
    enabled[target]?.focus();
  }
}
