/**
 * Owns the sticky prompt bar: the one-line island over the transcript's top edge naming the user turn the reader has
 * scrolled past, which jumps back to it. It measures the thread the way the position rail does and writes the bar's
 * own attributes and text from `sync()`, so scrolling never rerenders the app.
 */
import { html } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import { ref } from "lit/directives/ref.js";
import { icons } from "../../lib/icons.ts";
import { scrolledPastPrompt, type ConversationMarker, type MessagePosition } from "./position-rail-model.ts";

type BarProps = {
  prompts: readonly ConversationMarker[];
  onNavigate: (thread: HTMLElement, top: number) => void;
};

/** The bar's height plus its gap: where the reading line sits, and where a jump lands its prompt. */
const BAR_OFFSET_PX = 34;
/** The pill's own height (4px padding above and below a 18px line, plus its border), kept in step with the CSS: a
 * prompt whose remaining sliver is shorter than this is already hidden behind the bar. */
const BAR_HEIGHT_PX = 26;
/** How far below the bar a jump leaves the prompt it brought back, so the bar names the prompt before it. */
const LANDING_GAP_PX = 8;

type Owner = { id: string; text: string };
type Attached = { scroller: HTMLElement; inner: HTMLElement | undefined };

class StickyPromptBar extends AsyncDirective {
  private props: BarProps | undefined;
  private root: HTMLElement | undefined;
  private button: HTMLButtonElement | undefined;
  private text: HTMLElement | undefined;
  private attached: Attached | undefined;
  private observer: ResizeObserver | undefined;
  private frame: number | undefined;
  private geometryDirty = true;
  private positions: MessagePosition[] = [];
  private owner: Owner | undefined;

  private readonly schedule = () => {
    if (!this.isConnected || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.sync();
    });
  };

  private readonly resized = () => {
    this.geometryDirty = true;
    this.schedule();
  };

  // Lit calls this while the bar still sits in a detached fragment, so the transcript it belongs to is resolved in
  // `sync()`, once the bar is in the document.
  private readonly bind = (element?: Element) => {
    this.cleanup();
    const root = element instanceof HTMLElement ? element : undefined;
    this.root = root;
    this.button = root?.querySelector<HTMLButtonElement>(".chat-sticky-prompt__jump") ?? undefined;
    this.text = root?.querySelector<HTMLElement>(".chat-sticky-prompt__text") ?? undefined;
    this.schedule();
  };

  private cleanup() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.attached?.scroller.removeEventListener("scroll", this.schedule);
    this.attached = undefined;
    this.root = this.button = this.text = undefined;
    this.positions = [];
    this.geometryDirty = true;
  }

  protected override disconnected() {
    this.cleanup();
  }

  protected override reconnected() {
    this.resized();
  }

  private attach(scroller: HTMLElement, inner: HTMLElement) {
    this.observer?.disconnect();
    this.attached?.scroller.removeEventListener("scroll", this.schedule);
    this.attached = { scroller, inner };
    scroller.addEventListener("scroll", this.schedule, { passive: true });
    this.observer = new ResizeObserver(this.resized);
    for (const element of [scroller, inner]) this.observer.observe(element);
    this.geometryDirty = true;
  }

  private sync() {
    const { root, button } = this;
    const scroller = root?.parentElement?.querySelector<HTMLElement>(":scope > .chat-thread");
    const inner = scroller?.querySelector<HTMLElement>(":scope > .chat-thread-inner");
    if (!root || !button || !scroller || !inner) return;
    if (this.attached?.scroller !== scroller || this.attached.inner !== inner) this.attach(scroller, inner);
    // A retained view out of sight is not laid out; measuring it would lay out its whole transcript.
    if (scroller.checkVisibility?.() === false) {
      this.setOwner(undefined);
      return;
    }
    if (this.geometryDirty) {
      this.geometryDirty = false;
      const bubbles = new Map(Array.from(inner.querySelectorAll<HTMLElement>(".chat-bubble[data-message-id]"), (element) => [element.dataset.messageId!, element]));
      const origin = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
      this.positions = (this.props?.prompts ?? []).flatMap((prompt) => {
        const target = bubbles.get(prompt.id);
        if (!target) return [];
        const box = target.getBoundingClientRect();
        return [{ id: prompt.id, top: box.top - origin, bottom: box.bottom - origin }];
      });
    }
    const past = scrolledPastPrompt(this.positions, scroller.scrollTop + BAR_OFFSET_PX, BAR_HEIGHT_PX);
    const prompt = past && this.props?.prompts.find((candidate) => candidate.id === past.id);
    this.setOwner(prompt && { id: prompt.id, text: prompt.preview });
  }

  private setOwner(owner: Owner | undefined) {
    if (this.owner?.id === owner?.id && this.owner?.text === owner?.text) return;
    this.owner = owner;
    const { root, button, text } = this;
    if (!root || !button || !text) return;
    root.setAttribute("data-visible", String(!!owner));
    button.inert = !owner;
    button.tabIndex = owner ? 0 : -1;
    text.textContent = owner?.text ?? "";
    if (owner) button.setAttribute("aria-label", `Jump to your prompt: ${owner.text}`);
    else button.removeAttribute("aria-label");
  }

  private jump() {
    const position = this.owner && this.positions.find((candidate) => candidate.id === this.owner?.id);
    if (!this.attached || !position) return;
    this.props?.onNavigate(this.attached.scroller, Math.max(0, position.top - BAR_OFFSET_PX - LANDING_GAP_PX));
    this.schedule();
  }

  render(props: BarProps) {
    this.props = props;
    this.geometryDirty = true;
    this.schedule();
    return html`<div class="chat-sticky-prompt" data-visible="false" ${ref(this.bind)}>
      <button type="button" class="chat-sticky-prompt__jump" tabindex="-1" inert @click=${() => this.jump()}>
        <span class="chat-sticky-prompt__icon" aria-hidden="true">${icons.arrowUp}</span>
        <span class="chat-sticky-prompt__text"></span>
      </button>
    </div>`;
  }
}

export const stickyPrompt = directive(StickyPromptBar);
