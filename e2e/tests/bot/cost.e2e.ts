/** A bot's overview totals its chat, subagents and persisted memory spend and opens the cost per model (BOT-067). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { showBotPanel } from "./bot-panel.ts";

test("a bot's overview shows its total cost and, opened, the cost per model", { tags: ["BOT-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Penny", soul: "You count." });
  await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: "E2E_SUBAGENTS_START", wait: true, timeoutSeconds: 120 });

  await hui.open(`/bots/${bot.id}`);
  await showBotPanel(screen, "Penny");
  await expect(screen.getByText("Includes one subagent.")).toBeVisible();
  const total = screen.getByText("Total");
  await expect(total).toBeVisible();
  const perModel = screen.getByLabel("Cost per model");
  await expect(perModel).toBeHidden();
  await total.tap();
  await expect(perModel.getByText("hui-e2e/fixture")).toBeVisible();
  await expect(perModel.getByText("$0.00")).toBeVisible();
});

test("a bot's overview names its memory-summary cost after a gateway restart", { tags: ["BOT-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The ordinary fixture is free. Add a priced utility model only to this disposable gateway, so a real summary has
  // a visible cost while the bot's chat remains free; restore the shared fixture's model file even if the test fails.
  const path = join(hui.piAgentDir, "models.json");
  const original = await readFile(path, "utf8");
  const models = JSON.parse(original) as { providers: Record<string, { models: Array<{ id: string; [key: string]: unknown }> }> };
  const fixture = models.providers["hui-e2e"]!.models.find((model) => model.id === "fixture")!;
  models.providers["hui-e2e"]!.models.push({ ...fixture, id: "priced-memory", cost: { input: 500_000, output: 500_000, cacheRead: 0, cacheWrite: 0 } });
  try {
    await writeFile(path, JSON.stringify(models));
    const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", {
      name: "Memory Penny", soul: "You count.", memoryModel: "hui-e2e/priced-memory",
    });
    await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: `OPT_COST${" remembered".repeat(120)}`, wait: true, timeoutSeconds: 120 });
    const memory = () => hui.api<{ status: { pending: number; usage: { calls: number; cost: number } } }>("GET", `/__hui/bots/${bot.id}/memory`);
    await expect.poll(async () => {
      const status = (await memory()).status;
      return status.pending === 0 && status.usage.calls > 0 && status.usage.cost >= 1;
    }, { timeout: 60_000 }).toBe(true);
    const spent = (await memory()).status.usage;

    // `hui.open` resolves at the page's own load event, before the app has downloaded and drawn (e2e/fixtures/hui.ts).
    // The gateway goes away only once the bot's chat is on screen: a restart that cuts the app's module downloads leaves
    // the page on the boot screen's connection failure, and the load this test makes afterwards never reaches the app
    // again — the boot screen keeps its message and the panel's trigger never mounts. The chat is the page the test
    // reads, so that is the state to wait on.
    await hui.open(`/bots/${bot.id}`);
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

    // The summary spend was made before this restart. The panel must keep it without claiming a startup limit.
    await hui.restartGateway();
    await expect.poll(async () => (await memory()).status.usage).toEqual(spent);
    await hui.open(`/bots/${bot.id}`);
    await showBotPanel(screen, "Memory Penny");
    await screen.getByText("Total", { exact: true }).tap();
    const perModel = screen.getByLabel("Cost per model");
    await expect(perModel.getByText("Memory summaries", { exact: true })).toBeVisible();
    await expect(perModel.getByText(`$${spent.cost.toFixed(2)}`, { exact: true })).toBeVisible();
    await expect(perModel.getByText("Memory summaries, since HUI started")).toHaveCount(0);
  } finally {
    await writeFile(path, original);
  }
});
