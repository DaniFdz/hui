/** A message's footer replies with a quote and copies it, and its context menu copies the text, a selection or code (CHAT-030, CHAT-032). The quoted draft is read from the Markdown field the form sends: the rich editor draws a quote as a blockquote, so no `>` marker is visible. */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function reply(screen: Screen, hui: Hui, prompt: string, session?: { id: string }) {
  session ??= await hui.createSession({ title: "Message actions" });
  await hui.open(`/sessions/${session.id}`);
  // A line break in a message is a hard break, which is what Shift+Enter writes: a fill's own newline would be a
  // paragraph break in a rich editor, and a quote would then carry a blank quoted line.
  const [first = "", ...rest] = prompt.split("\n");
  const message = screen.getByLabel("Message");
  await message.fill(first);
  for (const line of rest) {
    await message.press("Shift+Enter");
    await message.pressSequentially(line);
  }
  await screen.getByRole("button", "Send message").tap();
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response").first()).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  return transcript;
}

test("Copy response copies a reply and turns to Copied, and a sent prompt's context menu copies it or code", { tags: ["CHAT-030"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const transcript = await reply(screen, hui, "Selected words stay put");
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await transcript.getByRole("button", "Copy response").tap();
  await expect(transcript.getByRole("button", "Copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("Fixture response.");

  const prompt = transcript.getByText("Selected words stay put");
  await hui.contextMenu(prompt);
  await screen.getByText("Copy as markdown").tap();
  await expect(screen.getByText("Copy as markdown")).toBeHidden();
  await expect.poll(() => hui.copied()).toBe("Selected words stay put");

  await screen.getByLabel("Message").fill("E2E_CODE_PARITY");
  await screen.getByRole("button", "Send message").tap();
  const code = transcript.getByText(/^line 1: fixture/u);
  await expect(code).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByRole("button", "Copy response").last()).toBeVisible();
  await hui.contextMenu(code);
  await screen.getByText("Copy code").tap();
  await expect.poll(() => hui.copied()).toMatch(/^line 1: fixture .*\nline 10: fixture /su);
});

test("A sent prompt's context menu copies a selection", { tags: ["CHAT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const transcript = await reply(screen, hui, "Selected words stay put");
  const prompt = transcript.getByText("Selected words stay put");
  await prompt.doubleTap();
  await hui.contextMenu(prompt);
  await screen.getByText("Copy selection").tap();
  await expect.poll(() => hui.copied()).toBe("words");
});

test("A message from a session has Copy message", { tags: ["CHAT-030"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const parent = await hui.createSession({ title: "Coordinator" });
  const child = await hui.createSubagent(parent);
  await hui.open(`/sessions/${child.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Subagent child result: the fixture contract is working.")).toBeVisible();
  await hui.messageActions(transcript.getByText("E2E_SUBAGENT_CHILD"));
  await screen.getByRole("button", "Copy message").tap();
  await expect.poll(() => hui.copied()).toBe("E2E_SUBAGENT_CHILD");
});

test("A bot's message has Copy message, and its context menu copies its code", { tags: ["CHAT-030"] }, async ({ screen, hui }) => {
  const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
  await hui.clipboard();
  const { bot } = await hui.api<{ bot: { handle: string } }>("POST", "/__hui/bots", { name: "Grace", soul: "You babysit pull requests." });
  const session = await hui.createSession({ title: "Bot message" });
  const report = "Grace reports back\n\n```\nconst answer = 42;\n```";
  const transcript = await reply(screen, hui, call("message_bot", { to: `@${bot.handle}`, message: call("message_bot", { to: `agent:${session.id}`, message: report }) }), session);
  const code = transcript.getByText("const answer = 42;");
  await expect(code).toBeVisible();
  await hui.messageActions(transcript.getByText("Grace reports back"));
  await screen.getByRole("button", "Copy message").tap();
  await expect.poll(() => hui.copied()).toBe(report);

  await hui.contextMenu(code);
  await screen.getByText("Copy code").tap();
  await expect.poll(() => hui.copied()).toBe("const answer = 42;\n");
});

test("A refused clipboard write leaves the menu item saying Copy failed — retry", { tags: ["CHAT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard({ refuse: true });
  const transcript = await reply(screen, hui, "Copy me");
  await hui.contextMenu(transcript.getByText("Copy me"));
  await screen.getByText("Copy as markdown").tap();
  await expect(screen.getByText("Copy failed — retry")).toBeVisible();
  expect(await hui.copied()).toBe("");
});

test("On a phone screen the latest reply's Copy response is visible and copies on the first touch", { tags: ["CHAT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.phoneScreen();
  await hui.clipboard();
  const transcript = await reply(screen, hui, "Copy on a phone");
  const copy = transcript.getByRole("button", "Copy response");
  await expect(copy).toBeVisible();
  expect((await hui.look(copy)).opacity).toBeGreaterThan(0.5);
  await hui.touchTap(copy);
  await expect(transcript.getByRole("button", "Copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("Fixture response.");
});

async function replyTwice(screen: Screen, hui: Hui) {
  const message = screen.getByLabel("Message");
  // The quote is Markdown: the rich editor draws it as a blockquote and no `>` marker is visible, so the draft itself
  // is read from the field the form sends, which is the only place the markers live.
  const wire = screen.getByTestId("composer-markdown");
  const transcript = await reply(screen, hui, "First line\nSecond line");
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  await message.fill("My draft");
  await hui.messageActions(transcript.getByText(/^First line/u));
  await screen.getByRole("button", "Reply to message").first().tap();
  await expect(wire).toHaveValue(/^My draft\n\n> First line\n> Second line\n*$/u);
  await hui.messageActions(transcript.getByText("Fixture response."));
  await screen.getByRole("button", "Reply to message").last().tap();
  await expect(wire).toHaveValue(/^My draft\n\n> First line\n> Second line\n\n\n\n> Fixture response\.\n*$/u);
  await expect(message).toBeFocused();
  return { message, wire, transcript };
}

test("Reply to message quotes the message after the existing draft and focuses the composer, without sending", { tags: ["CHAT-032"] }, async ({ screen, hui }) => {
  const { transcript } = await replyTwice(screen, hui);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(transcript.getByText("My draft")).toBeHidden();
});

test("Reply to message leaves the caret at the end of the composer", { tags: ["CHAT-032"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { wire, transcript } = await replyTwice(screen, hui);
  await hui.keyboard.down("x");
  await hui.keyboard.up("x");
  // The caret is on the draft's own last line, below the quote: the reply's first word is a paragraph of its own, and
  // the quote keeps its markers and its own line. The wire is canonical here, so the blank lines it normalizes.
  await expect(wire).toHaveValue("My draft\n\n> First line\n> Second line\n\n> Fixture response.\n\nx");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
});
