/** The update notice the background check raises above every screen without installing, restarting or calling a model, and a check that cannot offer an install (SHELL-031, SHELL-038). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const release = (version: string) => ({ version, tag: `v${version}`, url: `https://example.com/hui/v${version}` });

const snapshot = (version: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  currentVersion: "0.1.5",
  check: { currentVersion: "0.1.5", canInstall: true, message: "", status: "available", latest: release(version) },
  job: null,
  ...extra,
});

/** The development server's own answer: there is no installation to update. */
const DEVELOPMENT = "This is the development server. Update the source checkout through Git; installed HUI packages can update from GitHub Releases.";

test("a newer release is announced above every screen, including Settings, without installing anything or reaching a model, and a failed check stays silent", { tags: ["SHELL-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const review = screen.getByRole("button", "Review update");
  const before = await hui.providerRequests();

  await hui.clearOffline();
  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  // The development server answers its own check, and offers no release.
  await expect.poll(async () => (await hui.api<{ check: { status: string } | null }>("GET", "/__hui/update")).check?.status, { timeout: 60_000 }).toBe("unavailable");
  await expect(banner).toBeHidden();

  const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  await check.answer(snapshot("99.0.0"));
  await expect(review).toBeVisible();
  await expect(banner).toContainText("HUI 99.0.0 is available");

  // Above every screen: Settings keeps it.
  await hui.sessionList();
  await screen.getByTestId("nav-settings").tap();
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Appearance");
  await expect(banner).toBeVisible();
  await expect(review).toBeVisible();

  // Checking never installs, restarts the gateway or calls a model.
  expect((await hui.api<{ job: unknown }>("GET", "/__hui/update")).job).toBeNull();
  expect(await hui.providerRequests()).toBe(before);
  expect(await hui.url()).toMatch(/\/settings\/appearance$/u);

  // A background check that fails says nothing at all.
  const failed = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  await failed.reject(503, "GitHub Releases could not be read.");
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Appearance");
  await expect(banner).toBeHidden();
  await expect(screen.getByText(/^Could not/u)).toHaveCount(0);
});

test("a check that offers no install says why, shows no install button and removes the notice, and Check again offers the install once a release is available", { tags: ["SHELL-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const review = screen.getByRole("button", "Review update");
  const dialog = screen.getByText("Update HUI", { exact: true });

  await hui.clearOffline();
  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  const check = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  await check.answer(snapshot("99.0.0"));
  await expect(review).toBeVisible();

  // The dialog's own check reaches the gateway, which has no installation to update.
  await review.tap();
  await expect(dialog).toBeVisible();
  await expect(screen.getByText(DEVELOPMENT)).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);
  await expect(screen.getByText(/is current/u)).toHaveCount(0);
  await expect(banner).toBeHidden();

  // A release read now brings the install back.
  const again = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByRole("button", "Check again").tap();
  await again.answer(snapshot("99.0.0"));
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
  await expect(screen.getByText(DEVELOPMENT)).toBeHidden();
  await screen.getByRole("button", "Close").tap();
  await expect(dialog).toBeHidden();
});
