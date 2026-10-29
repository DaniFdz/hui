/** A bot's chat is permanent: its composer offers /reload but never /clear or /compact, its context popover has no Compact now, its messages offer no Rewind or fork, and its model and thinking level still change (BOT-012). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a bot's chat never offers /clear, /compact, Compact now or Rewind while its model and thinking level still change", { tags: ["BOT-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await hui.api("POST", `/__hui/bots/${bot.id}/messages`, { text: `E2E_REPLY:${Buffer.from("Ready when you are.").toString("base64url")}` });
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Ready when you are.")).toBeVisible();

  const message = screen.getByLabel("Message");
  await message.fill("/");
  await expect(screen.getByText("/reload", { exact: true })).toBeVisible();
  await expect(screen.getByText("/clear", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("/compact", { exact: true })).toHaveCount(0);
  await message.fill("");

  await screen.getByLabel(/^Context window:/u).tap();
  await expect(screen.getByText("Latest run tokens")).toBeVisible();
  await expect(screen.getByText("Compact now")).toHaveCount(0);

  await hui.messageActions(transcript.getByText(/^E2E_REPLY:/u));
  await expect(screen.getByLabel("Copy prompt")).toBeVisible();
  await expect(screen.getByLabel("Rewind to here")).toHaveCount(0);
  await expect(screen.getByLabel("Fork into a new session from here")).toHaveCount(0);

  await screen.getByLabel(/^Model: /u).tap();
  await screen.getByLabel("Search models").fill("opus");
  await screen.getByLabel("Model", { exact: true }).getByText("Opus fixture").tap();
  await expect(screen.getByLabel("Model: Opus fixture")).toBeVisible();
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Thinking effort").fill("0");
  await expect(screen.getByLabel("Thinking: low")).toBeVisible();
});
