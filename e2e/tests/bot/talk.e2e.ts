/** A message sent from a bot's composer gets a streamed reply signed with the bot's name and the roster previews it, a
 * message sent while it works waits as a follow-up, and a routine's message shows in the chat as the routine's before
 * the reply to it (BOT-011). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

test("a bot answers its composer with a reply signed with its name, the roster previews it, a message sent while it works waits as a follow-up, and a routine's message shows as the routine's", { tags: ["BOT-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Echo", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");
  await hui.open(`/bots/${bot.id}`);

  await message.fill(`E2E_REPLY:${Buffer.from("Right with you.").toString("base64url")}`);
  await send.tap();
  await expect(transcript.getByText("Right with you.")).toBeVisible();
  await expect(idle).toBeVisible();
  // The operator's message and the reply it got carry their senders: "You", and the bot's own name.
  await expect(transcript.getByText("You", { exact: true })).toBeVisible();
  await expect(transcript.getByText("Echo", { exact: true })).toHaveCount(1);

  await roster(screen, hui);
  await expect(screen.getByLabel(/^Echo,/u).getByText("Right with you.")).toBeVisible();

  // A second message sent while the bot works waits in the queue as a follow-up.
  await hui.open(`/bots/${bot.id}`);
  await message.fill("E2E_REPLAY");
  await send.tap();
  await hui.provider.held();
  await message.fill("And this one afterwards.");
  await message.press("ControlOrMeta+Enter");
  const queue = screen.getByLabel("Queued messages");
  await expect(queue.getByText("And this one afterwards.")).toBeVisible();
  await expect(queue.getByText("Follow up")).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  // A routine's message reaches the same chat as the routine's, before the reply to it.
  const task = (await hui.api<{ task: { id: string } }>("POST", "/__hui/automation/tasks", {
    name: "Nightly sweep", sessionId: bot.sessionId, prompt: "Sweep the fixtures.", enabled: true,
    schedule: { kind: "cron", expression: "0 23 * * *", timezone: "UTC" },
  })).task;
  await hui.api("POST", `/__hui/automation/tasks/${task.id}/run`);
  await expect(transcript.getByText("Nightly sweep")).toBeVisible();
  await expect(transcript.getByText("Routine")).toBeVisible();
  await expect.poll(async () => (await transcript.getByText("Fixture response.").count())).toBeGreaterThan(1);
  await expect(transcript).toHaveText(/Sweep the fixtures\..*Nightly sweep.*Routine.*Fixture response\./su);
});
