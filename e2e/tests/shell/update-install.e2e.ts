/** Why an update cannot be installed, with Check again bringing the install back (SHELL-038), and installing one: Updating…, the gateway reconnecting, then the installed version, HUI ready and Reload HUI only after a confirmed success, while a failed update says why and keeps the previous version (SHELL-040). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const release = (version: string) => ({ version, tag: `v${version}`, url: `https://example.com/hui/v${version}` });
const available = (version: string, currentVersion = "0.1.5") => JSON.stringify({
  currentVersion,
  check: { currentVersion, canInstall: true, message: "A new HUI release is ready to install.", status: "available", latest: release(version) },
  job: null,
});
const unpublished = JSON.stringify({
  currentVersion: "0.1.5",
  check: { currentVersion: "0.1.5", canInstall: false, message: "No stable HUI release is published yet.", status: "unpublished", latest: null },
  job: null,
});
const installing = JSON.stringify({
  currentVersion: "0.1.5",
  check: { currentVersion: "0.1.5", canInstall: true, message: "A new HUI release is ready to install.", status: "available", latest: release("99.0.0") },
  job: { id: "job-1", pid: 1, status: "running", version: "99.0.0", message: "Downloading and verifying the release…" },
});
const installed = JSON.stringify({
  currentVersion: "99.0.0",
  check: { currentVersion: "99.0.0", canInstall: true, message: "A new HUI release is ready to install.", status: "available", latest: release("99.0.0") },
  job: { id: "job-1", pid: 1, status: "succeeded", version: "99.0.0", message: "HUI 99.0.0 is ready." },
});

test("an installable release is missing from a refused check, the dialog says why, shows no install and drops the banner until Check again finds one", { tags: ["SHELL-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const review = screen.getByRole("button", "Review update");
  const background = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.open("/");
  await background.answer(available("99.0.0"));
  await expect(banner).toContainText("99.0.0");

  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await load.answer(unpublished);
  await checked.answer(unpublished);
  await expect(screen.getByText("No stable HUI release is published yet.")).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(screen.getByText("You are running the latest stable HUI release or a newer version.")).toBeHidden();
  await expect(banner).toBeHidden();

  const again = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByRole("button", "Check again").tap();
  await again.answer(available("99.0.0"));
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
  await expect(screen.getByText("A new HUI release is ready to install.")).toBeVisible();
});

test("Update to the latest shows Updating…, reconnecting while the gateway restarts, then the installed version and Reload HUI only after the update reports success", { tags: ["SHELL-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const review = screen.getByRole("button", "Review update");
  const background = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.open("/");
  await background.answer(available("99.0.0"));

  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await load.answer(available("99.0.0"));
  await checked.answer(available("99.0.0"));
  await expect(screen.getByText("Installed version 0.1.5")).toBeVisible();
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();

  const install = await hui.intercept("POST", /\/__hui\/update$/u);
  await screen.getByRole("button", "Update to 99.0.0").tap();
  await install.arrived();
  await install.answer(installing);
  const poll = await hui.intercept("GET", /\/__hui\/update$/u);
  await expect(screen.getByRole("button", "Updating…")).toBeVisible();
  await expect(screen.getByText("Downloading and verifying the release…")).toBeVisible();
  await expect(banner).toBeHidden();

  await poll.arrived();
  await poll.reject(503, "The gateway is restarting.");
  const settled = await hui.intercept("GET", /\/__hui\/update$/u);
  await expect(screen.getByText("Reconnecting to the gateway…")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);

  await settled.arrived();
  await settled.answer(installed);
  await expect(screen.getByText("Installed version 99.0.0")).toBeVisible();
  await expect(screen.getByText("HUI 99.0.0 is ready.")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(screen.getByText("Reconnecting to the gateway…")).toBeHidden();
});

test("a failed update says why, leaves the installed version running and offers the install again with no Reload HUI", { tags: ["SHELL-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const review = screen.getByRole("button", "Review update");
  const reason = "The updater exited before reporting completion. Check hui gateway status and logs before retrying.";
  const background = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.open("/");
  await background.answer(available("99.0.0"));

  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await load.answer(available("99.0.0"));
  await checked.answer(available("99.0.0"));
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();

  const install = await hui.intercept("POST", /\/__hui\/update$/u);
  await screen.getByRole("button", "Update to 99.0.0").tap();
  await install.arrived();
  await install.reject(409, reason);

  await expect(screen.getByText(reason)).toBeVisible();
  await expect(screen.getByText("Installed version 0.1.5")).toBeVisible();
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);
});
