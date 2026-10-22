/** A dropped session stream keeps the draft and holds sending until the stream is back, then the transcript catches up; a runtime that exited stops the stream (CHAT-016). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a dropped stream keeps the draft and holds sending until it is back, and an exited runtime stops the stream", { tags: ["CHAT-016"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const reconnecting = screen.getByText("Reconnecting — draft preserved.");

  const session = await hui.createSession({ title: "Dropped stream" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const reconnect = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/connect$/u);
  await hui.dropStreams();
  await reconnect.arrived();
  await expect(reconnecting).toBeVisible();
  await expect(screen.getByPlaceholder("Draft while HUI reconnects…")).toBeVisible();
  await message.fill("Written while away");
  await expect(send).toBeDisabled();
  await hui.prompt(session, "Sent from elsewhere");

  await reconnect.deliver();
  await expect(transcript.getByText("Sent from elsewhere")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(reconnecting).toBeHidden();
  await expect(message).toHaveValue("Written while away");
  await send.tap();
  await expect(transcript.getByText("Written while away")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(screen.getByRole("button", "Dismiss notification")).toBeHidden();

  const worker = await hui.createSession({ title: "Exited runtime", tool: "pi" });
  await hui.open(`/sessions/${worker.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Kept through the exit");
  await hui.exitRuntimes();
  await expect(screen.getByText("Stream stopped — draft preserved.")).toBeVisible();
  await expect(message).toHaveValue("Kept through the exit");
});
