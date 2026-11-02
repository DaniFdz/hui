/** Selecting a text file opens it in the editor and the tab takes the file's name (WORK-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("selecting a text file opens it in the editor and renames the tab", { tags: ["WORK-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Open a file" });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^Files/u }).tap();
  await screen.getByText("fixture.txt", { exact: true }).tap();

  await expect(pane.getByRole("tab", "fixture.txt")).toBeVisible();
  await expect(screen.getByText("Real SDK browser fixture", { exact: true })).toBeVisible();
});
