/** A bot finds what was said long ago by searching its whole chat, and the search, zoom and date calls show in its chat (BOT-035). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("a bot searches its whole chat for something said earlier, and its chat shows every search call", { tags: ["BOT-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Remembrancer");
  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const message = screen.getByLabel("Message");
  await expect(idle).toBeVisible();

  await message.fill("OPT_SEARCH_TARGET first, the deploy window");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.").first()).toBeVisible();
  await expect(idle).toBeVisible();

  await message.fill("E2E_SEARCH please");
  await screen.getByRole("button", "Send message").tap();
  await expect(idle).toBeVisible();
  const group = transcript.getByText("Used 4 tools");
  await hui.scrollTo(transcript, group);
  await group.tap();

  // The search that found it: the line the message is in, one call per search, never the message whole.
  await hui.scrollTo(transcript, transcript.getByText(/^Searched for OPT_SEARCH_TARGET/u).first());
  await transcript.getByText(/^Searched for OPT_SEARCH_TARGET/u).first().tap();
  await expect(transcript.getByText(/newest first:/u).first()).toBeVisible();
  await expect(transcript.getByText(/0\+1\|user: OPT_SEARCH_TARGET first, the deploy window/u).first()).toBeVisible();

  // A phrase the chat never said, and an empty query: each answered, in its own card.
  await transcript.getByText(/^Searched for nothing here mentions this phrase/u).tap();
  await expect(transcript.getByText(/No line mentions "nothing here mentions this phrase" in the chat\./u).first()).toBeVisible();
  await transcript.getByRole("button", /^Used search chat/u).tap();
  await expect(transcript.getByText("No word to search for.").first()).toBeVisible();

  // Never compacted: the whole history stays searchable, and the chat keeps both turns.
  await expect(transcript.getByText("OPT_SEARCH_TARGET first, the deploy window")).toBeVisible();
  await expect(screen.getByLabel(/^Context window:/u)).toBeVisible();
});
