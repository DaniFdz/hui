/** Closing a terminal tab leaves its shell running and the Running menu reopens it (WORK-028). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("closing a terminal tab leaves its shell running and the Running menu reopens it", { tags: ["WORK-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Reopen terminal" });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  await expect(screen.getByLabel("Shared terminal input")).toBeVisible();
  await expect(screen.getByText("Shared · Connected")).toBeVisible();

  await pane.getByRole("button", "Close Terminal 1").tap();
  await expect(pane.getByRole("tab")).toHaveCount(0);
  // Closing the last tab collapses the pane to its rail, so bring it back before its + menu.
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(/Terminal 1/u).last().tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toBeVisible();
  await expect(screen.getByLabel("Shared terminal input")).toBeVisible();
});
