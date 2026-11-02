/** Each conversation keeps its own Work views, empty for a new one and intact when returning (WORK-012). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("each conversation keeps its own Work views", { tags: ["WORK-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const first = await hui.createSession({ title: "First work views" });
  const second = await hui.createSession({ title: "Second work views" });
  const pane = screen.getByLabel("Work pane");
  const show = screen.getByRole("button", "Show Work pane");
  const files = screen.getByText(new RegExp("(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)F", "u")).first();

  await hui.wideScreen();
  await hui.open(`/sessions/${first.id}`);
  await show.tap();
  await screen.getByRole("button", "Open Work view").tap();
  await files.tap();
  await expect(pane.getByRole("tab", "Files")).toBeVisible();

  await hui.open(`/sessions/${second.id}`);
  if (await show.isVisible()) await show.tap();
  await expect(pane.getByRole("tab")).toHaveCount(0);

  await hui.open(`/sessions/${first.id}`);
  if (await show.isVisible()) await show.tap();
  await expect(pane.getByRole("tab", "Files")).toBeVisible();
});
