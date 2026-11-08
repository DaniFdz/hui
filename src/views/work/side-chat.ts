/**
 * The Side chat kind of Work view: the conversation's `/btw` exchange, drawn by `<hui-side-chat-view>`. `/btw` opens
 * it, and the pane's launcher lists it like any other view, so it resizes, maximizes, collapses and takes a place in
 * the tab strip instead of pinning a rail of its own beside the chat. One per conversation.
 */
import { html } from "lit";
import type { WorkViewKind } from "../../lib/work-pane.ts";

export type SideChatWorkViewRef = { kind: "side-chat" };

/** Lucide message-square at 16px, sized for the launcher and the tab. */
export const sideChatWorkViewIcon = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>`;

export const sideChatWorkViewKind: WorkViewKind<SideChatWorkViewRef> = {
  kind: "side-chat",
  label: "Side chat",
  icon: sideChatWorkViewIcon,
  single: true,
  // The exchange lives in `lib/session/side-chat-store.ts`, in memory: a reload never restores an empty Side chat.
  ephemeral: true,
  create: () => ({ kind: "side-chat" }),
  key: () => "side-chat",
  title: () => "Side chat",
  render: (_ref, ctx) => html`<hui-side-chat-view .sessionId=${ctx.sessionId}></hui-side-chat-view>`,
};
