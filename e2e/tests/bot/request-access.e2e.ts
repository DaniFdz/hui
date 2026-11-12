/** When the bot needs a tool that is off, its chat asks "Allow access to <tool>?" with its reason and Allow and Deny, the
 * roster says "Waiting for your answer" and the Tools & skills page shows the same request at its top; a reload keeps it.
 * Allow, in either place, turns the tool back on and the bot carries on with it; Deny leaves it off (BOT-033). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview, roster, showBotPanel } from "./bot-panel.ts";

const disabledTools = async (hui: Hui, id: string): Promise<string[]> =>
  (await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${id}`)).bot.disabledTools ?? [];

const REASON = "I need the shell to run the test suite before I report back.";

test("an access request waits in the chat, the roster and Tools & skills, survives a reload, and Allow turns the tool on while Deny leaves it off", { tags: ["BOT-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Tooly", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);

  // The operator turns the shell off for this bot. A phone draws the bot's panel as a sheet over the chat until it is
  // opened, and a desktop docks it beside the chat, so `showBotPanel` only presses anything on the phone.
  await showBotPanel(screen, "Tooly");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  const shell = screen.getByRole("switch", "Shell (bash)");
  await expect(shell).toBeChecked();
  await hui.flip(shell);
  await expect(shell).toBeChecked({ checked: false });
  await expect.poll(async () => await disabledTools(hui, bot.id)).toEqual(["bash"]);

  // The bot asks for it back: the chat carries the request with its reason and the two answers.
  await hideBotPanel(screen);
  await screen.getByLabel("Message").fill("E2E_REQUEST_ACCESS the checks");
  await screen.getByRole("button", "Send message").tap();
  const card = screen.getByTestId("question-card");
  await expect(card).toBeVisible();
  await expect(card.getByText(/^Allow access to bash \(powerful\)\? /u)).toBeVisible();
  await expect(card.getByText(new RegExp(`^Allow access to bash \\(powerful\\)\\? — ${REASON}$`, "u"))).toBeVisible();
  await expect(card.getByRole("radio", { name: /^Allow/u })).toBeVisible();
  await expect(card.getByRole("radio", { name: /^Deny/u })).toBeVisible();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();

  // The roster names the wait, and a reload keeps the question.
  await roster(screen, hui);
  const row = screen.getByLabel(/^Tooly,/u);
  await expect(row.getByText("Waiting for your answer")).toBeVisible();
  await hui.reload();
  await expect(card).toBeVisible();
  await expect(card.getByText(/^Allow access to bash \(powerful\)\? /u)).toBeVisible();

  // Tools & skills shows the same request at its top; Allow there turns the tool back on and the bot carries on.
  await panelOverview(screen, "Tooly");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  await expect(screen.getByText("Tooly asks: Allow access to bash (powerful)?")).toBeVisible();
  await expect(screen.getByText(REASON)).toBeVisible();
  await screen.getByRole("button", "Allow").tap();
  await expect.poll(async () => await disabledTools(hui, bot.id)).toEqual([]);
  await expect(shell).toBeChecked();
  // A phone's sheet covers the chat, so what the chat says is read once the panel is closed again.
  await hideBotPanel(screen);
  await expect(transcript.getByText("The operator allowed it: you now have bash, from your next step.")).toBeVisible();
  await expect(card).toBeHidden();

  // Off again, the bot asks once more; Deny in the chat leaves the tool off.
  await showBotPanel(screen, "Tooly");
  await hui.flip(shell);
  await expect(shell).toBeChecked({ checked: false });
  await expect.poll(async () => await disabledTools(hui, bot.id)).toEqual(["bash"]);
  await screen.getByRole("button", "Back to Tooly").tap();
  await hideBotPanel(screen);
  await screen.getByLabel("Message").fill("E2E_REQUEST_ACCESS the checks, again");
  await screen.getByRole("button", "Send message").tap();
  await expect(card).toBeVisible();
  await card.getByRole("radio", { name: /^Deny/u }).tap();
  await card.getByRole("button", "Submit").tap();
  await expect(card).toBeHidden();
  await expect(transcript.getByText("The operator denied the request. Carry on without it, and ask again only if the job truly needs it.")).toBeVisible();
  await expect.poll(async () => await disabledTools(hui, bot.id)).toEqual(["bash"]);
});
