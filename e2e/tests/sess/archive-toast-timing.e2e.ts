/** The archive toast lives 15 seconds, waits while the pointer is over it or focus is inside it, and counts down again once left (SESS-064). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const TIMER = 15_000;

/** Archives a new session from its row menu, returning its toast. */
async function archive(screen: Screen, hui: Hui, title: string): Promise<Locator> {
  await hui.createSession({ title });
  await hui.createSession({ title: "Bystander row" });
  await hui.open("/");
  await hui.sessionMenu(title);
  await screen.getByText("Archive session", { visible: true }).tap();
  const toast = screen.getByText(`Archived “${title}”.`);
  await expect(toast).toBeVisible();
  return toast;
}

/** How long the toast took to go away, measured from the call. */
async function hiddenAfter(toast: Locator): Promise<number> {
  const start = Date.now();
  await expect(toast).toBeHidden({ timeout: TIMER + 15_000 });
  return Date.now() - start;
}

/** Waits until at least `ms` have passed, so a check can look past the 15 second timer without guessing. */
async function waitPast(ms: number): Promise<void> {
  const start = Date.now();
  await expect.poll(() => Date.now() - start, { timeout: ms + 5_000 }).toBeGreaterThanOrEqual(ms);
}

test("an untouched archive toast goes away after 15 seconds", { tags: ["SESS-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toast = await archive(screen, hui, "Timed archive");

  expect(await hiddenAfter(toast)).toBeGreaterThanOrEqual(TIMER - 1_000);
});

test("an archive toast with the pointer over it stays, and counts down again once the pointer leaves it", { tags: ["SESS-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toast = await archive(screen, hui, "Hovered archive");
  const bystander = screen.getByLabel(/^Bystander row, status /u);

  await toast.hover();
  await waitPast(TIMER + 1_000);
  await expect(toast).toBeVisible();
  await bystander.hover();
  expect(await hiddenAfter(toast)).toBeGreaterThanOrEqual(TIMER - 1_000);
});

test("an archive toast with focus inside it stays, and counts down again once focus leaves it", { tags: ["SESS-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const toast = await archive(screen, hui, "Focused archive");
  const search = screen.getByPlaceholder("Search sessions");

  await search.focus();
  await screen.getByRole("button", "Restore").focus();
  await waitPast(TIMER + 1_000);
  await expect(toast).toBeVisible();
  await search.focus();
  expect(await hiddenAfter(toast)).toBeGreaterThanOrEqual(TIMER - 1_000);
});
