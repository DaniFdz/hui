/**
 * Where the chat composer's caret goes once a send has landed. The operator presses Enter to send and expects to keep
 * typing, and the send disables the textarea, which drops the page's focus; so a send that started in the composer takes
 * the caret back when the post is over — but only where nothing else holds it, never over a control the operator moved
 * to while the send was in flight. The view in `views/home.ts` records the send and reads this rule once the textarea is
 * enabled again; nothing here opens or closes the Run status popover, or any other surface.
 */
export type ComposerFocusOwner = "body" | "send-control" | "elsewhere";

/**
 * Whether the chat textarea takes the focus back after its send landed. `fromComposer` says the send started with the
 * caret inside the composer's own form, and `owner` is where the page's focus is now: nowhere (`body`), still on the
 * exact control that held focus when the send started (`send-control`, the send button or another composer control), or
 * a control the operator moved to during the send (`elsewhere`). Focusing back must never steal the caret the operator
 * placed or kept somewhere else, and a send that started outside the composer never moves it at all.
 */
export function composerFocusAfterSend(input: { fromComposer: boolean; owner: ComposerFocusOwner }): boolean {
  if (!input.fromComposer) return false;
  return input.owner === "body" || input.owner === "send-control";
}
