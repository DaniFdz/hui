/** Dragging a Work view tab onto another position moves it there, and the new order survives a reload (WORK-004). The
 * drag is the browser's own: the tab is `draggable` and moves on `drop`, so the mouse press, the move and the release
 * are what a test drives. The order is read off the tab strip, which a reload rebuilds from the browser's saved layout. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("dragging a tab onto another position moves it there, and the new order survives a reload", { tags: ["WORK-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Reorder tabs", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const tabs = pane.getByRole("tab");
  /** The tab strip's captions, left to right. */
  const order = async () => Promise.all((await tabs.all()).map(async (tab) => (await hui.textOf(tab)).trim()));

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await openWork(screen, "Files");
  await openWork(screen, "Diff");
  await openWork(screen, "Browser");
  expect(await order()).toEqual(["Files", "Diff", "Browser"]);

  // Dropped on the Files tab, the Browser one takes its place at the front.
  await hui.drag(pane.getByRole("tab", "Browser"), pane.getByRole("tab", "Files"), async () => {});
  await expect.poll(order).toEqual(["Browser", "Files", "Diff"]);

  // And dragged back onto the last tab it goes to the other end, so a tab lands where it is dropped either way.
  await hui.drag(pane.getByRole("tab", "Browser"), pane.getByRole("tab", "Diff"), async () => {});
  await expect.poll(order).toEqual(["Files", "Diff", "Browser"]);

  // A reload rebuilds the strip from the browser's saved layout, in the order the operator left it.
  await hui.reload();
  await expect(tabs).toHaveCount(3);
  expect(await order()).toEqual(["Files", "Diff", "Browser"]);
});
