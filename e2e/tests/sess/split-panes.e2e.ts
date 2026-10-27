/** Split panes side by side: opening them from the header, a row menu and the pane menus, and their layout surviving a reload (SESS-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("split view opens from the header and a row menu, the split and pane menus add panes, and the layout survives a reload", { tags: ["SESS-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const resize = screen.getByTestId("pane-divider");
  const active = async (index: number) => {
    await panes.nth(index).getByTestId("session-title").tap();
    await expect(panes.nth(index)).toHaveAttribute("aria-current", "true");
  };
  await hui.wideScreen(2200);
  const left = await hui.createSession({ title: "Left chat" });
  const right = await hui.createSession({ title: "Right chat" });

  await hui.open(`/sessions/${left.id}`);
  await expect(panes).toHaveCount(1);
  await screen.getByRole("button", "Open split view").tap();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1).getByTestId("session-title")).toHaveText("Left chat");

  await (await hui.sessionMenu("Right chat")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);
  await expect(panes.nth(2).getByTestId("session-title")).toHaveText("Right chat");

  await active(0);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${left.id}`);
  await panes.nth(0).getByRole("button", "Split down").tap();
  await expect(panes).toHaveCount(4);
  await active(0);
  await panes.nth(0).getByRole("button", "Split right").tap();
  await expect(panes).toHaveCount(5);
  await active(2);
  await panes.nth(2).getByRole("button", "Pane actions").tap();
  await screen.getByText("Split down", { visible: true }).tap();
  await expect(panes).toHaveCount(6);

  await active(2);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${right.id}`);
  await resize.first().focus();
  await hui.keyboard.down("ArrowDown");
  await hui.keyboard.up("ArrowDown");
  await hui.keyboard.down("ArrowDown");
  await hui.keyboard.up("ArrowDown");
  await expect(resize.first()).toHaveAttribute("aria-valuenow", "54");

  await hui.reload();
  await expect(panes).toHaveCount(6);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${right.id}`);
  await expect(panes.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(resize.first()).toHaveAttribute("aria-valuenow", "54");
});