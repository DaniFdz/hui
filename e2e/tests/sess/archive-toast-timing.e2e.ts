/** The archive toast lasts 15 seconds untouched, stays longer while focus is inside it, and starts its countdown again
 * once focus leaves (SESS-067). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** Waits, on the page's own clock, until `ms` has passed since `since`: the toast's own timers are what the test reads. */
const elapse = async (since: number, ms: number) => {
  await expect.poll(() => Date.now() - since, { timeout: ms + 20_000, intervals: [200] }).toBeGreaterThanOrEqual(ms);
};

/** Archives a session from its row menu and answers when its toast appeared. */
const archive = async ({ screen, hui }: { screen: Screen; hui: Hui }, title: string) => {
  await hui.sessionList();
  await hui.sessionMenu(title);
  await screen.getByText("Archive session", { visible: true }).tap();
  await expect(screen.getByText(`Archived “${title}”.`)).toBeVisible();
  return Date.now();
};

test("the archive toast lasts 15 seconds untouched, stays while focus is inside it, and starts its countdown again once focus leaves", { tags: ["SESS-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const untouched = "Open the archive toast";
  const watched = "Hold the archive toast";
  const restore = screen.getByRole("button", "Restore");
  const composer = screen.getByPlaceholder("What should this session work on?");
  await hui.createSession({ title: untouched });
  await hui.createSession({ title: watched });
  await hui.open("/");

  // Untouched, it goes by itself only after its 15 seconds.
  const toast = screen.getByText(`Archived “${untouched}”.`);
  const shown = await archive({ screen, hui }, untouched);
  await expect(toast).toBeHidden({ timeout: 60_000 });
  expect(Date.now() - shown).toBeGreaterThanOrEqual(14_000);

  // Focus inside it holds it past those 15 seconds.
  const held = await archive({ screen, hui }, watched);
  const watchedToast = screen.getByText(`Archived “${watched}”.`);
  await restore.focus();
  await expect(restore).toBeFocused();
  await elapse(held, 17_000);
  await expect(watchedToast).toBeVisible();

  // Leaving it starts the 15 seconds again, so it stays a while longer and then goes.
  const left = Date.now();
  await composer.focus();
  await expect(watchedToast).toBeVisible();
  await expect(watchedToast).toBeHidden({ timeout: 60_000 });
  expect(Date.now() - left).toBeGreaterThanOrEqual(14_000);
});
