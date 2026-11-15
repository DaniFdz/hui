/** On a phone the navigation drawer spends its width on the session names and keeps one trailing control per row, and a drag from the chat's left edge pulls it open (SHELL-054, SHELL-055). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a phone drawer gives a session row its name and one actions menu", { tags: ["SHELL-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const title = "Improve the phone drawer";
  await hui.createSession({ title });
  const phone = await hui.phoneScreen();
  await hui.open("/");
  await screen.getByRole("button", "Open navigation").tap();

  const drawer = screen.getByTestId("shell-sidebar");
  const row = screen.getByTestId("session-row").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  const drawerWidth = (await drawer.boundingBox())!.width;
  expect(drawerWidth).toBeGreaterThanOrEqual(Math.round(phone.width * 0.8));
  expect(drawerWidth).toBeLessThanOrEqual(320);
  // The name gets most of the row instead of sharing it with two controls.
  await expect.poll(async () => Math.round((await row.getByTestId("session-row-title").boundingBox())!.width)).toBeGreaterThan(Math.round(drawerWidth * 0.55));
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(row.getByRole("button", "Pin session")).toBeHidden();
  expect(await hui.overflowsSideways()).toBe(false);
  await hui.sessionMenu(title);
  await expect(screen.getByText("Pin session", { visible: true })).toBeVisible();
});

test("a drag from a chat's left edge pulls the navigation drawer open, while a short or vertical drag leaves it closed", { tags: ["SHELL-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const phone = await hui.phoneScreen();
  await hui.open("/");
  const open = screen.getByRole("button", "Open navigation");
  const close = screen.getByRole("button", { name: "Close navigation", expanded: true });
  const sessions = screen.getByTestId("nav-item").filter({ hasText: "Sessions" });
  const drawer = screen.getByTestId("shell-sidebar");
  await expect(open).toBeVisible();
  await expect(sessions).toBeHidden();

  // A short, slow drag springs back.
  await screen.swipe({ from: { x: 4, y: phone.height / 2 }, to: { x: 90, y: phone.height / 2 }, duration: 500 });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(sessions).toBeHidden();

  // A vertical drag from the same edge leaves the drawer closed.
  await screen.swipe({ from: { x: 4, y: 240 }, to: { x: 8, y: 60 }, duration: 400 });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(sessions).toBeHidden();

  // A drag past a third of the drawer opens it.
  await screen.swipe({ from: { x: 4, y: phone.height / 2 }, to: { x: 300, y: phone.height / 2 }, duration: 500 });
  await expect(close).toBeVisible();
  await expect(sessions).toBeVisible();
  expect(Math.round((await drawer.boundingBox())!.width)).toBeLessThanOrEqual(320);

  // Tapping outside closes it.
  await screen.tapAt({ x: phone.width - 12, y: phone.height / 2 });
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "false");
});
