/** The Update HUI dialog explains a release it cannot install and recovers when Check again finds one (SHELL-038), and an install reads Updating…, survives the gateway restart with Reconnecting to the gateway…, then offers Reload HUI only once the update has confirmed success (SHELL-040). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const latest = { version: "99.0.0", tag: "v99.0.0", url: "https://example.com/hui/v99.0.0" };
const check = (input: { status: string; canInstall: boolean; message: string; latest?: typeof latest | null }) =>
  ({ currentVersion: "0.1.5", status: input.status, canInstall: input.canInstall, message: input.message, latest: input.latest ?? null });
const snapshot = (input: { check?: ReturnType<typeof check> | null; job?: { id: string; pid: number; status: string; version: string; message: string } | null; currentVersion?: string | null }) =>
  JSON.stringify({ currentVersion: input.currentVersion === undefined ? "0.1.5" : input.currentVersion, check: input.check ?? null, job: input.job ?? null });
const available = check({ status: "available", canInstall: true, message: "A new HUI release is ready to install.", latest });
const installable = snapshot({ check: available });

/** Opens the dialog on `/update`, which the HUI update session keeps, answering the load and the check with `body`. */
async function openUpdate(hui: Hui, screen: Screen, body: string) {
  const session = await hui.createSession({ title: "Ask for an update" });
  await hui.open(`/sessions/${session.id}`);
  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByLabel("Message").fill("/update");
  await screen.getByRole("button", { name: "Send message" }).tap();
  await load.answer(body);
  await checked.answer(body);
  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();
}

test("the Update HUI dialog says why a release cannot be installed, shows no install button and no banner, and Check again brings the install back", { tags: ["SHELL-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const explanation = "No stable HUI release is published yet.";
  await hui.clearOffline();
  await openUpdate(hui, screen, snapshot({ check: check({ status: "unpublished", canInstall: false, message: explanation }) }));
  const update = screen.getByRole("button", "Check again");
  const banner = screen.getByLabel("HUI update available");

  await expect(screen.getByText(explanation, { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(screen.getByText(/^Latest stable:/u)).toHaveCount(0);
  await expect(banner).toBeHidden();

  // A gateway that cannot read the release says so too, and still offers nothing to install.
  const unreadable = "GitHub Releases could not be read: the request timed out.";
  const reload = await hui.intercept("GET", /\/__hui\/update$/u);
  const checkAgain = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await update.tap();
  await reload.answer(snapshot({ check: check({ status: "unavailable", canInstall: false, message: unreadable }) }));
  await checkAgain.answer(snapshot({ check: check({ status: "unavailable", canInstall: false, message: unreadable }) }));
  await expect(screen.getByText(unreadable, { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(banner).toBeHidden();

  // Once a release is readable, Check again brings the install button back.
  const readable = await hui.intercept("GET", /\/__hui\/update$/u);
  const again = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await update.tap();
  await readable.answer(installable);
  await again.answer(installable);
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
  await expect(screen.getByText(/^Latest stable: 99\.0\.0$/u)).toBeVisible();
});

test("Update to reads Updating…, keeps the dialog through the gateway restart with a failed update saying why, and offers Reload HUI only after the update confirms success", { tags: ["SHELL-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clearOffline();
  await openUpdate(hui, screen, installable);
  const install = screen.getByRole("button", "Update to 99.0.0");
  const reload = screen.getByRole("button", "Reload HUI");
  const banner = screen.getByLabel("HUI update available");
  const running = snapshot({ check: available, job: { id: "job-1", pid: 42, status: "running", version: "99.0.0", message: "Installing HUI 99.0.0…" } });

  const starting = await hui.intercept("POST", /\/__hui\/update$/u);
  await install.tap();
  await expect(screen.getByText("Updating…", { exact: true })).toBeVisible();
  await starting.answer(running);
  await expect(screen.getByText("Installing HUI 99.0.0…", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Updating…")).toBeDisabled();
  await expect(reload).toHaveCount(0);
  await expect(banner).toBeHidden();

  // The gateway is restarting: the poll cannot read it, and the dialog says so instead of pretending it finished.
  const lost = await hui.intercept("GET", /\/__hui\/update$/u);
  await lost.reject(503, "The gateway is restarting.");
  await expect(screen.getByText("Reconnecting to the gateway…", { exact: true })).toBeVisible();
  await expect(reload).toHaveCount(0);

  const failed = snapshot({ check: available, job: { id: "job-1", pid: 42, status: "failed", version: "99.0.0", message: "The release could not be downloaded: the connection dropped." } });
  const afterRestart = await hui.intercept("GET", /\/__hui\/update$/u);
  await afterRestart.answer(failed);
  await expect(screen.getByText("The release could not be downloaded: the connection dropped.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Installed version 0.1.5", { exact: true })).toBeVisible();
  await expect(reload).toHaveCount(0);

  // Check again finds the release once more, and this time the update confirms success.
  const reloaded = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByRole("button", "Check again").tap();
  await reloaded.answer(failed);
  await checked.answer(installable);
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeEnabled();

  const retried = await hui.intercept("POST", /\/__hui\/update$/u);
  await screen.getByRole("button", "Update to 99.0.0").tap();
  await retried.answer(running);
  const succeeded = await hui.intercept("GET", /\/__hui\/update$/u);
  await succeeded.answer(snapshot({
    currentVersion: "99.0.0",
    check: check({ status: "available", canInstall: false, message: "A new HUI release is ready to install.", latest }),
    job: { id: "job-2", pid: 43, status: "succeeded", version: "99.0.0", message: "HUI 99.0.0 is ready." },
  }));
  await expect(screen.getByText("Installed version 99.0.0", { exact: true })).toBeVisible();
  await expect(screen.getByText("HUI 99.0.0 is ready.", { exact: true })).toBeVisible();
  await expect(reload).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(banner).toBeHidden();
});
