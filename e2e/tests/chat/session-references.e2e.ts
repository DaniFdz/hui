/** A reply can name another chat as `session:<id>`: the full id and an 8-character prefix become chips that read that
 * session's title and status, link to `/sessions/<id>` and are named `Open session <title> (<status>)`, and a plain
 * click on a chip opens that chat at that address, with Back returning to the reply. The same text in an inline code
 * span or a fenced code block stays literal, an id no session has stays plain text, and an ordinary Markdown link to
 * `/sessions/<id>` opens the chat the same way (CHAT-089).
 *
 * This proves what the reply draws and where each click lands. It cannot tell the app's own navigation from a document
 * load — the address, the header and the conversation would match either way — so the absence of a reload needs a
 * separate Browser-tool pass through the running app and is not claimed here. */
import { expect } from "e2e";
import { expectChatTitle } from "../sess/chat-header.ts";
import { test } from "../../fixtures/hui.ts";

test("a reply's session reference opens the chat it names, while code, an unknown id and an ordinary link stay plain", { tags: ["CHAT-089"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  // The chip resolves against the app's session list, so the target exists and is idle before the reply names it, and
  // it holds a message no other chat does, which tells the opened conversation from the one that linked to it.
  const target = await hui.createSession({ title: "Referenced target" });
  await hui.prompt(target, "Only the referenced target holds this message.");
  const referrer = await hui.createSession({ title: "Referencer" });
  await hui.open(`/sessions/${referrer.id}`);
  await hui.prompt(referrer, `E2E_SESSION_REFERENCE ${target.id}`);

  const chip = "Open session Referenced target (Idle)";
  const byId = transcript.getByRole("listitem").filter({ hasText: "By id" });
  const byPrefix = transcript.getByRole("listitem").filter({ hasText: "By prefix" });
  const openedTarget = async () => {
    await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${target.id}`);
    await expectChatTitle(screen, "Referenced target");
    await expect(transcript.getByText("Only the referenced target holds this message.")).toBeVisible();
  };

  // The reply arrives before the session list does, so each chip is waited for, then read: the title and status it
  // takes when it resolves are its accessible name, and it points at the chat it names.
  for (const named of [byId, byPrefix]) {
    await expect(named.getByRole("link", chip)).toBeVisible();
    await hui.expectLinkTo(named, chip, `/sessions/${target.id}`);
  }

  // The inline code span and the fenced block keep the text the agent typed: exactly two chips, no link around either
  // piece of code, and that text still reads as code in two places.
  const typed = transcript.getByText(`session:${target.id}`, { exact: true });
  await expect(transcript.getByRole("link", chip)).toHaveCount(2);
  await expect(transcript.getByRole("link").filter({ has: typed })).toHaveCount(0);
  await expect(typed).toHaveCount(2);
  await expect(typed).toHaveText([`session:${target.id}`, `session:${target.id}`]);

  // An id no session has stays exactly the text the reply wrote, with no link to follow.
  await expect(transcript.getByText("session:0badc0de", { exact: true })).toHaveText("session:0badc0de");
  await expect(transcript.getByRole("link", { name: /0badc0de/u })).toHaveCount(0);

  // A plain click on the chip opens the chat it names.
  await byId.getByRole("link", chip).tap();
  await openedTarget();

  // Back returns to the reply, which still offers both ways in.
  await hui.back();
  await expectChatTitle(screen, "Referencer");
  await expect(transcript.getByRole("link", chip)).toHaveCount(2);
  await hui.expectLinkTo(transcript, "the same chat", `/sessions/${target.id}`);

  // An ordinary Markdown link to the chat's own address opens it too.
  await transcript.getByRole("link", "the same chat").tap();
  await openedTarget();
});
