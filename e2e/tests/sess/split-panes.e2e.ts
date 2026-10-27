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
test("the arrow keys resize a split pane by 2% and with Shift by 5%, and Home and End jump to 15% and 85%", { tags: ["SESS-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const divider = screen.getByTestId("pane-divider");
  const step = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  await hui.wideScreen(3200);
  const first = await hui.createSession({ title: "Keyboard left" });
  await hui.createSession({ title: "Keyboard right" });
  await hui.open(`/sessions/${first.id}`);
  await screen.getByRole("button", "Open split view").tap();
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveAttribute("aria-valuenow", "50");

  await divider.focus();
  await step("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "52");
  await step("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "54");
  await step("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "52");
  await hui.keyboard.down("Shift");
  await step("ArrowRight");
  await step("ArrowRight");
  await hui.keyboard.up("Shift");
  await expect(divider).toHaveAttribute("aria-valuenow", "62");
  await step("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "15");
  await step("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "85");
});

test("dragging the divider changes the panes' share, down to the minimum pane size, and the sizes survive a reload", { tags: ["SESS-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  const divider = screen.getByTestId("pane-divider");
  const panes = screen.getByTestId("session-pane");
  const width = async (index: number) => Math.round((await panes.nth(index).boundingBox())!.width);
  await hui.wideScreen();
  const first = await hui.createSession({ title: "Dragged left" });
  await hui.createSession({ title: "Dragged right" });
  await hui.open(`/sessions/${first.id}`);
  await screen.getByRole("button", "Open split view").tap();
  await expect(divider).toHaveAttribute("aria-valuenow", "50");

  const share = async () => Number(await divider.getAttribute("aria-valuenow"));
  const before = await width(0);
  await hui.dragBy(divider, { dx: 120, dy: 0 }, async () => expect.poll(() => width(0)).toBeGreaterThan(before));
  await expect.poll(share).toBeGreaterThan(50);
  await expect.poll(async () => (await width(0)) - (await width(1))).toBeGreaterThan(0);

  const minimum = (await divider.getAttribute("aria-valuemin"))!;
  await hui.dragBy(divider, { dx: -2000, dy: 0 }, async () => expect(divider).toHaveAttribute("aria-valuenow", minimum));
  await expect(divider).toHaveAttribute("aria-valuenow", minimum);
  await expect.poll(async () => width(0)).toBe(320);

  await hui.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", minimum);
  await expect.poll(async () => width(0)).toBe(320);
});
