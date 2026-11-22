/** A success toast clears itself inside its 6 seconds and not before, while a failure toast never clears on its own
 * (SHELL-028), read on the app's own clock: the test advances it instead of waiting out the deadline, so both sides of
 * the 6 seconds are asserted. The clock and the clipboard stub go in after the last navigation, which is the only order
 * a WebView can take them in: it has one context, so no init script reaches a page after the one that is open. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a success toast clears itself only once its 6 seconds pass, read on the app's own clock, and a refused copy stays", { tags: ["SHELL-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const copy = async (title: string) => {
    // The row lies in the sidebar, which a phone keeps in its drawer while a chat is open.
    await hui.sessionList();
    const menu = await hui.sessionMenu(title);
    await menu.getByText("Copy", { exact: true, visible: true }).tap();
    await menu.getByText("Session ID", { exact: true, visible: true }).tap();
  };
  const session = await hui.createSession({ title: "Toast on the clock" });
  await hui.open(`/sessions/${session.id}`);
  await hui.controllableClock();
  await hui.clipboard();

  const cleared = screen.getByText("Session ID copied.", { exact: true });
  await copy("Toast on the clock");
  await expect(cleared).toBeVisible();
  // Five seconds of the six: still there.
  await hui.advanceClock(5_000);
  await expect(cleared).toBeVisible();
  // Past the sixth: gone. The two seconds of real time this waits at most are not what clears it — six seconds of the
  // app's own clock are, and the test never waited them out.
  await hui.advanceClock(1_500);
  await expect(cleared).toBeHidden({ timeout: 2_000 });

  // A refused copy is announced as an alert and never clears itself, however long the clock runs.
  const refused = await hui.createSession({ title: "Toast on the clock refused" });
  await hui.open(`/sessions/${refused.id}`);
  await hui.controllableClock();
  await hui.clipboard({ refuse: true });
  await copy("Toast on the clock refused");
  const failed = screen.getByText("Could not copy to the clipboard.", { exact: true });
  await expect(failed).toBeVisible();
  await hui.advanceClock(120_000);
  await expect(failed).toBeVisible();
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(failed).toBeHidden();
});
