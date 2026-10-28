/** The docked bot panel: Show and Close (or Hide) it beside the chat's overview, with its open state and width kept across a reload and another page (BOT-018), its left edge dragged between the narrowest and the width that leaves the chat 420px with a click that moves nothing saving nothing (BOT-020), and the same edges from the focused keys (BOT-021). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const CHAT_ROOM = 420;
const MIN_WIDTH = 320;

/** Creates a bot named `name` and opens its chat, where its panel sits beside the chat unless it was closed. */
async function openBot(hui: Hui, name: string): Promise<string> {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  return bot.id;
}

test("Show and Close dock the panel beside the bot's overview, and its open state and width survive a reload and another page", { tags: ["BOT-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const id = await openBot(hui, "Solo");
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  await expect(panel).toBeVisible();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
  const beside = async () => {
    const box = (await panel.boundingBox())!;
    const chat = (await header.boundingBox())!;
    return { docked: box.x >= chat.x + chat.width - 1, width: Math.round(box.width) };
  };
  await expect.poll(beside).toEqual({ docked: true, width: 344 });

  await screen.getByRole("button", "Close the bot panel").tap();
  await expect(panel).toBeHidden();
  await hui.reload();
  await expect(header).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(screen.getByRole("button", "Show the bot panel")).toBeVisible();

  await screen.getByRole("button", "Show the bot panel").tap();
  await expect(panel).toBeVisible();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
  const resizer = screen.getByLabel("Resize the bot panel");
  await resizer.focus();
  await hui.keyboard.down("ArrowLeft");
  await hui.keyboard.up("ArrowLeft");
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(368);

  await hui.reload();
  await expect(header).toBeVisible();
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(368);
  await hui.open("/");
  await expect(screen.getByRole("tab", "Bots")).toBeVisible();
  await expect(panel).toBeHidden();
  await hui.open(`/bots/${id}`);
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(368);
  await expect(screen.getByLabel("About Solo")).toBeVisible();

  await screen.getByRole("button", "Hide the bot panel").tap();
  await expect(panel).toBeHidden();
  await hui.reload();
  await expect(header).toBeVisible();
  await expect(panel).toBeHidden();
});

test("dragging the panel's edge widens and narrows it between 320px and the width that leaves the chat 420px, keeps the width across a reload and saves nothing when the click does not move", { tags: ["BOT-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  await openBot(hui, "Solo");
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  const width = async () => Math.round((await panel.boundingBox())!.width);
  const chat = async () => Math.round((await header.boundingBox())!.width);
  const resizer = screen.getByLabel("Resize the bot panel");
  await expect(panel).toBeVisible();
  await expect.poll(width).toBe(344);

  await hui.dragBy(resizer, { dx: -200, dy: 0 }, async () => {
    await expect.poll(width).toBe(544);
  });
  await expect.poll(width).toBe(544);
  await hui.reload();
  await expect(header).toBeVisible();
  await expect.poll(width).toBe(544);

  await hui.dragBy(screen.getByLabel("Resize the bot panel"), { dx: -400, dy: 0 }, async () => {
    await expect.poll(width).toBe(762);
  });
  await expect.poll(chat).toBe(CHAT_ROOM);
  await hui.dragBy(screen.getByLabel("Resize the bot panel"), { dx: 500, dy: 0 }, async () => {
    await expect.poll(width).toBe(MIN_WIDTH);
  });

  await hui.dragBy(screen.getByLabel("Resize the bot panel"), { dx: -224, dy: 0 }, async () => {
    await expect.poll(width).toBe(544);
  });
  await hui.wideScreen(1100);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(544);
  await screen.getByLabel("Resize the bot panel").tap();
  await hui.wideScreen(1440);
  await expect.poll(width).toBe(544);
});

test("the focused edge resizes the panel with ArrowLeft and ArrowRight, Shift for bigger steps, Home to 320px and End to the width the chat allows", { tags: ["BOT-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  await openBot(hui, "Solo");
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  const width = async () => Math.round((await panel.boundingBox())!.width);
  await expect(panel).toBeVisible();
  await expect.poll(width).toBe(344);
  const resizer = screen.getByLabel("Resize the bot panel");
  const press = async (key: string, shift = false) => {
    if (shift) await hui.keyboard.down("Shift");
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
    if (shift) await hui.keyboard.up("Shift");
  };

  await screen.getByLabel("About Solo").focus();
  await press("ArrowLeft");
  await expect.poll(width).toBe(344);

  await resizer.focus();
  await press("ArrowLeft");
  await expect.poll(width).toBe(368);
  await press("ArrowRight");
  await expect.poll(width).toBe(344);
  await press("ArrowLeft", true);
  await expect.poll(width).toBe(424);
  await press("ArrowRight", true);
  await expect.poll(width).toBe(344);
  await press("Home");
  await expect.poll(width).toBe(MIN_WIDTH);
  await press("End");
  await expect.poll(width).toBe(762);
  await expect.poll(async () => Math.round((await header.boundingBox())!.width)).toBe(CHAT_ROOM);
  await press("ArrowRight");
  await expect.poll(width).toBe(738);
});
