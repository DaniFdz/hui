/**
 * Bringing one Settings section (`data-settings-section`) to the top once it renders, and keeping it there while
 * sections above it finish loading and change height (Tools → Browser loads its status asynchronously). It gives up
 * after a short while or as soon as the operator scrolls, so it never fights them.
 */
export type SectionScrollEnvironment = {
  /** The section's element once it is in the DOM. */
  find(): Element | null;
  frame(callback: () => void): unknown;
  now(): number;
  /** Calls `listener` on the operator's own scrolling input (wheel, touch, keys); returns the unsubscribe. */
  onUserScroll(listener: () => void): () => void;
};

/** How long a section is kept in place, and how long it must stay put before the wait ends early. */
export const SECTION_SCROLL_LIMIT_MS = 3000;
export const SECTION_SCROLL_SETTLED_MS = 600;

/** Starts following the section; the returned function stops early. */
export function scrollSectionWhenReady(env: SectionScrollEnvironment): () => void {
  const started = env.now();
  let stopped = false;
  let placedTop: number | undefined;
  let placedAt = started;
  const stopUser = env.onUserScroll(() => stop());
  function stop() {
    if (stopped) return;
    stopped = true;
    stopUser();
  }
  const step = () => {
    if (stopped) return;
    const now = env.now();
    if (now - started > SECTION_SCROLL_LIMIT_MS) return stop();
    const section = env.find();
    if (section) {
      const top = section.getBoundingClientRect().top;
      // Not placed yet, or content above moved it since: (re)place it.
      if (placedTop === undefined || Math.abs(top - placedTop) > 1) {
        section.scrollIntoView({ block: "start" });
        placedTop = section.getBoundingClientRect().top;
        placedAt = now;
      } else if (now - placedAt >= SECTION_SCROLL_SETTLED_MS) return stop();
    }
    env.frame(step);
  };
  env.frame(step);
  return stop;
}

/** The browser environment: frames, the performance clock and wheel/touch/key input on `window`. */
export function scrollSettingsSection(root: ParentNode, section: string): () => void {
  return scrollSectionWhenReady({
    find: () => root.querySelector(`[data-settings-section="${CSS.escape(section)}"]`),
    frame: (callback) => requestAnimationFrame(callback),
    now: () => performance.now(),
    onUserScroll(listener) {
      const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
      for (const type of events) window.addEventListener(type, listener, { passive: true, capture: true });
      return () => { for (const type of events) window.removeEventListener(type, listener, { capture: true }); };
    },
  });
}
