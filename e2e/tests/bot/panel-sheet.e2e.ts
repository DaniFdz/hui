/** The bot panel on a phone: Show the bot panel opens it as a sheet over the chat on the page it last showed, without Expand or a resizable edge, Back leads to the overview, Close or the backdrop closes it, its body scrolls and the page never gets wider than the screen (BOT-024). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a phone opens the panel as a sheet over the chat on the page it last showed, Back leads to the overview, Close or the backdrop closes it and it never widens the page", { tags: ["BOT-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  await screen.getByRole("button", /^Tools & skills/u).tap();
  await expect(panel.getByText("Available tools")).toBeVisible();

  await hui.phoneScreen();
  await expect(screen.getByRole("button", "Show the bot panel")).toBeVisible();
  expect(await panel.count()).toBe(0);
  await screen.getByRole("button", "Show the bot panel").tap();
  await expect(panel.getByText("Available tools")).toBeVisible();
  await expect(screen.getByRole("button", "Expand the panel")).toHaveCount(0);
  await expect(screen.getByLabel("Resize the bot panel")).toHaveCount(0);
  await expect.poll(async () => {
    const box = (await panel.boundingBox())!;
    const chat = (await header.boundingBox())!;
    return { over: box.x < chat.x + chat.width - 1, width: Math.round(box.width) };
  }).toEqual({ over: true, width: 380 });
  await expect(screen.getByRole("button", "Close the bot panel")).toHaveCount(2);
  expect(await hui.overflowX()).toBe(0);

  const tools = panel.getByText("Available tools");
  const before = (await tools.boundingBox())!.y;
  await hui.wheel(panel, 400);
  await expect.poll(async () => (await tools.boundingBox())!.y).toBeLessThan(before);
  expect(await hui.overflowX()).toBe(0);

  await screen.getByRole("button", "Back to Solo").tap();
  await expect(screen.getByLabel("About Solo")).toBeVisible();

  await panel.getByRole("button", "Close the bot panel").tap();
  await expect(panel).toBeHidden();
  await screen.getByRole("button", "Show the bot panel").tap();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
  await screen.getByRole("button", "Close the bot panel").first().tap({ position: { x: 4, y: 400 } });
  await expect(panel).toBeHidden();
});
