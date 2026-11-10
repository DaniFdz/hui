/** A composer's `@` suggests the bots a mention may tag, before local files, never the chat's own bot, an archived one
 * or one nobody may tag; Enter inserts the handle without sending, and a sent tag leaves a "Sent to <name>" row in the
 * agent's chat and the message in the bot's own (BOT-057). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const makeBot = async (hui: Hui, body: Record<string, unknown>) =>
  (await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { soul: "# Who I am\nA terse fixture bot.\n", ...body })).bot;

test("a composer's @ suggests the bots it may tag before files, never the chat's own bot or one nobody may tag, and a sent tag leaves a Sent to row and the message in the bot's chat", { tags: ["BOT-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const tagger = await makeBot(hui, { name: "Tagger", title: "Research helper", avatar: { emoji: "🦊" } });
  await makeBot(hui, { name: "Shy", tagging: "nobody" });
  const gone = await makeBot(hui, { name: "Gone" });
  await hui.api("DELETE", `/__hui/bots/${gone.id}`);
  const session = await hui.createSession({ title: "Worker", cwd: hui.workspace });

  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const paths = screen.getByLabel("Bots and local paths");

  // Typing @ opens the list on a bot a mention may tag, before the local files of its workspace.
  await message.fill("@");
  await expect(paths.getByRole("option", /^@tagger /u)).toBeVisible();
  await expect(paths.getByRole("option", { name: /^@/u, selected: true })).toBeVisible();
  await expect(paths.getByRole("option", /^@shy /u)).toHaveCount(0);
  await expect(paths.getByRole("option", /^@gone /u)).toHaveCount(0);
  await expect(paths.getByRole("option", /^fixture\.txt/u)).toBeVisible();

  // Enter inserts the handle without sending.
  await message.fill("@tag");
  await expect(paths.getByRole("option", { name: /^@tagger /u, selected: true })).toBeVisible();
  await message.press("Enter");
  await expect(message).toHaveValue("@tagger ");
  await expect(paths).toBeHidden();
  await expect(screen.getByTestId("transcript").getByText("hello from the fixture")).toHaveCount(0);

  // Sent, the agent hands the work over and keeps a row with the bot's face; the bot's chat has it as the session's.
  await message.fill("E2E_MESSAGE_BOT @tagger");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Sent to Tagger")).toBeVisible();
  await expect.poll(async () => (await hui.faces()).some((face) => face.size === "sm" && face.emoji === "🦊")).toBe(true);
  await hui.open(`/bots/${tagger.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("hello from the fixture")).toBeVisible();
  await expect(transcript.getByText("Worker")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  // In the bot's own chat, @ never suggests the bot itself.
  await screen.getByLabel("Message").fill("@t");
  await expect(screen.getByText("No matching local paths.")).toBeVisible();
  await expect(screen.getByLabel("Bots and local paths").getByRole("option")).toHaveCount(0);
});
