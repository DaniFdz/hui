/** /clear empties a session's transcript in place, keeps the old one on disk and refuses arguments, attachments, active work and a bot's chat (CHAT-041). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("/clear from the menu empties the transcript in the same row and keeps the old transcript on disk", { tags: ["CHAT-041"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const menu = screen.getByLabel("Commands and paths");
  const session = await hui.createSession({ title: "Clear me" });
  await hui.open(`/sessions/${session.id}`);
  await message.fill("Seed before clearing 7f3a");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/cle");
  await expect(menu.getByText("Clear this session's context and start a fresh PI transcript")).toBeVisible();
  await menu.getByText("/clear", { exact: true }).tap();
  await expect(message).toHaveValue("/clear ");
  await screen.getByRole("button", "Send message").tap();

  await expect(screen.getByText("Session context cleared.")).toBeVisible();
  await expect(screen.getByText("Start a conversation")).toBeVisible();
  await expect(transcript.getByText("Seed before clearing 7f3a")).toBeHidden();
  expect(await hui.url()).toContain(`/sessions/${session.id}`);
  await hui.sessionList();
  await expect(screen.getByTestId("session-row").filter({ hasText: "Clear me" })).toHaveCount(1);
  expect(await hui.stored("Seed before clearing 7f3a")).toEqual(expect.arrayContaining([expect.stringMatching(/^config\/hui\/durable\//u)]));
});

test("/clear refuses arguments and active work", { tags: ["CHAT-041"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Clear refused" });
  await hui.open(`/sessions/${session.id}`);
  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();

  await message.fill("/clear");
  await screen.getByRole("button", "Steer message; touch and hold to enqueue").tap();
  await expect(screen.getByText("Finish or stop active work before clearing the session.")).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/clear everything");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Use /clear without arguments or attachments.")).toBeVisible();
  await expect(message).toHaveValue("/clear everything");
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(screen.getByText("Use /clear without arguments or attachments.")).toBeHidden();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
});

test("/clear refuses attachments", { tags: ["CHAT-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Clear refused" });
  await hui.open(`/sessions/${session.id}`);
  await message.fill("Seed before refusing 5c1d");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Seed before refusing 5c1d")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/clear");
  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Use /clear without arguments or attachments.")).toBeVisible();
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await expect(transcript.getByText("Seed before refusing 5c1d")).toBeVisible();
});

test("a bot's chat neither lists nor runs /clear", { tags: ["CHAT-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Keeper", soul: "Keeper, a fixture bot." });
  await hui.open(`/bots/${bot.id}`);
  await message.fill("/");
  const menu = screen.getByLabel("Commands and paths");
  await expect(menu.getByText("/reload", { exact: true })).toBeVisible();
  await expect(menu.getByText("/clear", { exact: true })).toBeHidden();
  await message.fill("/clear");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("A bot keeps one permanent chat, so /clear is not available here. Its memory summarizes older messages by itself.")).toBeVisible();
});
