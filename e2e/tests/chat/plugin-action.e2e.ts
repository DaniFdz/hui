/** A plugin action runs its extension without a model turn: the extension's notice appears as a toast, no message is added, the composer unlocks with the session Idle, and a busy run's menu says extension commands run after the turn (CHAT-049). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a plugin action runs the extension without a model turn and a busy menu defers it", { tags: ["CHAT-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Plugin action" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const before = await hui.providerRequests();

  await message.fill("/check-status");
  await expect(menu.getByText("$check-status", { exact: true })).toBeVisible();
  await menu.getByText("$check-status", { exact: true }).tap();
  await expect(message).toHaveValue("$check-status ");
  await message.pressSequentially("ready");
  await screen.getByRole("button", "Send message").tap();

  await expect(screen.getByText("Extension executed: ready")).toBeVisible();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(message).toBeEnabled();
  expect(await hui.providerRequests()).toBe(before);

  await message.fill("/check-status ready");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Extension executed: ready")).toBeVisible();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  await expect(idle).toBeVisible();
  expect(await hui.providerRequests()).toBe(before);

  await message.fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await message.fill("/");
  await expect(screen.getByText(/Run extension commands after this turn\./u)).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(idle).toBeVisible();
});
