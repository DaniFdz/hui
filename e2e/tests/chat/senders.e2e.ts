/** A message a bot delivers shows on the left with its face, a bubble in its color and its name, rendered and without its header, with Copy and Reply on that text, no Rewind, and a color change without a reload; a header HUI didn't write reads as that sender too, a handle HUI doesn't know included (CHAT-056). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a bot's message shows its face, its color and its name on the left, rendered, with Copy and Reply but no Rewind", { tags: ["CHAT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const { bot } = await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { name: "Grace", soul: "You babysit pull requests.", avatar: { shape: "round", color: "#2fc49a" } });
  const session = await hui.createSession({ title: "Bot sender" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const transcript = screen.getByTestId("transcript");
  const body = "**Grace** reports back";
  await screen.getByLabel("Message").fill(call("message_bot", { to: `@${bot.handle}`, message: call("message_bot", { to: `agent:${session.id}`, message: body }) }));
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Grace reports back")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // Rendered, without its header, under the bot's name and beside its face.
  await expect(transcript.getByText(body)).toHaveCount(0);
  await expect(transcript.getByText(/\[from @grace/u)).toHaveCount(0);
  hui.expectLinkTo(transcript, "Grace", `/bots/${bot.id}`);
  await expect.poll(async () => (await hui.faces()).map((face) => face.color)).toContain("#2fc49a");
  const bubble = transcript.getByText("Grace reports back");
  const tint = (await hui.look(bubble)).background;
  await expect(screen.getByLabel(/^From @grace, marker \d+ of \d+$/u)).toBeVisible();

  // Copy and Reply take what the bot wrote; only the operator's own prompt offers Rewind.
  await hui.messageActions(bubble);
  await screen.getByRole("button", "Copy message").tap();
  await expect.poll(() => hui.copied()).toBe(body);
  await hui.messageActions(bubble);
  const replies = transcript.getByRole("button", "Reply to message");
  // The prompt and its reply, then Grace's message and its reply: hers is the third.
  await expect(replies).toHaveCount(4);
  await replies.nth(2).tap();
  await expect(screen.getByLabel("Message")).toHaveValue(/\*\*Grace\*\* reports back/u);
  await screen.getByLabel("Message").fill("");
  await expect(transcript.getByRole("button", "Rewind to here")).toHaveCount(1);

  // The bot's color reaches the open chat without a reload.
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { avatar: { color: "#ff6b4a" } });
  await expect.poll(async () => [...new Set((await hui.faces()).map((face) => face.color))]).toEqual(["#ff6b4a"]);
  expect((await hui.look(bubble)).background).not.toEqual(tint);
});

test("a header HUI didn't write reads as that sender too, a bot it knows by name and a handle it doesn't at all", { tags: ["CHAT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string; handle: string } }>("POST", "/__hui/bots", { name: "Scout", soul: "You check builds." });
  const session = await hui.createSession({ title: "Written headers" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const transcript = screen.getByTestId("transcript");

  await hui.prompt(session, `[from ${bot.handle} · relayed from a Slack instruction] The build is green.`);
  await expect(transcript.getByText("The build is green.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  hui.expectLinkTo(transcript, "Scout", `/bots/${bot.id}`);
  await expect(transcript.getByText(/\[from /u)).toHaveCount(0);
  await expect(transcript.getByText("You", { exact: true })).toHaveCount(0);

  await hui.prompt(session, "[from ghost] Still here.");
  await expect(transcript.getByText("Still here.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText("@ghost")).toBeVisible();
  await expect(transcript.getByRole("button", "Rewind to here")).toHaveCount(0);
});
