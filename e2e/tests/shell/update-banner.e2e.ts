/** The update banner over every screen: dismissing it keeps the composer's draft and lasts only for that version until a reload, Review update opens the HUI update session and the Update HUI dialog without installing or starting a turn, and Escape leaves the dialog (SHELL-032 to SHELL-034). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const snapshot = (version: string) => JSON.stringify({
  currentVersion: "0.1.5",
  check: { currentVersion: "0.1.5", canInstall: true, message: "", status: "available",
    latest: { version, tag: `v${version}`, url: `https://example.com/hui/v${version}` } },
  job: null,
});

/** The check the next page load makes as it draws. A page still drawing when the check is held leaves that request
 * held rather than the load the app shows, so let the app draw first and hold the reload's own check. */
const checkOnNextLoad = async (drawn: Locator, hui: Hui) => {
  await expect(drawn).toBeVisible();
  const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  return check;
};

test("Dismiss update notification keeps the composer's draft, lasts for that version until the page reloads, and a newer version still appears", { tags: ["SHELL-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const review = screen.getByRole("button", "Review update");
  const dismiss = screen.getByRole("button", "Dismiss update notification");
  const message = screen.getByPlaceholder("What should this session work on?");

  const check = await checkOnNextLoad(message, hui);
  await check.answer(snapshot("99.0.0"));
  await expect(review).toBeVisible();
  await message.fill("A draft to keep through a dismissal");

  await dismiss.tap();
  await expect(banner).toBeHidden();
  await expect(message).toHaveValue("A draft to keep through a dismissal");

  const afterReload = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  await afterReload.answer(snapshot("99.0.0"));
  await expect(banner).toContainText("99.0.0");
  await expect(message).toHaveValue("A draft to keep through a dismissal");

  await dismiss.tap();
  await expect(banner).toBeHidden();
  await message.fill("/update");
  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const newer = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByRole("button", "Start session").tap();
  await load.answer(snapshot("100.0.0"));
  await newer.answer(snapshot("100.0.0"));
  await screen.getByRole("button", "Close").tap();
  await expect(banner).toContainText("100.0.0");
});

test("Review update opens the HUI update session and the dialog on the latest release without installing or starting a turn, keeps the earlier draft and returns focus on Close", { tags: ["SHELL-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const review = screen.getByRole("button", "Review update");
  const message = screen.getByPlaceholder("What should this session work on?");
  const before = await hui.providerRequests();

  const check = await checkOnNextLoad(message, hui);
  await check.answer(snapshot("99.0.0"));
  await expect(review).toBeVisible();
  await message.fill("A draft that Review update must keep");

  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await load.answer(snapshot("99.0.0"));
  await checked.answer(snapshot("99.0.0"));

  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();
  await expect(screen.getByText("Installed version 0.1.5")).toBeVisible();
  await expect(screen.getByText(/^Latest stable: 99\.0\.0$/u)).toBeVisible();
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
  await expect(screen.getByTestId("session-row").filter({ hasText: "HUI update" })).toHaveCount(1);
  const listed = await hui.api<{ groups: { label: string; sessions: { id: string; title: string; group: string }[] }[] }>("GET", "/__hui/sessions");
  const updateSession = listed.groups.find((group) => group.label === "ungrouped")?.sessions.filter((session) => session.title === "HUI update");
  expect(updateSession?.map((session) => session.group)).toEqual([""]);
  expect(new URL(await hui.url()).pathname).toBe(`/sessions/${updateSession?.[0]?.id}`);
  expect(await hui.providerRequests()).toBe(before);

  await screen.getByRole("button", "Close").tap();
  await expect(screen.getByText("Update HUI", { exact: true })).toBeHidden();
  await expect(review).toBeFocused();
  await expect(screen.getByLabel("Message", { visible: true })).toHaveValue("/update");
  expect(await hui.newSessionDraft()).toBe("A draft that Review update must keep");
});

test("Escape closes the Update HUI dialog with the draft unchanged and returns focus to the control that opened it", { tags: ["SHELL-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const review = screen.getByRole("button", "Review update");
  const message = screen.getByPlaceholder("What should this session work on?");

  const check = await checkOnNextLoad(message, hui);
  await check.answer(snapshot("99.0.0"));
  await expect(review).toBeVisible();
  await message.fill("A draft that Escape must keep");

  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await load.answer(snapshot("99.0.0"));
  await checked.answer(snapshot("99.0.0"));
  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();

  await screen.getByRole("button", "Close").press("Escape");
  await expect(screen.getByText("Update HUI", { exact: true })).toBeHidden();
  await expect(review).toBeFocused();
  expect(await hui.newSessionDraft()).toBe("A draft that Escape must keep");
  await expect(screen.getByLabel("Message", { visible: true })).toHaveValue("/update");
});

