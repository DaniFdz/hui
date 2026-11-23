/** Asked about something said long ago, the bot opens older lines of its memory and when they were said, and its chat
 * shows those zoom and date calls before an answer that quotes them, and is never compacted (BOT-035). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text).toString("base64url")}`;

test("a bot opens older lines of its memory and their dates, its chat shows the zoom and date calls before an answer that quotes them, and never compacts", { tags: ["BOT-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Recaller", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");
  const older = transcript.getByText("Remember the blue vault.");
  await hui.open(`/bots/${bot.id}`);

  // Something the bot said before, and a later message about it.
  await message.fill(reply("Remember the blue vault."));
  await send.tap();
  await expect(older).toHaveCount(1);
  await expect(idle).toBeVisible();
  await message.fill(reply("The code is 4417."));
  await send.tap();
  await expect(transcript.getByText("The code is 4417.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  // Asked about it, it opens the older lines and their dates before answering with them.
  await message.fill("E2E_ZOOM what did I say about the vault?");
  await send.tap();
  const used = transcript.getByText("Used 4 tools");
  await expect(used).toBeVisible();
  await used.tap();
  await expect(transcript.getByRole("button", /Used zoom/u)).toHaveCount(3);
  await expect(transcript.getByRole("button", /Used date/u)).toHaveCount(1);
  // The answer that follows the calls quotes the older line the bot opened.
  await expect(older).toHaveCount(2);
  await expect.poll(async () => (await older.last().boundingBox())!.y > (await used.boundingBox())!.y).toBe(true);
  expect(await older.last().textContent()).toBe("Remember the blue vault.");

  // Its call opens the line, and the date call says when it was said.
  await transcript.getByRole("button", /Used zoom/u).first().tap();
  await expect(transcript.getByText(new RegExp(`0\\+0\\|user: ${reply("Remember the blue vault.")}`, "u"))).toBeVisible();
  await transcript.getByRole("button", /Used date/u).tap();
  await expect(transcript.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/u)).toBeVisible();

  // Its chat is never compacted.
  await expect(transcript.getByText("Context compacted")).toHaveCount(0);
});
