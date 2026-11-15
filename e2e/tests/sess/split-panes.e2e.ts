/** Split panes side by side: opening them from another session's row menu, their layout and sizes surviving a reload (SESS-047), and resizing them from a focused divider (SESS-052). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("another session's row menu opens a split pane, focus makes a pane active with its route, and the layout survives a reload", { tags: ["SESS-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const titles = (title: string) => panes.getByTestId("session-title").filter({ hasText: title });
  const resize = screen.getByTestId("pane-divider");
  const open = async (title: string) => {
    await hui.sessionList();
    await (await hui.sessionMenu(title)).getByText("Open in split pane", { visible: true }).tap();
  };
  const active = async (index: number) => {
    await panes.nth(index).getByTestId("session-title").tap();
    await expect(panes.nth(index)).toHaveAttribute("aria-current", "true");
  };
  const step = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  await hui.wideScreen(2200);
  const left = await hui.createSession({ title: "Left chat" });
  const middle = await hui.createSession({ title: "Middle chat" });
  await hui.createSession({ title: "Right chat" });

  await hui.open(`/sessions/${left.id}`);
  await expect(panes).toHaveCount(1);
  // A split comes from another session's row menu: the chat header offers no split control, and no pane opens a
  // second view of the session it already shows.
  await expect(screen.getByTestId("chat-header").getByRole("button", "Open split view")).toHaveCount(0);
  await open("Middle chat");
  await expect(panes).toHaveCount(2);
  await expect(titles("Left chat")).toHaveCount(1);
  await expect(titles("Middle chat")).toHaveCount(1);

  await open("Right chat");
  await expect(panes).toHaveCount(3);
  await expect(panes.nth(2).getByTestId("session-title")).toHaveText("Right chat");

  await active(0);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${left.id}`);
  // Focusing a control inside another pane makes that pane the active one too, and the route follows it.
  await panes.nth(1).getByRole("button", "Move panel").focus();
  await expect(panes.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(panes.nth(0)).not.toHaveAttribute("aria-current", "true");
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${middle.id}`);

  const geometry = async () => Promise.all([0, 1, 2].map(async (index) => {
    const box = (await panes.nth(index).boundingBox())!;
    return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  }));
  const before = await geometry();
  await resize.first().focus();
  await step("ArrowRight");
  await step("ArrowRight");
  await expect.poll(geometry).not.toEqual(before);
  const resized = await geometry();

  await hui.reload();
  await expect(panes).toHaveCount(3);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${middle.id}`);
  await expect(panes.nth(1)).toHaveAttribute("aria-current", "true");
  await expect.poll(geometry).toEqual(resized);
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
  await hui.sessionList();
  await (await hui.sessionMenu("Keyboard right")).getByText("Open in split pane", { visible: true }).tap();
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
  const width = async () => Math.round((await panes.nth(0).boundingBox())!.width);
  await hui.wideScreen();
  const first = await hui.createSession({ title: "Dragged left" });
  await hui.createSession({ title: "Dragged right" });
  await hui.open(`/sessions/${first.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Dragged right")).getByText("Open in split pane", { visible: true }).tap();
  await expect(divider).toHaveAttribute("aria-valuenow", "50");

  const share = async () => Number(await divider.getAttribute("aria-valuenow"));
  const before = await width();
  await hui.dragBy(divider, { dx: 120, dy: 0 }, async () => expect.poll(width).toBeGreaterThan(before));
  await expect.poll(share).toBeGreaterThan(50);

  const minimum = (await divider.getAttribute("aria-valuemin"))!;
  const edge = -(await divider.boundingBox())!.x + 2;
  await hui.dragBy(divider, { dx: edge, dy: 0 }, async () => expect(divider).toHaveAttribute("aria-valuenow", minimum));
  await expect(divider).toHaveAttribute("aria-valuenow", minimum);
  const narrowed = await width();
  await hui.dragBy(divider, { dx: -200, dy: 0 }, async () => expect(divider).toHaveAttribute("aria-valuenow", minimum));
  await expect.poll(width).toBe(narrowed);

  await hui.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", minimum);
  await expect.poll(width).toBe(narrowed);
});