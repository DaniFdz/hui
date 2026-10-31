/** Offline reading and connection recovery in a production build (SHELL-044, SHELL-045, SHELL-046, CHAT-074). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const MESSAGE = "Offline reading proof";
const DRAFT = "A draft that stays";

async function conversationSavedForOffline({ screen, hui }: { screen: Screen; hui: Hui }, title: string): Promise<void> {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill(MESSAGE);
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect.poll(() => hui.offlineFilesReady(), { timeout: 120_000 }).toBe(true);
}

test("a conversation saved on this device opens again without the gateway", { tags: ["SHELL-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");

  await conversationSavedForOffline({ screen, hui }, "Saved offline");
  await message.fill(DRAFT);
  await hui.network("offline");
  await hui.reload();

  await expect(screen.getByText("Message text is saved on this device.", { exact: false })).toBeVisible();
  await expect(transcript.getByText(MESSAGE)).toBeVisible();
  await expect(screen.getByLabel("Sessions").getByText("Saved offline", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Group options for")).toHaveCount(0);
  await expect(message).toHaveValue(DRAFT);
  await expect(screen.getByText("Send waits for a live connection.", { exact: false })).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(screen.getByRole("button", "Open terminal")).toBeDisabled();
});

test("reconnecting keeps the draft and sends nothing by itself", { tags: ["SHELL-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");

  await conversationSavedForOffline({ screen, hui }, "Reconnected offline");
  await message.fill(DRAFT);
  await hui.network("offline");
  await hui.reload();
  await expect(screen.getByText("Message text is saved on this device.", { exact: false })).toBeVisible();

  await hui.network("online");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByText("Message text is saved on this device.", { exact: false })).toBeHidden();
  await expect(message).toHaveValue(DRAFT);
  await expect(transcript.getByText(MESSAGE)).toHaveCount(1);
  await expect(transcript.getByText(DRAFT)).toBeHidden();

  await send.tap();
  await expect(transcript.getByText(DRAFT)).toBeVisible();
  await expect(transcript.getByText(MESSAGE)).toHaveCount(1);
});

test("forgetting the saved conversations keeps the draft and stops restoring them", { tags: ["SHELL-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");

  await conversationSavedForOffline({ screen, hui }, "Forgotten offline");
  await message.fill(DRAFT);
  await hui.network("offline");
  await hui.reload();
  await expect(screen.getByText("Message text is saved on this device.", { exact: false })).toBeVisible();

  await screen.getByRole("button", "Forget saved conversations").tap();
  await expect(message).toHaveValue(DRAFT);
  await expect(send).toBeDisabled();
  await expect(screen.getByText("Message text is saved on this device.", { exact: false })).toBeHidden();
  await expect(screen.getByRole("button", "Forget saved conversations")).toBeHidden();

  await hui.reload();
  await expect(screen.getByText("Could not reach HUI. Check the connection and try again.")).toBeVisible();
  await expect(screen.getByLabel("Sessions").getByText("Forgotten offline", { exact: true })).toBeHidden();
  await expect(screen.getByText(MESSAGE)).toBeHidden();
});

test("a silent connection recovers without sending the draft", { tags: ["CHAT-074"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const reconnecting = screen.getByTestId("composer-status");
  const editedDraft = `${DRAFT} after editing`;

  await conversationSavedForOffline({ screen, hui }, "Silent connection");
  await message.fill(DRAFT);
  await hui.network("silent");
  await expect(reconnecting).toBeVisible({ timeout: 50_000 });
  await message.fill(editedDraft);
  await expect(message).toHaveValue(editedDraft);
  await expect(send).toBeDisabled();

  await hui.network("online");
  await expect(reconnecting).toBeHidden();
  await expect(send).toBeEnabled();
  await expect(message).toHaveValue(editedDraft);
  await expect(transcript.getByText(MESSAGE)).toHaveCount(1);
  await expect(transcript.getByText(DRAFT, { exact: true })).toHaveCount(0);
  await expect(transcript.getByText(editedDraft, { exact: true })).toHaveCount(0);

  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.reload();
  await expect(transcript.getByText(editedDraft, { exact: true })).toHaveCount(1);
  await expect(transcript.getByText(DRAFT, { exact: true })).toHaveCount(0);
  await expect(transcript.getByText(MESSAGE)).toHaveCount(1);
});
