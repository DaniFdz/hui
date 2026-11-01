/** Run now queues a bot's routine behind a busy turn and sends it into the chat as the routine, and the run shows as Completed with its summary or with its error in Latest runs and the overview's Activity (BOT-041). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Run now queues the routine's prompt behind a busy bot, sends it into the chat as the routine and records the run's summary or its error", { tags: ["BOT-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Runner", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Morning check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", "Add routine").tap();
  await expect(screen.getByText("Runs appear here with their outcome.")).toBeVisible();

  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await screen.getByRole("button", "Run now: Morning check").tap();
  await expect(screen.getByLabel("Queued messages").getByText("[routine: Morning check] Check the build.")).toBeVisible();
  await hui.provider.release();

  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(transcript.getByText("Check the build.")).toBeVisible();
  await expect(transcript.getByText("Morning check")).toBeVisible();
  await expect(transcript.getByText("Routine")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  const latestRuns = screen.getByLabel("Latest runs");
  await expect(latestRuns.getByText("Morning check")).toBeVisible();
  await expect(latestRuns.getByText("Completed")).toBeVisible();
  await expect(latestRuns.getByText(/^Run now · /u)).toBeVisible();
  await expect(latestRuns.getByText("Fixture response.")).toBeVisible();
  const runs = async () => (await hui.api<{ runs: { sessionId: string; taskName: string; status: string; summary?: string }[] }>("GET", "/__hui/automation")).runs.filter((run) => run.sessionId === bot.sessionId);
  expect(await runs()).toEqual([expect.objectContaining({ taskName: "Morning check", status: "completed", summary: "Fixture response." })]);

  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Broken check", sessionId: bot.sessionId, prompt: "E2E_ERROR_LONG check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
  });
  await screen.getByRole("button", "Run now: Broken check").tap();
  await expect(latestRuns.getByText("Needs attention")).toBeVisible();
  await expect(latestRuns.getByText(/^The routine's input was not answered: model_error: 400/u)).toBeVisible();
  await expect(screen.getByText("Needs attention")).toBeVisible();
  await expect(screen.getByText(/^The routine's input was not answered: model_error: 400/u).first()).toBeVisible();

  await screen.getByRole("button", "Back to Runner").tap();
  await expect(screen.getByText("Activity")).toBeVisible();
  await expect(screen.getByText(/^Completed · .*Fixture response\.$/u)).toBeVisible();
  await expect(screen.getByText(/^Needs attention · .*Check its chat before running it again\./u)).toBeVisible();
});