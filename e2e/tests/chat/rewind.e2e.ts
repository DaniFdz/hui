/** Rewind to here gives a settled or running user message back to the composer, and is offered only on the operator's own sent prompts outside a bot's chat (CHAT-034). */
import { expect, type Screen } from "e2e";
import { test } from "../../fixtures/hui.ts";

const chat = (screen: Screen) => ({
  message: screen.getByLabel("Message"),
  send: screen.getByRole("button", "Send message"),
  transcript: screen.getByTestId("transcript"),
  rewind: screen.getByTestId("transcript").getByRole("button", "Rewind to here"),
  idle: screen.getByLabel("Session status: Idle"),
});

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("Rewind to here gives a settled message's text and attachment back to the focused composer at once", { tags: ["CHAT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, send, transcript, rewind, idle } = chat(screen);
  const session = await hui.createSession({ title: "Rewind a message" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill("First question");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await message.fill("Summarize these notes");
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
  await message.fill("Last question");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(3);
  await expect(idle).toBeVisible();
  await expect(rewind).toHaveCount(3);

  await rewind.nth(1).tap();
  await expect(screen.getByText("Message restored to the composer. The previous branch is kept.")).toBeVisible();
  await expect(message).toHaveValue("Summarize these notes");
  await expect(message).toBeFocused();
  await expect(screen.getByRole("button", "Remove notes.txt")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(transcript.getByText("First question")).toBeVisible();
  await expect(transcript.getByText("Summarize these notes")).toBeHidden();
  await expect(transcript.getByText("Last question")).toBeHidden();
});

test("Rewind to here on a running prompt stops the run and gives the prompt back", { tags: ["CHAT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, send, transcript, rewind, idle } = chat(screen);
  const session = await hui.createSession({ title: "Rewind a running prompt" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill("E2E_REPLAY");
  await send.tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();

  await rewind.tap();
  await expect(message).toHaveValue("E2E_REPLAY");
  await expect(message).toBeFocused();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("E2E_REPLAY")).toBeHidden();
  await expect(transcript.getByText(/Replay prefix/u)).toBeHidden();
});

test("Rewind to here is not offered on a prompt that was not sent", { tags: ["CHAT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, send, transcript, rewind, idle } = chat(screen);
  const session = await hui.createSession({ title: "Rewind an unsent prompt" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill("Sent prompt");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(rewind).toHaveCount(1);

  const held = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/prompt$/u);
  await message.fill("Refused prompt");
  await send.tap();
  await held.arrived();
  await expect(transcript.getByText("Refused prompt")).toBeVisible();
  await expect(rewind).toHaveCount(1);
  await held.reject(503, "The session runtime is restarting.");
  await expect(transcript.getByText("Not sent — draft recovered.")).toBeVisible();
  await expect(rewind).toHaveCount(1);
});

test("Rewind to here is not offered on a session's message to its subagent", { tags: ["CHAT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = await hui.createSession({ title: "Spawning parent" });
  const child = await hui.createSubagent(parent);
  await hui.open(`/sessions/${child.id}`);
  await expect(chat(screen).transcript.getByText("Spawning parent")).toBeVisible();
  await expect(chat(screen).rewind).toHaveCount(0);
});

test("Rewind to here is not offered on a bot's message in a session, nor anywhere in a bot's chat", { tags: ["CHAT-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { message, send, transcript, rewind, idle } = chat(screen);
  const { bot } = await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { name: "Grace", soul: "You babysit pull requests." });
  const session = await hui.createSession({ title: "Tag a bot" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill(call("message_bot", { to: `@${bot.handle}`, message: call("message_bot", { to: `agent:${session.id}`, message: "Grace reports back" }) }));
  await send.tap();
  await expect(transcript.getByText("Grace reports back")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(rewind).toHaveCount(1);

  await hui.open(`/bots/${bot.id}`);
  await expect(transcript.getByText("Sent to Tag a bot")).toBeVisible();
  await message.fill("Hello Grace");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Hello Grace")).toBeVisible();
  await expect(rewind).toHaveCount(0);
});
