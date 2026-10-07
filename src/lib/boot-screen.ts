/**
 * index.html's boot screen covers the page from the first paint until the app
 * has rendered: over a slow link that is seconds of downloading, and an empty
 * page in the meantime looks like a broken one.
 */
const BOOT_ID = "hui-boot";

/** Removes the boot screen once the app's first render has landed. */
export async function finishBoot(app: Element | null): Promise<void> {
  await (app as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
  document.getElementById(BOOT_ID)?.remove();
}

/** The app could not start (its code did not download): say so, and offer a reload. */
export function showBootFailure(error: unknown): void {
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  boot.dataset["state"] = "failed";
  const detail = boot.querySelector(".hui-boot__detail");
  if (detail) detail.textContent = bootFailureMessage(error);
  boot.querySelector(".hui-boot__failure button")?.addEventListener("click", () => location.reload(), { once: true });
}

export function bootFailureMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : "";
  // A chunk that did not arrive surfaces as a browser-specific import error.
  return /dynamically imported module|importing a module script|module script failed|failed to fetch/iu.test(reason)
    ? "HUI could not load over this connection."
    : "HUI could not start.";
}
