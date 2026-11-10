/**
 * Reading and renaming an open chat's title at either width.
 *
 * A desktop draws the title as the pane's heading (`[data-testid=session-title]`); a phone replaces that heading with
 * its Active panel selector, whose label ends with the same title ("Active panel: Chat · <title>" with one pane, or
 * "Active panel: <n> · Chat · <title>" beside others, `src/views/home.ts`). A test that read the heading alone would
 * assert a wide arrangement, so every SESS test that names the open chat goes through these two steps instead and
 * proves the same title where a phone shows it. SESS-016, SESS-032, SESS-066.
 */
import { expect, type Locator, type Screen } from "e2e";

/** The control that shows the open pane's title: the heading on a wide screen, the Active panel selector on a phone. */
export const chatHeader = (screen: Screen): Locator => screen.getByTestId("session-title").or(screen.getByRole("button", { name: /^Active panel:/u }));

/**
 * The title the open chat's header reads, whichever of the two the page drew. It returns "" while neither is on screen, so
 * a caller polling for the title retries instead of failing on a locator that matches nothing yet.
 */
export const chatTitle = async (screen: Screen): Promise<string> => {
  const headings = screen.getByTestId("session-title");
  for (let index = 0, count = await headings.count(); index < count; index++) {
    const title = (await headings.nth(index).textContent()) ?? "";
    if (title.trim() !== "") return title;
  }
  const picker = screen.getByRole("button", { name: /^Active panel:/u });
  if (await picker.count() === 0) return "";
  // "Active panel: Chat · Renamed" or "Active panel: 2 · Chat · Renamed": the title is the last segment.
  return ((await picker.first().getAttribute("aria-label")) ?? "").split(" · ").at(-1) ?? "";
};

/** Waits until the open chat's header reads `title`. */
export const expectChatTitle = (screen: Screen, title: string) => expect.poll(() => chatTitle(screen), { timeout: 15_000 }).toBe(title);
