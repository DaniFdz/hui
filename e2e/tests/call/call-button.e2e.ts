/**
 * Call on a bot, and what the chat, its overview and its Settings say about it (CALL-001): with a ChatGPT login a bot's
 * chat header and its overview profile offer `Call <bot>`; without one, neither does and the bot's Settings tab says
 * *Needs a ChatGPT login* beside its Calls heading, while a login status that could not be read leaves Call out with no
 * such note, since no login was reported missing.
 *
 * The shared gateway holds no ChatGPT login (the launcher seeds one only for the quota checks), so the signed-in half
 * answers `/__hui/calls` from the page: whether a call can run is the gateway's to say, and the button's rule is the
 * UI's.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

/** What the gateway answers when a ChatGPT login exists. */
const SIGNED_IN = JSON.stringify({
  model: "gpt-live-1-codex",
  voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
  chatgpt: { signedIn: true, account: { name: "Personal" } },
  active: 0,
  limit: 2,
});

test("a bot's chat header and overview profile offer Call with a ChatGPT login and nothing without one, and its Settings tab says what calls need", { tags: ["CALL-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Juno", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const header = screen.getByTestId("chat-header");

  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Juno");
  // No ChatGPT login: neither the chat nor the profile offers a call.
  await expect(header.getByRole("button", "Call Juno")).toHaveCount(0);
  await expect(panel.getByRole("button", "Call Juno")).toHaveCount(0);

  // The bot's Settings tab says what a call needs, so the missing button has a reason.
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByRole("heading", "Calls")).toBeVisible();
  await expect(panel.getByText("Needs a ChatGPT login")).toBeVisible();

  // With a login, both places offer the bot's call.
  const signedIn = await hui.answerAll("GET", /\/__hui\/calls$/u, SIGNED_IN);
  await hui.reload();
  await expect(header.getByRole("button", "Call Juno")).toBeVisible();
  await expect(panel.getByRole("button", "Call Juno")).toBeVisible();
  await expect(panel.getByText("Needs a ChatGPT login")).toHaveCount(0);
  await signedIn.stop();

  // A login status that cannot be read offers no call either, and no note claims a login is missing.
  const unreadable = await hui.answerAll("GET", /\/__hui\/calls$/u, JSON.stringify({ error: "The ChatGPT login could not be read." }), 500);
  await hui.reload();
  await expect(panel.getByLabel("About Juno")).toBeVisible();
  await expect(header.getByRole("button", "Call Juno")).toHaveCount(0);
  await expect(panel.getByRole("button", "Call Juno")).toHaveCount(0);
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Needs a ChatGPT login")).toHaveCount(0);
  await unreadable.stop();
});
