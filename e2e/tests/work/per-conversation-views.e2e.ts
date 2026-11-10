/** Each conversation keeps its own Work views, empty for a new one and intact when returning (WORK-012). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, settle } from "./work-views.ts";

test("each conversation keeps its own Work views", { tags: ["WORK-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const first = await hui.createSession({ title: "First work views" });
  const second = await hui.createSession({ title: "Second work views" });
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${first.id}`);
  await openWork(screen, "Files");
  await expect(pane.getByRole("tab", "Files")).toBeVisible();

  await hui.open(`/sessions/${second.id}`);
  await expect(pane.getByRole("tab")).toHaveCount(0);

  await hui.open(`/sessions/${first.id}`);
  // A wide pane keeps its views open across the switch; a narrow screen leaves them one selector choice away.
  await settle(pane.getByRole("tab", "Files"), screen.getByRole("button", { name: /^Active panel/u }));
  if (!(await pane.getByRole("tab", "Files").isVisible())) await openWork(screen, "Files");
  await expect(pane.getByRole("tab", "Files")).toBeVisible();
});
