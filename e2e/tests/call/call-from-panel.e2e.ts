/**
 * Calling a bot from its expanded panel (CALL-028): Call in the overview, while the panel fills the bot's view, brings
 * the chat back with the call view over it, and the panel offers no Expand for as long as the call is up.
 *
 * The call itself cannot connect in this environment (a headless engine has no microphone, CALL-004), which is enough
 * for this outcome: the panel's rule follows a call being under way, not the audio it carries.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

/** What the gateway answers when a ChatGPT login exists, which is what offers Call at all. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

test("Call in the expanded panel brings the chat back with the call over it, and the panel offers no Expand while the call is up", { tags: ["CALL-028"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  const header = screen.getByTestId("chat-header");

  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Juno");
  await screen.getByRole("button", "Expand the panel").tap();
  await expect(screen.getByRole("button", "Show the chat beside the panel")).toBeVisible();
  // Expanded, the panel fills the bot's view: the chat is not beside it.
  await expect(header).toBeHidden();

  await panel.getByRole("button", "Call Juno").tap();
  await expect(screen.getByLabel("Call with Juno")).toBeVisible();
  await expect(header).toBeVisible();
  await expect(screen.getByRole("button", "Show the chat beside the panel")).toHaveCount(0);
  await expect(screen.getByRole("button", "Expand the panel")).toHaveCount(0);
  await signedIn.stop();
});
