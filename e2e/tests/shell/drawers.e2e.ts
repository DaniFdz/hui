/** On a narrow screen the sidebar and Settings' page list are drawers that hide what is behind them and close on a choice, a tap outside or a wider window, and on a wide screen the sidebar collapses and expands (SHELL-011, SHELL-012, SHELL-014, SHELL-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const release = { version: "99.0.0", tag: "v99.0.0", url: "https://example.com/hui/v99.0.0" };
const available = JSON.stringify({ currentVersion: "0.1.5", check: { currentVersion: "0.1.5", latest: release, status: "available", canInstall: true, message: "" }, job: null });

test("on a phone held either way Open navigation shows the drawer over unreachable content and update notice, a choice or a tap outside closes it, and nothing scrolls sideways", { tags: ["SHELL-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const open = screen.getByRole("button", "Open navigation");
  const close = screen.getByRole("button", { name: "Close navigation", expanded: true });
  const sessions = screen.getByTestId("nav-item").filter({ hasText: "Sessions" });
  const review = screen.getByRole("button", "Review update");

  for (const orientation of ["portrait", "landscape"] as const) {
    const phone = await hui.phoneScreen(orientation);
    const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
    await hui.open("/");
    await check.answer(available);
    await expect(review).toBeVisible();
    await expect(open).toBeVisible();
    await expect(sessions).toBeHidden();
    await expect.poll(() => hui.reachable(screen.getByRole("button", "Start session"))).toBe(true);
    await expect.poll(() => hui.reachable(review)).toBe(true);
    expect(await hui.overflowsSideways()).toBe(false);

    await open.tap();
    await expect(close).toBeVisible();
    await expect(sessions).toBeVisible();
    await expect.poll(() => hui.reachable(screen.getByRole("button", "Start session"))).toBe(false);
    await expect.poll(() => hui.reachable(review)).toBe(false);
    expect(await hui.overflowsSideways()).toBe(false);
    await sessions.tap();
    await expect(screen.getByTestId("page-title")).toHaveText("Sessions");
    await expect(open).toBeVisible();
    await expect(sessions).toBeHidden();
    expect(await hui.url()).toMatch(/\/sessions$/u);
    expect(await hui.overflowsSideways()).toBe(false);

    await open.tap();
    await expect(close).toBeVisible();
    await screen.tapAt({ x: phone.width - 12, y: phone.height / 2 });
    await expect(open).toBeFocused();
    await expect(sessions).toBeHidden();
    await expect.poll(() => hui.reachable(review)).toBe(true);
    expect(await hui.url()).toMatch(/\/sessions$/u);
  }
});

test("on a phone Open settings navigation names the page, hides it behind the drawer, opens a chosen page with focus on its heading, and a tap outside stays", { tags: ["SHELL-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const open = screen.getByRole("button", "Open settings navigation");
  const title = screen.getByTestId("settings-page-title");
  const width = screen.getByRole("button", "Message width: Comfortable");
  const pages = screen.getByLabel("Settings pages");

  const phone = await hui.phoneScreen();
  await hui.open("/settings/appearance");
  await expect(open).toContainText("Appearance");
  await expect.poll(() => hui.reachable(width)).toBe(true);
  await open.tap();
  await expect(screen.getByRole("button", { name: "Close settings navigation", expanded: true })).toBeVisible();
  await expect(pages).toBeVisible();
  await expect.poll(() => hui.reachable(width)).toBe(false);
  await screen.getByTestId("settings-page-link").filter({ hasText: "Diagnostics" }).tap();
  await expect(title).toHaveText("Diagnostics");
  await expect(title).toBeFocused();
  await expect(open).toContainText("Diagnostics");
  expect(await hui.url()).toMatch(/\/settings\/diagnostics$/u);

  await hui.open("/settings/appearance");
  await open.tap();
  await expect(pages).toBeVisible();
  await expect.poll(() => hui.reachable(width)).toBe(false);
  await screen.tapAt({ x: phone.width - 12, y: phone.height / 2 });
  await expect(open).toBeFocused();
  await expect.poll(() => hui.reachable(width)).toBe(true);
  await expect(title).toHaveText("Appearance");
  expect(await hui.url()).toMatch(/\/settings\/appearance$/u);
});

test("widening the window with either drawer open closes it and leaves the desktop layout usable", { tags: ["SHELL-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const start = screen.getByRole("button", "Start session");
  const width = screen.getByRole("button", "Message width: Comfortable");

  await hui.phoneScreen();
  await hui.open("/");
  await screen.getByRole("button", "Open navigation").tap();
  await expect(screen.getByRole("button", { name: "Close navigation", expanded: true })).toBeVisible();
  await expect.poll(() => hui.reachable(start)).toBe(false);
  await hui.wideScreen();
  await expect(screen.getByRole("button", "Collapse sidebar")).toBeVisible();
  await expect.poll(() => hui.reachable(start)).toBe(true);
  await screen.getByTestId("nav-item").filter({ hasText: "Kanban" }).tap();
  await expect(screen.getByTestId("page-title")).toHaveText("Kanban");

  await hui.phoneScreen();
  await hui.open("/settings/appearance");
  await screen.getByRole("button", "Open settings navigation").tap();
  await expect(screen.getByRole("button", { name: "Close settings navigation", expanded: true })).toBeVisible();
  await expect.poll(() => hui.reachable(width)).toBe(false);
  await hui.wideScreen();
  await expect(screen.getByRole("button", "Exit Settings")).toBeVisible();
  await expect.poll(() => hui.reachable(width)).toBe(true);
  await width.tap();
  await expect(screen.getByRole("listbox", "Message width")).toBeVisible();
});

test("Collapse sidebar and Expand sidebar swap in one spot with focus, below an update notice and clear of the chat title, and a phone has neither", { tags: ["SHELL-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const collapse = screen.getByRole("button", "Collapse sidebar");
  const expand = screen.getByRole("button", "Expand sidebar");
  const sessions = screen.getByTestId("nav-item").filter({ hasText: "Sessions" });
  const settled = async (target: typeof collapse) => {
    let last = "";
    await expect.poll(async () => last === (last = JSON.stringify(await target.boundingBox()))).toBe(true);
    return (await target.boundingBox())!;
  };
  const session = await hui.createSession({ title: "A title the expand control must not cover" });

  const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.open(`/sessions/${session.id}`);
  await check.answer(available);
  const notice = screen.getByLabel("HUI update available");
  await expect(notice).toBeVisible();
  const title = screen.getByTestId("session-title", { visible: true });
  await expect(title).toHaveText("A title the expand control must not cover");

  const collapsed = await settled(collapse);
  await collapse.tap();
  await expect(expand).toBeFocused();
  await expect(sessions).toBeHidden();
  const heading = await settled(title);
  const restore = await settled(expand);
  expect(Math.abs(restore.x - collapsed.x)).toBeLessThan(collapsed.width);
  expect(Math.abs(restore.y - collapsed.y)).toBeLessThan(collapsed.height);
  const banner = (await notice.boundingBox())!;
  expect(restore.y).toBeGreaterThanOrEqual(banner.y + banner.height);
  expect(restore.x + restore.width <= heading.x || restore.x >= heading.x + heading.width
    || restore.y >= heading.y + heading.height || restore.y + restore.height <= heading.y).toBe(true);

  await expand.press("Enter");
  await expect(collapse).toBeFocused();
  await expect(sessions).toBeVisible();
  await expect(expand).toBeHidden();

  await hui.phoneScreen();
  await expect(screen.getByRole("button", "Open navigation")).toBeVisible();
  await expect(collapse).toBeHidden();
  await expect(expand).toBeHidden();
});
