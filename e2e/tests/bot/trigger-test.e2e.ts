/** Test puts "[trigger: <name> · test: a sample event]" in the bot's chat, says "Sent a test event to <name>'s chat." and,
 * when it cannot reach the bot, says why (BOT-052). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

test("Test sends a sample event into the bot's chat and says so, and a test that cannot reach the bot says why", { tags: ["BOT-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Pinger", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const trigger = (await hui.api<{ trigger: { id: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it." })).trigger;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Pinger");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();
  const transcript = screen.getByTestId("transcript");

  await screen.getByRole("button", "Test Reviews").tap();
  await expect(screen.getByText("Sent a test event to Pinger's chat.")).toBeVisible();
  await expect(transcript.getByText(/What a listener the operator runs reported/u)).toBeVisible();
  await expect(transcript.getByText("Reviews", { exact: true })).toBeVisible();
  await expect(transcript.getByText("test: a sample event")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ runs: { status: string; test?: boolean }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs
    .map((run) => [run.status, run.test])).toEqual([["fired", true]]);

  const refused = await hui.intercept("POST", new RegExp(`/__hui/bots/${bot.id}/triggers/${trigger.id}/test$`, "u"));
  await screen.getByRole("button", "Test Reviews").tap();
  await refused.reject(409, "Pinger's chat cannot be reached right now.");
  await expect(screen.getByText("Pinger's chat cannot be reached right now.")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ runs: unknown[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs.length).toBe(1);
});
