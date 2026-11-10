/** A bot offers GPT-Live calls once a ChatGPT login is there: its chat header and its overview profile carry Call, its Settings tab stops saying what a call needs, and without a login neither shows it (CALL-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

test("a bot shows Call in its chat header and its overview profile with a ChatGPT login, and its Settings says what a call needs without one", { tags: ["CALL-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Switchboard", soul: "# Who I am\nA bot the CALL area calls.\n" })).bot;
  const header = screen.getByTestId("chat-header");
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Switchboard");

  // No ChatGPT login in this world: neither the chat nor the profile offers Call, and Settings says what one needs.
  await expect(header.getByRole("button", "Call Switchboard")).toHaveCount(0);
  await expect(panel.getByRole("button", "Call Switchboard")).toHaveCount(0);
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Needs a ChatGPT login")).toBeVisible();

  // With the login Settings → Models saves, both places offer the call and the note is gone.
  await hui.chatGptLogin(true);
  await hui.reload();
  await expect(header.getByRole("button", "Call Switchboard")).toBeVisible();
  const overview = await panelOverview(screen, "Switchboard");
  await expect(overview.getByRole("button", "Call Switchboard")).toBeVisible();
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(overview.getByText("Needs a ChatGPT login")).toHaveCount(0);
  await expect(overview.getByLabel("Call voice: Default (Cove)")).toBeVisible();

  // The login is the gate, not the chat: signing out takes Call away again.
  await hui.chatGptLogin(false);
  await hui.reload();
  const signedOut = await panelOverview(screen, "Switchboard");
  await expect(header.getByRole("button", "Call Switchboard")).toHaveCount(0);
  await expect(signedOut.getByRole("button", "Call Switchboard")).toHaveCount(0);
  await screen.getByRole("button", /^Calls /u).tap();
  await expect(signedOut.getByText("Needs a ChatGPT login")).toBeVisible();
});
