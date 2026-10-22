/** A bot's overview totals what it cost, its subagents included, and opens the cost per model (BOT-067). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a bot's overview shows its total cost and, opened, the cost per model", { tags: ["BOT-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Penny", soul: "You count." });
  await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: "E2E_SUBAGENTS_START", wait: true, timeoutSeconds: 120 });

  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByText("Includes one subagent.")).toBeVisible();
  const total = screen.getByText("Total");
  await expect(total).toBeVisible();
  const perModel = screen.getByLabel("Cost per model");
  await expect(perModel).toBeHidden();
  await total.tap();
  await expect(perModel.getByText("hui-e2e/fixture")).toBeVisible();
  await expect(perModel.getByText("$0.00")).toBeVisible();
});
