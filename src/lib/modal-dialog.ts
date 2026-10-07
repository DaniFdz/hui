/**
 * Opening and closing native `<dialog>` elements as modals around Lit's rendering, so the top layer and
 * the page's inert state are always restored.
 */
export type ModalDialog = Pick<HTMLDialogElement, "open" | "showModal" | "close">;

/** Promote a rendered dialog into the browser's top layer exactly once. */
export function ensureModal(dialog: ModalDialog): void {
  if (!dialog.open) dialog.showModal();
}

/** Closing before Lit removes the node restores the native modal/inert state. */
export function closeModal(dialog: ModalDialog | undefined): void {
  if (dialog?.open) dialog.close();
}
