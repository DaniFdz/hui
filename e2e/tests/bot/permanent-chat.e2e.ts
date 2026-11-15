/** A bot's chat lists and runs /clear and offers Rewind to here on the operator's messages, while it never offers /compact, Compact now or a fork; its model and thinking level still change (BOT-012). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;

test("a bot's chat lists and runs /clear and offers Rewind to here, while it never offers /compact, Compact now or Fork, and its model and thinking level still change", { tags: ["BOT-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: reply("Ready when you are.") });
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Ready when you are.")).toBeVisible();

  const message = screen.getByLabel("Message");
  await message.fill("/");
  await expect(screen.getByText("/reload", { exact: true })).toBeVisible();
  await expect(screen.getByText("/clear", { exact: true })).toBeVisible();
  await expect(screen.getByText("/compact", { exact: true })).toHaveCount(0);
  await message.fill("");

  await message.fill("Plan the week");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await hui.messageActions(transcript.getByText("Plan the week"));
  // Both the composer's prompt and the prompt the API sent the bot are the operator's own messages, so both offer it.
  await expect(transcript.getByRole("button", "Rewind to here")).toHaveCount(2);
  await expect(transcript.getByLabel("Fork into a new session from here")).toHaveCount(0);

  await screen.getByLabel(/^Context window:/u).tap();
  await expect(screen.getByText("Latest run tokens")).toBeVisible();
  await expect(screen.getByText("Compact now")).toHaveCount(0);

  await screen.getByLabel(/^Model: /u).tap();
  await screen.getByLabel("Search models").fill("opus");
  await screen.getByLabel("Model", { exact: true }).getByText("Opus fixture").tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Thinking effort").fill("0");
  await expect(screen.getByLabel("Thinking: low")).toBeVisible();
});
