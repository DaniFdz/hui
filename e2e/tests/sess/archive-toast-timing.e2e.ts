/** The archive toast lasts 15 seconds untouched and 15 more after the pointer or focus leaves it, so attention on it never
 * costs the operator the toast mid-read (SESS-067), read on the app's own clock: the test advances it instead of waiting
 * out the deadlines, so both sides of each one are asserted. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the archive toast lasts its 15 seconds untouched and starts that countdown again once the pointer or focus leaves it", { tags: ["SESS-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const untouched = "Open the archive toast";
  const pointed = "Point at the archive toast";
  const watched = "Hold the archive toast";
  const archive = async (title: string) => {
    // The row lies in the sidebar, which a phone keeps in its drawer while a page other than the list is open.
    await hui.sessionList();
    const menu = await hui.sessionMenu(title);
    await menu.getByText("Archive session", { exact: true, visible: true }).tap();
  };
  const toast = (title: string) => screen.getByText(`Archived “${title}”.`);
  // Away from the toast: the launcher's composer, which the home page under every toast still shows.
  const elsewhere = screen.getByPlaceholder("What should this session work on?");

  await hui.createSession({ title: untouched });
  await hui.createSession({ title: pointed });
  await hui.createSession({ title: watched });
  await hui.open("/");
  await hui.controllableClock();

  // Untouched, it is still there a second before its 15 seconds and gone a second after.
  await archive(untouched);
  await expect(toast(untouched)).toBeVisible();
  await hui.advanceClock(14_000);
  await expect(toast(untouched)).toBeVisible();
  await hui.advanceClock(1_500);
  await expect(toast(untouched)).toBeHidden({ timeout: 2_000 });

  // While the pointer is over it, it stays however long the clock runs past those 15 seconds.
  await archive(pointed);
  await expect(toast(pointed)).toBeVisible();
  await hui.advanceClock(10_000);
  await hui.peek(toast(pointed));
  await hui.advanceClock(120_000);
  await expect(toast(pointed)).toBeVisible();
  // Leaving it starts the countdown again rather than resuming it: five of its seconds were left when the pointer arrived,
  // and it is still there five seconds past the leave.
  await hui.peek(elsewhere);
  await hui.advanceClock(10_000);
  await expect(toast(pointed)).toBeVisible();
  await hui.advanceClock(6_000);
  await expect(toast(pointed)).toBeHidden({ timeout: 2_000 });

  // Focus inside it holds it the same way, and focus leaving starts the countdown again.
  await archive(watched);
  await expect(toast(watched)).toBeVisible();
  await screen.getByRole("button", "Restore").focus();
  await expect(screen.getByRole("button", "Restore")).toBeFocused();
  await hui.advanceClock(120_000);
  await expect(toast(watched)).toBeVisible();
  await elsewhere.focus();
  await hui.advanceClock(14_000);
  await expect(toast(watched)).toBeVisible();
  await hui.advanceClock(1_500);
  await expect(toast(watched)).toBeHidden({ timeout: 2_000 });
});
