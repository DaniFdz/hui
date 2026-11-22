/** A bot that received an agent's handoff can message that agent later: the agent's chat shows the message as the bot's
 * with its face and name, answers it in a new turn and keeps it across a reload, while a session that never handed the
 * bot work is refused and receives nothing (BOT-059). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** The return address a bot answers in a tag: the `agent:<session>` form. */
const address = (id: string) => ["agent", id].join(":");

test("a bot replies to the agent that handed it work, whose chat shows the bot's message and answers it in a new turn kept by a reload, while a session that never tagged it gets a refusal and nothing", { tags: ["BOT-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  const caller = await hui.createSession({ title: "Handing out work" });
  const stranger = await hui.createSession({ title: "Never handed work" });
  const bot = (await hui.api<{ bot: { id: string; name: string; handle: string } }>("POST", "/__hui/bots", { name: "Helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const transcript = screen.getByTestId("transcript");
  const say = async (text: string) => {
    await screen.getByLabel("Message").fill(text);
    await screen.getByRole("button", "Send message").tap();
  };

  // The agent hands the bot work, and the work it hands over asks the bot to reply to it.
  const reply = `E2E_CALL:${json({ name: "message_bot", input: { to: address(caller.id), message: "The build is green." } })}`;
  const ask = `E2E_CALL:${json({ name: "message_bot", input: { to: `@${bot.handle}`, message: `${reply} Please check the build.` } })}`;
  await hui.open(`/sessions/${caller.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await say(ask);
  await expect(transcript.getByText(`tool answered: Queued for @${bot.handle}.`)).toBeVisible();

  // The bot's chat takes the handoff and replies to the return address it carries.
  await hui.open(`/bots/${bot.id}`);
  await expect(transcript.getByText(/Please check the build\./u)).toBeVisible();
  await expect(transcript.getByText(`tool answered: Queued for ${address(caller.id)}.`)).toBeVisible();

  // The agent's chat shows the bot's message with its name and answers it in a new turn.
  await hui.open(`/sessions/${caller.id}`);
  await expect(transcript.getByText("The build is green.")).toBeVisible();
  await expect(transcript.getByRole("link", "Helper")).toHaveAttribute("href", `/bots/${bot.id}`);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // A reload keeps it.
  await hui.reload();
  await expect(transcript.getByText("The build is green.")).toBeVisible();
  await expect(transcript.getByRole("link", "Helper")).toHaveAttribute("href", `/bots/${bot.id}`);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // A session that never handed this bot work is refused, and receives nothing.
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await say(`E2E_CALL:${json({ name: "message_bot", input: { to: address(stranger.id), message: "Anyone there?" } })}`);
  await expect(transcript.getByText("tool answered: A bot can only reply to agents that have messaged this bot.")).toBeVisible();
  await hui.open(`/sessions/${stranger.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/Anyone there\?/u)).toBeHidden();
});
