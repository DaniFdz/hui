/**
 * Run now on a routine whose bot runs on a disconnected worker is not a lost run: it reads "Retry scheduled" with its
 * attempt, the next retry's time and the connection error, and Cancel before that time makes it Cancelled with no
 * further retry promised (BOT-047).
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Run = { id: string; taskName: string; status: string; retryAt?: string; attempt?: number; error?: string };

test("Run now on a routine whose worker is disconnected reads Retry scheduled with its attempt, next retry and the connection error, and Cancel leaves it Cancelled with no retry promised", { tags: ["BOT-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("Far box");
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots",
    { name: "Sentinel", worker: worker.id, soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Nightly check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 3 * * *", timezone: "UTC" },
  });
  const runs = async () => (await hui.api<{ runs: Run[] }>("GET", "/__hui/automation")).runs.filter((run) => run.taskName === "Nightly check");
  /** The run's own entry on Automations, which is the only one the run list draws. */
  const entry = () => screen.getByTestId("automation-run").first();

  // The worker goes away from Settings → Workers, as the operator does it, and its bot with it.
  await hui.open("/settings/workers");
  const workers = screen.getByTestId("settings-page");
  await workers.getByRole("button", "Disconnect").tap();
  await expect(workers.getByText("Disconnected", { exact: true })).toBeVisible();

  // Run now: the run can't reach the bot, so HUI keeps it to try again rather than lose it.
  await hui.open("/cron");
  await expect(screen.getByTestId("page-title")).toHaveText("Automations");
  await screen.getByRole("button", "Run now: Nightly check").tap();
  const error = "The bot's chat runs on Far box, which HUI is disconnected from. Connect it in Settings → Workers to continue.";
  await expect(entry().getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(entry().getByText(/Manual · started /u)).toBeVisible();
  await expect(entry().getByText(/Attempt 1 · Next retry /u)).toBeVisible();
  await expect(entry().getByRole("alert")).toHaveText(error);
  const queued = (await runs())[0]!;
  expect(queued).toEqual(expect.objectContaining({ status: "queued", attempt: 1, error }));
  expect(Date.parse(queued.retryAt!)).toBeGreaterThan(Date.now());
  // Automations also knows a run is in flight, and wakes for its retry.
  await expect(screen.getByText("1 run in flight")).toBeVisible();

  // Cancel before that time: the run is done, with no retry promised and nothing left for the routine to wait on.
  await entry().getByRole("button", "Cancel").tap();
  await expect(entry().getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(entry().getByRole("alert")).toHaveText("Run cancelled.");
  await expect(entry().getByText(/Attempt /u)).toHaveCount(0);
  await expect(entry().getByRole("button", "Cancel")).toHaveCount(0);
  const cancelled = (await runs())[0]!;
  expect(cancelled).toEqual(expect.objectContaining({ status: "cancelled" }));
  expect(cancelled.retryAt).toBeUndefined();
  await expect(screen.getByText("1 run in flight")).toHaveCount(0);
});
