/** The sidebar's right edge widens and narrows it, within bounds, and keeps the choice in both shells (SHELL-048). */
import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the sidebar widens and narrows from its right edge, and Settings keeps that width", { tags: ["SHELL-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  const handle = screen.getByLabel("Resize sidebar");
  const sidebar = screen.getByTestId("shell-sidebar");
  const width = async () => Math.round((await sidebar.boundingBox())?.width ?? 0);
  const start = await handle.boundingBox();
  assert(start);
  assert.equal(await width(), 258, "the sidebar starts at its default width");

  const dragTo = async (x: number) => {
    const box = await handle.boundingBox();
    assert(box);
    await screen.swipe({ from: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to: { x, y: box.y + box.height / 2 } });
  };

  // A drag stops at the widest a sidebar may get, and at the narrowest.
  await dragTo(1_400);
  await expect.poll(width).toBe(460);
  await dragTo(0);
  await expect.poll(width).toBe(200);

  // The arrow keys move it instead, by 16px a press or 48px with Shift.
  await handle.press("ArrowRight");
  await expect.poll(width).toBe(216);
  await handle.press("Shift+ArrowRight");
  await expect.poll(width).toBe(264);

  // The sidebar comes back at the width it was left at.
  await hui.reload();
  await expect(handle).toBeVisible();
  await expect.poll(width).toBe(264);

  // Settings' rail is the same sidebar: it opens at that width, and its own
  // boundary moves the column both shells use.
  await screen.getByTestId("nav-settings").tap();
  await expect(screen.getByTestId("settings-page-title")).toBeVisible();
  const settingsSidebar = screen.getByTestId("settings-sidebar");
  const settingsWidth = async () => Math.round((await settingsSidebar.boundingBox())?.width ?? 0);
  await expect.poll(settingsWidth).toBe(264);
  await screen.getByLabel("Resize sidebar").press("ArrowRight");
  await expect.poll(settingsWidth).toBe(280);
  await screen.getByRole("button", "Exit Settings").tap();
  await expect.poll(width).toBe(280);
});
