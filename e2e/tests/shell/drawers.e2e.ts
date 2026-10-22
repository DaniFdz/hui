/** On a narrow screen the sidebar is a drawer that hides what is behind it and closes on a choice or a tap outside, and on a wide screen it collapses and expands (SHELL-011, SHELL-015). */
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

test("Collapse sidebar and Expand sidebar swap in one spot with focus, below an update notice and clear of the chat title, and a phone has neither", { tags: ["SHELL-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const collapse = screen.getByRole("button", "Collapse sidebar");
  const expand = screen.getByRole("button", "Expand sidebar");
  const sessions = screen.getByTestId("nav-item").filter({ hasText: "Sessions" });
  const box = async (target: typeof collapse) => {
    const found = await target.boundingBox();
    if (!found) throw new Error("the target lays out no box");
    return found;
  };
  const session = await hui.createSession({ title: "A title the expand control must not cover" });

  const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.open(`/sessions/${session.id}`);
  await check.answer(available);
  const notice = screen.getByLabel("HUI update available");
  await expect(notice).toBeVisible();
  const title = screen.getByTestId("session-title", { visible: true });
  await expect(title).toHaveText("A title the expand control must not cover");

  const collapsed = await box(collapse);
  await collapse.tap();
  await expect(expand).toBeFocused();
  await expect(sessions).toBeHidden();
  const restore = await box(expand);
  expect(Math.abs(restore.x - collapsed.x)).toBeLessThan(collapsed.width);
  expect(Math.abs(restore.y - collapsed.y)).toBeLessThan(collapsed.height);
  const banner = await box(notice);
  expect(restore.y).toBeGreaterThanOrEqual(banner.y + banner.height);
  const heading = await box(title);
  expect(restore.x + restore.width <= heading.x || restore.y >= heading.y + heading.height || restore.y + restore.height <= heading.y).toBe(true);

  await expand.press("Enter");
  await expect(collapse).toBeFocused();
  await expect(sessions).toBeVisible();
  await expect(expand).toBeHidden();

  await hui.phoneScreen();
  await expect(screen.getByRole("button", "Open navigation")).toBeVisible();
  await expect(collapse).toBeHidden();
  await expect(expand).toBeHidden();
});
