/** The VS Code Work chord opens its view in the pane (WORK-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the VS Code shortcut opens its Work view", { tags: ["WORK-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "VS Code shortcut" });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await hui.workChord("C");
  await expect(pane.getByRole("tab", "VS Code")).toBeVisible();
});
