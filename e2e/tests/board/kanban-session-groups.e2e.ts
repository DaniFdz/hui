/** On the Kanban board grouped by custom lanes, a session card moves to another group by dragging it into a lane or through its Options → Move to group, together with any stage change, and the board announces where it went (SESS-068). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("dragging a session card into another custom lane moves it and its stage, and Move to group changes only the group", { tags: ["SESS-068"], platforms: ["web"] }, async ({ screen, hui }) => {
  const board = screen.getByLabel("Kanban board");
  const cell = (lane: string, stage: string) => board.getByLabel(`${lane}, ${stage}`);
  const card = (title: string) => board.getByRole("listitem").filter({ hasText: title });
  const options = (stage: string, title: string) => board.getByRole("button", `Stage: ${stage}. Options for ${title}`);
  await hui.createSession({ title: "Alpha card", group: "Alpha" });
  await hui.createSession({ title: "Beta anchor", group: "Beta" });
  await hui.createSession({ title: "Other anchor" });

  await hui.open("/kanban");
  await screen.getByRole("button", "Board options").tap();
  await screen.getByText("Custom groups", { visible: true }).tap();
  await expect(cell("ALPHA", "Investigation").getByText("Alpha card")).toBeVisible();

  await card("Alpha card").dragTo(cell("BETA", "Testing"));
  await expect(screen.getByText("Moved Alpha card to BETA · Testing.")).toBeVisible();
  await expect(cell("BETA", "Testing").getByText("Alpha card")).toBeVisible();
  await expect(options("Testing", "Alpha card")).toBeVisible();

  await options("Testing", "Alpha card").tap();
  await screen.getByLabel("Options for Alpha card").getByText("OTHER", { visible: true }).tap();
  await expect(screen.getByText("Moved Alpha card to OTHER.")).toBeVisible();
  await expect(cell("OTHER", "Testing").getByText("Alpha card")).toBeVisible();
});
