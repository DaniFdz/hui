/** The bot panel's Expand: it fills the bot's view, Show the chat beside the panel brings the chat back as it was with a reply that streamed in meanwhile, its draft and its scroll, and expanded is never remembered (BOT-022); Escape there brings the chat back without stopping the bot's turn, and closes the sheet on a phone (BOT-023). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const REPLY = "Replay prefix — replay suffix";

/** Creates a bot named `name` titled `title` and opens its chat with its panel docked on the overview. */
async function openBot(hui: Hui, name: string, title: string): Promise<string> {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, title, soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  return bot.id;
}

/** Sends a message into the bot's chat that the fixture answers with `reply`. */
async function say(hui: Hui, id: string, reply: string): Promise<void> {
  await hui.api("POST", `/__hui/bots/${id}/messages`, { text: `E2E_REPLY:${Buffer.from(reply).toString("base64url")}` });
}

test("Expand fills the bot's view and Show the chat beside brings it back with the reply that streamed in meanwhile, its draft and its scroll, and expanded is never remembered", { tags: ["BOT-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const id = await openBot(hui, "Solo", "Fixture helper");
  const transcript = screen.getByTestId("transcript");
  const header = screen.getByTestId("chat-header");
  const panel = screen.getByLabel("Solo: bot panel");
  const replies = ["First reply. ".repeat(8), "Second reply. ".repeat(8), "Third reply. ".repeat(8), "Fourth reply. ".repeat(8), "Fifth reply. ".repeat(8), "Sixth reply. ".repeat(8)];
  for (const reply of replies) await say(hui, id, reply);
  await expect(transcript.getByText(replies.at(-1)!)).toBeVisible();

  const first = transcript.getByText(replies[0]!);
  const before = (await first.boundingBox())!.y;
  await hui.wheel(transcript, -300);
  const anchor = transcript.getByText(replies[2]!);
  await expect.poll(async () => (await first.boundingBox())!.y).toBeGreaterThan(before);
  const scrolled = (await anchor.boundingBox())!.y;
  await screen.getByLabel("Message").fill("A draft I have not sent");

  const chat = (await header.boundingBox())!;
  const view = { left: Math.round(chat.x), reaches: Math.round(chat.x + chat.width + (await panel.boundingBox())!.width) };
  await screen.getByRole("button", "Expand the panel").tap();
  await expect.poll(async () => {
    const box = (await panel.boundingBox())!;
    return { left: Math.round(box.x), reaches: Math.round(box.x + box.width) };
  }).toEqual(view);
  await expect(header).toBeHidden();

  await hui.api("POST", `/__hui/bots/${id}/messages`, { text: "E2E_REPLAY" });
  await hui.provider.held();
  await expect(panel.getByText("Fixture helper · Working")).toBeVisible();
  await hui.provider.release();
  await expect(panel.getByText("Fixture helper · Idle")).toBeVisible();

  await screen.getByRole("button", "Show the chat beside the panel").tap();
  await expect(header).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(344);
  await expect(transcript.getByText(REPLY)).toBeVisible();
  await expect(screen.getByLabel("Message")).toHaveValue("A draft I have not sent");
  await expect.poll(async () => Math.round((await anchor.boundingBox())!.y)).toBe(Math.round(scrolled));

  await screen.getByRole("button", "Expand the panel").tap();
  await expect(header).toBeHidden();
  await hui.reload();
  await expect(header).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(344);
  await expect(screen.getByRole("button", "Expand the panel")).toBeVisible();
});

test("Escape brings the chat back from an expanded panel without stopping the bot's turn, and closes the sheet on a phone", { tags: ["BOT-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const id = await openBot(hui, "Solo", "Fixture helper");
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  await expect(panel).toBeVisible();

  await hui.api("POST", `/__hui/bots/${id}/messages`, { text: "E2E_REPLAY" });
  await hui.provider.held();
  await screen.getByRole("button", "Expand the panel").tap();
  await expect(header).toBeHidden();
  await expect(panel.getByText("Fixture helper · Working")).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(header).toBeVisible();
  await expect(panel.getByText("Fixture helper · Working")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByTestId("transcript").getByText(REPLY)).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();

  await hui.phoneScreen();
  await expect(screen.getByRole("button", "Show the bot panel")).toBeVisible();
  await screen.getByRole("button", "Show the bot panel").tap();
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBeLessThanOrEqual(380);
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(panel).toBeHidden();
});
