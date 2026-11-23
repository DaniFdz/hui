/** A bot that needs a tool the operator turned off asks for it: the chat's card and its Tools & skills page show the
 * same request with Allow and Deny, a reload keeps it, Allow turns the tool back on and the bot carries on with it,
 * and Deny leaves it off (BOT-033). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview, roster } from "./bot-panel.ts";

const REASON = "I need the shell to run the test suite before I report back.";
const ASKED = "Allow access to bash (powerful)?";

test("a bot's access request shows in its chat and on its Tools & skills page, survives a reload, and Allow turns the tool on while Deny leaves it off", { tags: ["BOT-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Asker", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const disabled = async () => (await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${bot.id}`)).bot.disabledTools ?? [];
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { disabledTools: ["bash"] });
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByTestId("question-card");
  const message = screen.getByLabel("Message");

  await hui.open(`/bots/${bot.id}`);
  await message.fill("E2E_REQUEST_ACCESS run the fixture suite");
  await screen.getByRole("button", "Send message").tap();
  await expect(card.getByRole("radiogroup", ASKED)).toBeVisible();
  await expect(card.getByText(`${ASKED} — ${REASON}`, { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();

  // The roster says what it waits for, and the panel's Tools & skills page carries the same request.
  await hui.open("/");
  await roster(screen, hui);
  await expect(screen.getByLabel(/^Asker, waiting for your answer/u)).toBeVisible();

  await screen.getByLabel(/^Asker,/u).tap();
  const panel = await panelOverview(screen, "Asker");
  await screen.getByRole("button", /^Tools & skills/u).tap();
  await expect(panel.getByText(`Asker asks: ${ASKED}`, { exact: true })).toBeVisible();
  await expect(panel.getByText(REASON, { exact: true })).toBeVisible();

  // A reload keeps it, in the chat and on the page the panel shows.
  await hui.reload();
  await panelOverview(screen, "Asker");
  await screen.getByRole("button", /^Tools & skills/u).tap();
  await expect(panel.getByText(`Asker asks: ${ASKED}`, { exact: true })).toBeVisible();
  await expect(card.getByRole("radiogroup", ASKED)).toBeVisible();

  // Allow, here, turns the shell back on and the bot carries on with it.
  await panel.getByRole("button", "Allow").tap();
  await expect.poll(disabled).not.toContain("bash");
  await expect(panel.getByText(`Asker asks: ${ASKED}`, { exact: true })).toBeHidden();
  await expect(transcript.getByText(/The operator allowed it: you now have/u)).toBeVisible();

  // Deny, in the chat, leaves the shell off.
  await hideBotPanel(screen);
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { disabledTools: ["bash"] });
  await message.fill("E2E_REQUEST_ACCESS run it again");
  await screen.getByRole("button", "Send message").tap();
  await expect(card.getByRole("radiogroup", ASKED)).toBeVisible();
  await card.getByRole("radio", /^Deny/u).tap();
  await card.getByRole("button", "Submit").tap();
  await expect(transcript.getByText(/The operator denied the request\. Carry on without it/u)).toBeVisible();
  await expect.poll(disabled).toContain("bash");
});
