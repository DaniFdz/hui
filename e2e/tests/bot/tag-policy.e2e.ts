/** A bot set to Only when @mentioned takes a tag only when the operator's message names it, and a Nobody bot is never
 * suggested and refuses every tag (BOT-058). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const makeBot = async (hui: Hui, body: Record<string, unknown>) =>
  (await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { soul: "# Who I am\nA terse fixture bot.\n", ...body })).bot;

test("a bot set to Only when @mentioned takes a tag only when the operator's message names it, and a Nobody bot is never suggested and refuses every tag", { tags: ["BOT-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  await makeBot(hui, { name: "Bob", tagging: "mention" });
  await makeBot(hui, { name: "Shy", tagging: "nobody" });
  const session = await hui.createSession({ title: "Worker", cwd: hui.workspace });

  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const send = async (text: string) => {
    await message.fill(text);
    await screen.getByRole("button", "Send message").tap();
  };

  // Only when @mentioned: a message that never names Bob is refused with what to do instead.
  await send("E2E_MESSAGE_BOT");
  await screen.getByText("Not sent to Bob").tap();
  await expect(screen.getByText("@bob takes a tag only when the operator's message names it (@bob). Ask them instead.")).toBeVisible();
  await expect(screen.getByText(/Queued for @bob\./u)).toHaveCount(0);

  // Naming it lets the tag through.
  await send("E2E_MESSAGE_BOT @bob please");
  await expect(screen.getByText("Sent to Bob")).toBeVisible();
  await expect(screen.getByText(/message_bot answered: Queued for @bob\./u)).toBeVisible();

  // Nobody: never offered by a composer's @, and every tag to it is refused.
  await message.fill("@");
  await expect(screen.getByLabel("Bots and local paths").getByRole("option", /^@shy /u)).toHaveCount(0);
  await expect(screen.getByLabel("Bots and local paths").getByRole("option", /^@bob /u)).toBeVisible();
  await send("E2E_MESSAGE_BOT @shy");
  await screen.getByText("Not sent to Shy").tap();
  await expect(screen.getByText("@shy takes no tags: the operator talks to it in its own chat.")).toBeVisible();
});
