/** Conversation-position interaction adapted from OpenClaw 2026.9.5.
 * Uses the pinned chat/message-layout.css; see THIRD_PARTY_NOTICES.md.
 * HUI measures its non-virtualized PI projection instead of OpenClaw sessions. */
import { html, nothing } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import {
  conversationFocusIndex,
  conversationPosition,
  type ConversationMarker,
  type MessagePosition,
} from "./position-rail-model.ts";

type RailProps = {
  sessionId: string;
  markers: readonly ConversationMarker[];
  onNavigate: (thread: HTMLElement, top: number) => void;
};

const HINT = "Use arrow keys or Home and End to choose a marker, Enter or Space to jump, and Escape to return to the conversation. Tab leaves the rail.";

/** Own ephemeral DOM state here: scrolling must not rerender the whole app. */
class ConversationPositionRail extends AsyncDirective {
  private props: RailProps | undefined;
  private marks: HTMLElement | undefined;
  private thread: HTMLElement | undefined;
  private inner: HTMLElement | undefined;
  private observer: ResizeObserver | undefined;
  private frame: number | undefined;
  private geometryDirty = true;
  private positions: MessagePosition[] = [];
  private targets = new Map<string, HTMLElement>();
  private buttons = new Map<string, HTMLButtonElement>();
  private hoveredId: string | undefined;
  private focusedId: string | undefined;
  private activeId: string | undefined;
  private dismissed = false;
  private keyboardNavigation = false;
  private wasVisible = false;
  private previewWindow: Window | null = null;

  private readonly escapePreview = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || this.dismissed || !this.marks?.clientHeight) return;
    event.preventDefault();
    event.stopPropagation();
    const ownsFocus = this.marks.contains(this.marks.ownerDocument.activeElement);
    this.hoveredId = this.focusedId = undefined;
    this.dismissed = true;
    if (ownsFocus) this.thread?.focus({ preventScroll: true });
    this.refresh();
  };

  private readonly bindPreview = (element?: Element) => {
    this.previewWindow?.removeEventListener("keydown", this.escapePreview, true);
    this.previewWindow = element?.ownerDocument.defaultView ?? null;
    this.previewWindow?.addEventListener("keydown", this.escapePreview, true);
    this.schedule();
  };

  private readonly schedule = () => {
    if (!this.isConnected || !this.marks || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.sync();
    });
  };

  private readonly resized = () => {
    this.geometryDirty = true;
    this.schedule();
  };

  private readonly bind = (element?: Element) => {
    this.cleanup();
    this.marks = element instanceof HTMLElement ? element : undefined;
    this.resized();
  };

  private cleanup() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.thread?.removeEventListener("scroll", this.schedule);
    this.thread = undefined;
    this.inner = undefined;
    this.targets.clear();
    this.buttons.clear();
    this.positions = [];
    this.wasVisible = false;
  }

  protected override disconnected() { this.bindPreview(); this.cleanup(); }
  protected override reconnected() { this.resized(); }

  private refresh() {
    if (this.props && this.isConnected) this.setValue(this.template());
    this.schedule();
  }

  private revealMarker(button: HTMLElement) {
    const marks = this.marks;
    if (!marks || !marks.clientHeight) return;
    const inset = Math.min(60, marks.clientHeight / 4);
    if (button.offsetTop < marks.scrollTop + inset || button.offsetTop + button.offsetHeight > marks.scrollTop + marks.clientHeight - inset) {
      // scrollIntoView would also scroll the conversation when only browsing.
      marks.scrollTop = button.offsetTop + button.offsetHeight / 2 - marks.clientHeight / 2;
    }
  }

  private sync() {
    const marks = this.marks;
    const thread = marks?.closest<HTMLElement>(".chat-thread");
    const inner = thread?.querySelector<HTMLElement>(".chat-thread-inner");
    if (!marks?.isConnected || !thread || !inner) return;
    if (thread !== this.thread || inner !== this.inner) {
      this.cleanup();
      this.thread = thread;
      this.inner = inner;
      thread.addEventListener("scroll", this.schedule, { passive: true });
      this.observer = new ResizeObserver(this.resized);
      for (const element of [thread, inner, marks]) this.observer.observe(element);
      this.geometryDirty = true;
    }
    // A retained view out of sight is not laid out; measuring it would lay out
    // its whole transcript. Showing it again renders the rail, which resyncs.
    if (thread.checkVisibility?.() === false) return;

    const conversation = thread.closest<HTMLElement>(".chat-main__conversation") ?? thread;
    thread.style.setProperty("--chat-position-rail-viewport-height", `${conversation.clientHeight}px`);
    const gutter = inner.getBoundingClientRect().left - thread.getBoundingClientRect().left - thread.clientLeft;
    // The thread's content box, which the pinned `chat-transcript` size
    // container query measured before HUI dropped it (openclaw-chat.css).
    const box = getComputedStyle(thread);
    const width = thread.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
    const height = thread.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
    marks.style.setProperty("--chat-position-thread-height", `${height}px`);
    thread.toggleAttribute("data-position-rail-gutter", gutter >= 68 && width > 960 && height > 360);
    const visible = marks.clientHeight > 0;
    if (!visible) {
      const hadPreview = !!(this.hoveredId || this.focusedId);
      if (this.focusedId) {
        thread.focus({ preventScroll: true });
        this.focusedId = undefined;
      }
      this.hoveredId = undefined;
      this.dismissed = true;
      this.wasVisible = false;
      if (hadPreview) this.refresh();
      return;
    }
    if (!this.wasVisible) this.geometryDirty = true;
    if (this.geometryDirty) {
      this.geometryDirty = false;
      this.targets = new Map(Array.from(inner.querySelectorAll<HTMLElement>(".chat-bubble[data-message-id]"), (element) => [element.dataset.messageId!, element]));
      this.buttons = new Map(Array.from(marks.querySelectorAll<HTMLButtonElement>("[data-position-marker-id]"), (element) => [element.dataset.positionMarkerId!, element]));
      const origin = thread.getBoundingClientRect().top + thread.clientTop - thread.scrollTop;
      this.positions = (this.props?.markers ?? []).flatMap(({ id }) => {
        const target = this.targets.get(id);
        if (!target) return [];
        const box = target.getBoundingClientRect();
        return [{ id, top: box.top - origin, bottom: box.bottom - origin }];
      });
    }

    // The transcript extends underneath the composer; that strip is not
    // visible, but the live edge still uses the native scrollport's maximum.
    const viewportHeight = Math.min(thread.clientHeight, conversation.clientHeight);
    const obscuredHeight = thread.clientHeight - viewportHeight;
    const { activeId, visibleIds } = conversationPosition(this.positions, thread.scrollTop, viewportHeight, thread.scrollHeight - obscuredHeight);
    const activeChanged = this.activeId !== activeId;
    this.activeId = activeId;
    const tabStop = this.focusedId ?? activeId ?? this.props?.markers[0]?.id;
    for (const [id, button] of this.buttons) {
      button.toggleAttribute("data-visible", visibleIds.has(id));
      button.setAttribute("aria-current", String(id === activeId));
      button.tabIndex = id === tabStop ? 0 : -1;
    }
    if ((activeChanged || !this.wasVisible) && !(this.keyboardNavigation && this.focusedId) && !this.hoveredId) {
      const current = this.buttons.get(activeId ?? "");
      if (current) this.revealMarker(current);
    }
    this.wasVisible = true;
    marks.style.setProperty("--chat-position-scroll-top", `${marks.scrollTop}px`);
    marks.toggleAttribute("data-overflow-top", marks.scrollTop > 1);
    const last = marks.lastElementChild?.firstElementChild as HTMLElement | null;
    marks.toggleAttribute("data-overflow-bottom", !!last && last.offsetTop + last.offsetHeight - marks.clientHeight - marks.scrollTop > 1);
    const preview = marks.parentElement?.querySelector<HTMLElement>(".chat-position-rail__preview");
    const marker = this.buttons.get(this.previewId ?? "");
    if (preview && marker) {
      const center = marker.offsetTop + marker.offsetHeight / 2 - marks.scrollTop;
      preview.style.setProperty("--chat-position-preview", `${center}px`);
      preview.style.visibility = center < 0 || center > marks.clientHeight ? "hidden" : "";
    }
  }

  private jump(id: string) {
    // Measure at activation too: expanded code, fonts or activity may have moved.
    const target = this.targets.get(id);
    const thread = this.thread;
    if (!target || !thread) return;
    const top = target.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 16;
    this.props?.onNavigate(thread, Math.max(0, top));
    this.schedule();
  }

  private keydown(event: KeyboardEvent, index: number) {
    const next = conversationFocusIndex(event.key, index, this.props?.markers.length ?? 0);
    if (next !== undefined) {
      this.keyboardNavigation = true;
      this.hoveredId = undefined;
      event.preventDefault();
      event.stopPropagation();
      this.buttons.get(this.props!.markers[next]!.id)?.focus({ preventScroll: true });
      this.refresh();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.hoveredId = undefined;
      this.focusedId = undefined;
      this.dismissed = true;
      this.thread?.focus({ preventScroll: true });
      this.refresh();
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.stopPropagation();
    }
  }

  render(props: RailProps) {
    if (props.sessionId !== this.props?.sessionId) {
      this.hoveredId = this.focusedId = this.activeId = undefined;
      this.dismissed = false;
      this.keyboardNavigation = false;
      this.wasVisible = false;
      if (this.marks) this.marks.scrollTop = 0;
    }
    this.props = props;
    if (!props.markers.some((m) => m.id === this.hoveredId)) this.hoveredId = undefined;
    if (!props.markers.some((m) => m.id === this.focusedId)) this.focusedId = undefined;
    this.geometryDirty = true;
    this.schedule();
    return this.template();
  }

  private template() {
    const markers = this.props?.markers ?? [];
    if (!markers.length) return nothing;
    const preview = this.dismissed ? undefined : markers.find((m) => m.id === this.previewId);
    return html`<aside class="chat-position-rail" aria-label="Conversation position"
      style=${`--chat-position-rail-count: ${markers.length}`}
      @pointerleave=${() => { this.hoveredId = undefined; this.refresh(); }}>
      <div class="chat-position-rail__track">
        <div class="chat-position-rail__marks" role="list" aria-label="Conversation markers"
          ${ref(this.bind)} @scroll=${this.schedule}>
          ${repeat(markers, (marker) => marker.id, (marker, index) => html`<div class="chat-position-rail__item" role="listitem">
            <button class="chat-position-rail__marker" type="button" data-position-marker-id=${marker.id}
              tabindex=${marker.id === (this.focusedId ?? this.activeId ?? markers[0]?.id) ? "0" : "-1"}
              aria-label=${`${marker.label}, marker ${index + 1} of ${markers.length}`}
              aria-description=${`${marker.preview}. ${HINT}`} aria-current="false"
              @pointerenter=${() => { this.hoveredId = marker.id; this.dismissed = false; this.refresh(); }}
              @pointermove=${() => {
                if (!this.keyboardNavigation) return;
                this.keyboardNavigation = false;
                this.hoveredId = marker.id;
                this.dismissed = false;
                this.refresh();
              }}
              @focus=${(event: FocusEvent) => {
                this.focusedId = marker.id;
                this.dismissed = false;
                const button = event.currentTarget as HTMLElement;
                if (button.matches(":focus-visible")) {
                  this.keyboardNavigation = true;
                  this.revealMarker(button);
                }
                this.refresh();
              }}
              @blur=${() => { this.focusedId = undefined; this.refresh(); }}
              @keydown=${(event: KeyboardEvent) => this.keydown(event, index)}
              @click=${() => this.jump(marker.id)}>
              <span class="chat-position-rail__tick" aria-hidden="true"></span>
            </button>
          </div>`)}
        </div>
        ${preview ? html`<div class="chat-position-rail__preview" aria-hidden="true" ${ref(this.bindPreview)}>
          <div class="chat-position-rail__preview-header"><span class="chat-position-rail__preview-label">${preview.label}</span></div>
          <div class="chat-position-rail__preview-copy" inert>${preview.preview}</div>
        </div>` : nothing}
      </div>
    </aside>`;
  }

  private get previewId() {
    // Scrolling the marks can fire pointerenter underneath a stationary mouse.
    // Keyboard browsing keeps its own preview until the pointer actually moves.
    return this.keyboardNavigation ? this.focusedId ?? this.hoveredId : this.hoveredId ?? this.focusedId;
  }
}

export const positionRail = directive(ConversationPositionRail);
