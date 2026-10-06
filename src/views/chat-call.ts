/**
 * How a bot's chat shows its GPT-Live calls (HUI-18), in one place. Each line
 * said on a call is a message of the chat marked `call` (the gateway writes
 * them as `hui.call` entries; no turn runs for them). Today every line shows
 * as its own message with a small "On a call" mark; a different shape (one
 * card per call, say) changes this module and the chat projection only.
 */
import { html, nothing } from "lit";
import type { ChatMessage } from "./chat/projection.ts";
import { voiceIcons } from "./bot-voice.ts";

/** Whether a chat message was said on a call rather than typed. */
export function isCallLine(item: Pick<ChatMessage, "call">): boolean {
  return item.call === true;
}

/** The mark a call line carries above its text. */
export function renderCallLineMark(item: Pick<ChatMessage, "call">) {
  return isCallLine(item) ? html`<span class="chat-bubble__call" title="Said on a call">${voiceIcons.phone}<span>On a call</span></span>` : nothing;
}
