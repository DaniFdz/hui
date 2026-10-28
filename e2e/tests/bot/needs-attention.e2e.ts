/** A routine run that needs the operator reads "Needs attention" on the Routines page, the overview's Activity and Automations, with the guidance for its kind of failure and the original error (BOT-046). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const GUIDANCE = "Check the provider's quota or billing, then run again when it is available.";

test("a routine run that needs the operator reads Needs attention on the Routines page, the overview's Activity and Automations with its guidance and the original error", { tags: ["BOT-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Solo", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Quota check", sessionId: bot.sessionId, prompt: "E2E_ERROR_QUOTA check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", "Add routine").tap();
  await screen.getByRole("button", "Run now: Quota check").tap();
  const latestRuns = screen.getByLabel("Latest runs");
  await expect(latestRuns.getByText("Needs attention")).toBeVisible();
  await expect(latestRuns.getByText(GUIDANCE)).toBeVisible();
  await expect(latestRuns.getByText(/fixture quota exhausted/u)).toBeVisible();

  await screen.getByRole("button", "Back to Solo").tap();
  await expect(screen.getByText(/^Needs attention · Check the provider's quota or billing, then run again when it is available\. · /u)).toBeVisible();

  await hui.open("/settings/automation");
  await expect(screen.getByText("Quota check").first()).toBeVisible();
  await expect(screen.getByText("Needs attention").first()).toBeVisible();
  await expect(screen.getByText(GUIDANCE).first()).toBeVisible();
  await expect(screen.getByText(/fixture quota exhausted/u).first()).toBeVisible();
});
