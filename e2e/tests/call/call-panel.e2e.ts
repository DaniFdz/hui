/** Call in the overview while the bot panel fills the view brings the chat back with the call view over it, and the panel offers no Expand while that call is up (CALL-028). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

test("Call from the overview brings the chat back from an expanded panel with the call over it, and Expand is gone while the call is up", { tags: ["CALL-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Proscenium", soul: "# Who I am\nA bot the CALL area calls.\n" })).bot;
  await hui.chatGptLogin(true);
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Proscenium");
  const header = screen.getByTestId("chat-header");

  // The panel fills the bot's view: the chat is gone and Expand became the way back to it.
  await screen.getByRole("button", "Expand the panel").tap();
  await expect(screen.getByRole("button", "Show the chat beside the panel")).toBeVisible();
  await expect(header).toBeHidden();

  // Call from the overview puts the chat back with the call over it, and takes Expand away while the call is up.
  await panel.getByRole("button", "Call Proscenium").tap();
  const call = screen.getByLabel("Call with Proscenium");
  await expect(call).toBeVisible();
  await expect(header).toBeVisible();
  await expect(screen.getByRole("button", "Show the chat beside the panel")).toHaveCount(0);
  await expect(screen.getByRole("button", "Expand the panel")).toHaveCount(0);

  // The call over; the panel is docked beside the chat again and Expand is back.
  await call.getByRole("button", "Back to the chat").tap();
  await expect(call).toHaveCount(0);
  await expect(panel.getByRole("button", "Expand the panel")).toBeVisible();
});
