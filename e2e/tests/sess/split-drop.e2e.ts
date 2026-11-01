/** Dragging a sidebar row onto a pane's left or right edge adds a column, onto its top or bottom edge adds a row and onto its centre replaces that pane's session, each with a preview of where it lands (SESS-048). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a row dropped on a pane's left or right edge adds a column, on its top or bottom edge a row, and on its centre replaces the pane's session", { tags: ["SESS-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const row = (title: string) => screen.getByTestId("session-row").filter({ hasText: title });
  const shown = async (pane: Locator) => {
    const title = pane.getByTestId("session-title", { visible: true });
    return (await title.count()) > 0 ? ((await title.textContent()) ?? "").trim() : "";
  };
  const columns = async () => {
    const placed: { title: string; x: number; y: number }[] = [];
    for (let index = 0; index < await panes.count(); index += 1) {
      const box = await panes.nth(index).boundingBox();
      const title = await shown(panes.nth(index));
      if (box && title) placed.push({ title, x: Math.round(box.x), y: Math.round(box.y) });
    }
    return placed.sort((a, b) => a.x - b.x || a.y - b.y).map(({ title }) => title);
  };
  const paneShowing = async (title: string) => {
    for (let index = 0; index < await panes.count(); index += 1) {
      if (await shown(panes.nth(index)) === title) return panes.nth(index);
    }
    throw new Error(`no pane shows ${title}`);
  };
  const dropOn = async (source: Locator, pane: Locator, at: { x: number; y: number }, preview: string) => {
    const paneBox = (await pane.boundingBox())!;
    await hui.drag(source, pane, async () => {
      const mark = screen.getByText(preview, { exact: true, visible: true });
      await expect(mark).toBeVisible();
      const box = (await mark.boundingBox())!;
      const centre = { x: box.x + box.width / 2 - (paneBox.x + paneBox.width / 2), y: box.y + box.height / 2 - (paneBox.y + paneBox.height / 2) };
      if (at.x !== 0.5) expect(Math.sign(centre.x)).toBe(Math.sign(at.x - 0.5));
      if (at.y !== 0.5) expect(Math.sign(centre.y)).toBe(Math.sign(at.y - 0.5));
    }, at);
  };

  const host = await hui.createSession({ title: "Pane host" });
  await hui.createSession({ title: "Left row" });
  await hui.createSession({ title: "Right row" });
  await hui.createSession({ title: "Top row" });
  await hui.createSession({ title: "Bottom row" });
  await hui.createSession({ title: "Centre row" });
  await hui.wideScreen(2000);
  await hui.open(`/sessions/${host.id}`);
  await expect(panes).toHaveCount(1);
  expect(await columns()).toEqual(["Pane host"]);

  await dropOn(row("Left row"), await paneShowing("Pane host"), { x: 0.1, y: 0.5 }, "Split");
  await expect(panes).toHaveCount(2);
  await expect.poll(columns).toEqual(["Left row", "Pane host"]);

  await dropOn(row("Right row"), await paneShowing("Pane host"), { x: 0.9, y: 0.5 }, "Split");
  await expect(panes).toHaveCount(3);
  await expect.poll(columns).toEqual(["Left row", "Pane host", "Right row"]);

  await dropOn(row("Top row"), await paneShowing("Pane host"), { x: 0.5, y: 0.1 }, "Split");
  await expect(panes).toHaveCount(4);
  await expect.poll(columns).toEqual(["Left row", "Top row", "Pane host", "Right row"]);

  await dropOn(row("Bottom row"), await paneShowing("Pane host"), { x: 0.5, y: 0.9 }, "Split");
  await expect(panes).toHaveCount(5);
  await expect.poll(columns).toEqual(["Left row", "Top row", "Pane host", "Bottom row", "Right row"]);

  await dropOn(row("Centre row"), await paneShowing("Bottom row"), { x: 0.5, y: 0.5 }, "Open here");
  await expect(panes).toHaveCount(5);
  await expect.poll(columns).toEqual(["Left row", "Top row", "Pane host", "Centre row", "Right row"]);
});
