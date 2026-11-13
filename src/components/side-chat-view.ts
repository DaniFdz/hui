/**
 * `<hui-side-chat-view>`: the Side chat Work view, which draws the conversation's `/btw` exchange — the question, the
 * utility model's answer (Markdown) or why it failed, and the note that neither entered the conversation. The state and
 * who may change it belong to `lib/session/side-chat-store.ts`; this element only subscribes and draws.
 *
 * `rail` draws it as the inline panel a chat without a Work pane shows instead (a bot's chat): its own header and close
 * button, and nothing at all until a question was asked. The view inside the Work pane leaves the header to the pane's
 * tab strip, and a conversation with no exchange yet says how to ask, because the question is typed in the composer.
 */
import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { HuiElement } from "../lit/hui-element.ts";
import { renderMarkdown } from "../lib/markdown/markdown.ts";
import { clearSideChat, sideChatFor, subscribeSideChat } from "../lib/session/side-chat-store.ts";
import { icons } from "../lib/icons.ts";

@customElement("hui-side-chat-view")
export class SideChatView extends HuiElement {
  @property() sessionId = "";
  @property({ type: Boolean }) rail = false;
  #stop: (() => void) | undefined;

  override connectedCallback() {
    super.connectedCallback();
    this.#stop = subscribeSideChat(({ sessionId }) => { if (sessionId === this.sessionId) this.requestUpdate(); });
  }

  override disconnectedCallback() {
    this.#stop?.();
    this.#stop = undefined;
    super.disconnectedCallback();
  }

  override updated() {
    // A rail that was never used takes no room beside the chat; the Work view keeps its tab and explains how to ask.
    this.hidden = this.rail && !sideChatFor(this.sessionId);
  }

  override render() {
    const sideChat = sideChatFor(this.sessionId);
    if (!sideChat) {
      return this.rail ? nothing : html`<div class="side-chat side-chat--empty">
        <p>Ask about this conversation with <code>/btw &lt;question&gt;</code> in the composer. The answer stays here and never enters the transcript.</p>
      </div>`;
    }
    return html`${this.rail ? html`<header class="side-chat__rail-header">
        <div><strong>Side chat</strong><span>Ephemeral · ${sideChat.model || "utility model"}</span></div>
        <button type="button" class="btn btn--ghost btn--icon chat-icon-btn" aria-label="Close Side chat" @click=${() => clearSideChat(this.sessionId)}>${icons.close}</button>
      </header>` : html`<p class="side-chat__meta">Ephemeral · ${sideChat.model || "utility model"}</p>`}
      <div class="side-chat__thread" role="status" aria-live="polite">
        <div class="side-chat__question">${sideChat.question}</div>
        ${sideChat.loading
          ? html`<div class="chat-working-indicator"><span class="chat-working-indicator__mark" aria-hidden="true"><i></i><i></i><i></i></span><span>Asking utility model…</span></div>`
          : sideChat.error
            ? html`<div class="side-chat__error" role="alert">${sideChat.error}</div>`
            : html`<div class="side-chat__answer">${renderMarkdown(sideChat.answer)}</div>`}
      </div>
      <p class="side-chat__note">This exchange is not added to the main transcript.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "hui-side-chat-view": SideChatView }
}
