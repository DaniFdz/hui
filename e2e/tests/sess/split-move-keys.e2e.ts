/** With Move panel focused, the arrow keys move the pane into the neighbouring column or stack and the handle keeps focus (SESS-055). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the arrow keys on a focused Move panel handle move the pane a column across and up and down a stack, and keep the handle focused", { tags: ["SESS-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const left = async () => Math.round((await panes.nth(2).boundingBox())!.x);
  await hui.wideScreen(2200);
  const first = await hui.createSession({ title: "Moving pane" });
  await hui.createSession({ title: "Neighbour pane" });

  await hui.open(`/sessions/${first.id}`);
  await screen.getByRole("button", "Open split view").tap();
  await (await hui.sessionMenu("Neighbour pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);
  await expect(panes.nth(2).getByTestId("session-title")).toHaveText("Neighbour pane");

  const handle = panes.nth(2).getByRole("button", "Move panel");
  await handle.focus();
  const before = await left();
  await hui.keyboard.down("ArrowLeft");
  await hui.keyboard.up("ArrowLeft");
  await expect(screen.getByText("Panel moved left.")).toBeVisible();
  await expect.poll(left).toBeLessThan(before);
  await expect(handle).toBeFocused();

  const moved = await left();
  await hui.keyboard.down("ArrowRight");
  await hui.keyboard.up("ArrowRight");
  await expect(screen.getByText("Panel moved right.")).toBeVisible();
  await expect.poll(left).toBeGreaterThan(moved);
  await expect(handle).toBeFocused();

  const top = async () => Math.round((await panes.nth(3).boundingBox())!.y);
  panes.nth(2).getByTestId("session-title").tap();
  await panes.nth(2).getByRole("button", "Pane actions").tap();
  await screen.getByText("Split down", { visible: true }).tap();
  await expect(panes).toHaveCount(4);
  const stacked = panes.nth(3).getByRole("button", "Move panel");
  await stacked.focus();
  const below = await top();
  await hui.keyboard.down("ArrowUp");
  await hui.keyboard.up("ArrowUp");
  await expect(screen.getByText("Panel moved up.")).toBeVisible();
  await expect.poll(top).toBeLessThan(below);
  await expect(stacked).toBeFocused();

  await hui.keyboard.down("ArrowDown");
  await hui.keyboard.up("ArrowDown");
  await expect(screen.getByText("Panel moved down.")).toBeVisible();
  await expect.poll(top).toBe(below);
  await expect(stacked).toBeFocused();
});