/** Who may tag a bot holds: one set to Only when @mentioned takes a tag only from a message that names it, and one set
 * to Nobody is never suggested and refused every time (BOT-058). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const tag = (to: string) => `E2E_CALL:${Buffer.from(JSON.stringify({ name: "message_bot", input: { to, message: "Please check the fixture build." } })).toString("base64url")}`;

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("a bot set to Only when @mentioned takes a tag only from a message that names it, and one set to Nobody is never suggested and refused every time", { tags: ["BOT-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Asking around" });
  const mentioned = await makeBot(hui, "Mentioned");
  const quiet = await makeBot(hui, "Quiet");
  await hui.api("PATCH", `/__hui/bots/${mentioned.id}`, { tagging: "mention" });
  await hui.api("PATCH", `/__hui/bots/${quiet.id}`, { tagging: "nobody" });

  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const say = async (text: string) => {
    await message.fill(text);
    await send.tap();
  };
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // A bot nobody may tag is never suggested; one that only takes a named mention is.
  await message.fill("@");
  const menu = screen.getByRole("listbox", "Bots and local paths");
  await expect(menu.getByRole("option", { name: new RegExp(`@${mentioned.handle}\\b`, "u") })).toBeVisible();
  await expect(menu.getByRole("option", { name: new RegExp(`@${quiet.handle}\\b`, "u") })).toHaveCount(0);
  await message.fill("");

  // Without its handle in the operator's message the tag is not sent, and the row says why.
  await say(`${tag(`@${mentioned.handle}`)} please look at the failing build`);
  await expect(transcript.getByText(`Not sent to Mentioned`, { exact: true })).toBeVisible();
  await expect(transcript.getByText(`tool answered: @${mentioned.handle} takes a tag only when the operator's message names it (@${mentioned.handle}). Ask them instead.`, { exact: true })).toBeVisible();

  // Naming it in the message sends it.
  await say(`${tag(`@${mentioned.handle}`)} ask @${mentioned.handle} to look at the failing build`);
  await expect(transcript.getByText("Sent to Mentioned", { exact: true })).toBeVisible();
  await expect(transcript.getByText(`tool answered: Queued for @${mentioned.handle}.`, { exact: true })).toBeVisible();

  // A Nobody bot is refused every time, with what to do instead.
  await say(tag(`@${quiet.handle}`));
  await expect(transcript.getByText("Not sent to Quiet", { exact: true })).toBeVisible();
  await expect(transcript.getByText(`tool answered: @${quiet.handle} takes no tags: the operator talks to it in its own chat.`, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Sent to Quiet", { exact: true })).toHaveCount(0);
  await hui.open(`/bots/${quiet.id}`);
  await expect(screen.getByTestId("transcript").getByText("Please check the fixture build.")).toHaveCount(0);
});
