/** Installing a HUI update: Updating…, the gateway reconnecting, then the installed version and Reload HUI only after a confirmed success, with a failure that says why (SHELL-040); and Reload HUI coming back on the same session with its transcript, tool result and draft, no notice, and /update --check reporting the installed version as current (SHELL-042). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const release = { version: "99.0.0", tag: "v99.0.0", url: "https://example.com/hui/v99.0.0" };
const check = { currentVersion: "0.1.5", canInstall: true, message: "A new HUI release is ready to install.", status: "available", latest: release };

const available = JSON.stringify({ currentVersion: "0.1.5", check, job: null });
const running = JSON.stringify({ currentVersion: "0.1.5", check,
  job: { id: "job-1", pid: 4242, status: "running", version: "99.0.0", message: "Installing HUI 99.0.0…" } });
const failed = JSON.stringify({ currentVersion: "0.1.5", check,
  job: { id: "job-1", pid: 4242, status: "failed", version: "99.0.0", message: "The update failed: the archive did not match its checksum." } });
const ready = JSON.stringify({ currentVersion: "99.0.0",
  check: { currentVersion: "99.0.0", canInstall: false, message: "HUI 99.0.0 is the latest release.", status: "current", latest: null },
  job: { id: "job-1", pid: 4242, status: "succeeded", version: "99.0.0", message: "HUI 99.0.0 is ready." } });
const current = JSON.stringify({ currentVersion: "0.1.5",
  check: { currentVersion: "0.1.5", canInstall: false, message: "HUI 0.1.5 is the latest release.", status: "current", latest: null }, job: null });

/** Opens the update dialog from the notice a release raises on the next load. */
const reviewWithRelease = async (screen: Screen, hui: Hui) => {
  const raised = await hui.intercept("GET", /\/__hui\/update\/check$/u);
  await hui.reload();
  await raised.answer(available);
  const review = screen.getByRole("button", "Review update");
  await expect(review).toBeVisible();
  const loaded = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await review.tap();
  await loaded.answer(available);
  await checked.answer(available);
  await expect(screen.getByRole("button", "Update to 99.0.0")).toBeVisible();
};

test("Update to <version> reads Updating… and drops the notice, the dialog shows the gateway reconnecting, then the installed version and Reload HUI only after a confirmed success, and a failed update says why", { tags: ["SHELL-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const install = () => screen.getByRole("button", /^Update to 99\.0\.0$/u);

  await hui.clearOffline();
  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await reviewWithRelease(screen, hui);

  // A failure says why and leaves the install on offer.
  const refused = await hui.answerAll("POST", /\/__hui\/update$/u, failed);
  const failedState = await hui.answerAll("GET", /\/__hui\/update$/u, failed);
  await install().tap();
  await expect(screen.getByText("The update failed: the archive did not match its checksum.")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);
  await expect(install()).toBeEnabled();
  await refused.stop();
  await failedState.stop();

  // The install starts: the button reads Updating… and the notice is gone while the job runs.
  const started = await hui.answerAll("POST", /\/__hui\/update$/u, running);
  const runningState = await hui.answerAll("GET", /\/__hui\/update$/u, running);
  await install().tap();
  await expect(screen.getByRole("button", "Updating…")).toBeVisible();
  await expect(banner).toBeHidden();
  await runningState.stop();

  // The gateway restarts under the dialog, and says so while it cannot be read.
  const down = await hui.answerAll("GET", /\/__hui\/update$/u, JSON.stringify({ error: "The gateway is restarting." }), 503);
  await expect(screen.getByText("Reconnecting to the gateway…")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);
  await down.stop();

  // Only a confirmed success offers the reload.
  const installed = await hui.answerAll("GET", /\/__hui\/update$/u, ready);
  await expect(screen.getByText("Installed version 99.0.0")).toBeVisible();
  await expect(screen.getByText("HUI 99.0.0 is ready.")).toBeVisible();
  await expect(screen.getByRole("button", "Reload HUI")).toBeVisible();
  await expect(install()).toHaveCount(0);
  await installed.stop();
  await started.stop();
});

test("Reload HUI comes back on the same session with its transcript, tool result and kept draft and no notice, and /update --check then reports the installed version as current", { tags: ["SHELL-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const banner = screen.getByLabel("HUI update available");
  const transcript = screen.getByTestId("transcript");
  const message = () => screen.getByLabel("Message", { visible: true });
  const read = () => transcript.getByRole("button", /^Read fixture\.txt/u);

  await hui.clearOffline();
  await hui.open("/");
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await reviewWithRelease(screen, hui);
  // The dialog belongs to the HUI update session, which keeps its own conversation.
  const update = (await hui.api<{ groups: { sessions: { id: string; title: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find(({ title }) => title === "HUI update")!;
  await screen.getByRole("button", "Close").tap();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${update.id}`);
  await hui.prompt(update, "E2E_MIDTURN_MESSAGE");
  await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible({ timeout: 120_000 });
  const before = await hui.providerRequests();

  // The notice opens the dialog on that session again, keeping the command draft, and a confirmed success offers the reload.
  const loaded = await hui.intercept("GET", /\/__hui\/update$/u);
  const checked = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await screen.getByRole("button", "Review update").tap();
  await loaded.answer(available);
  await checked.answer(available);
  const installed = await hui.answerAll("GET", /\/__hui\/update$/u, ready);
  const started = await hui.answerAll("POST", /\/__hui\/update$/u, ready);
  await screen.getByRole("button", "Update to 99.0.0").tap();
  await expect(screen.getByRole("button", "Reload HUI")).toBeVisible();
  await expect(banner).toBeHidden();

  // The page comes back on the same session address, and the background check now reports the installed version.
  const settled = await hui.answerAll("GET", /\/__hui\/update\/check$/u, current);
  await screen.getByRole("button", "Reload HUI").tap();
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${update.id}`);
  await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible({ timeout: 120_000 });
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  if (!(await read().isVisible())) await transcript.getByText("Used 1 tool").tap();
  await expect(read()).toBeVisible();
  await expect(message()).toHaveValue("/update");
  await expect(banner).toBeHidden();
  await settled.stop();
  await installed.stop();
  await started.stop();

  // /update --check reports the installed version as current, offers no install and reaches no model.
  const load = await hui.intercept("GET", /\/__hui\/update$/u);
  const check = await hui.intercept("POST", /\/__hui\/update\/check$/u);
  await message().fill("/update --check");
  await screen.getByRole("button", "Send message").tap();
  await load.answer(ready);
  await check.answer(current);
  await expect(screen.getByText("Update HUI", { exact: true })).toBeVisible();
  await expect(screen.getByText("Installed version 0.1.5")).toBeVisible();
  await expect(screen.getByText("HUI 0.1.5 is the latest release.")).toBeVisible();
  await expect(screen.getByText("Check only. Run /update to install an available release.")).toBeVisible();
  await expect(screen.getByRole("button", /^Update to /u)).toHaveCount(0);
  await expect(screen.getByRole("button", "Reload HUI")).toHaveCount(0);
  expect(await hui.providerRequests()).toBe(before);
});
