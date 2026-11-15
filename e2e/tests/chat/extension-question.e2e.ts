/** A PI extension's question opens one card above the composer; picking a choice or skipping closes it, returns focus to Message and leaves the session idle (CHAT-051). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("an extension's question opens above the composer, and submitting or skipping it leaves the chat idle and ready", { tags: ["CHAT-051"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const card = screen.getByTestId("question-card");
  const idle = screen.getByLabel("Session status: Idle");
  const transcript = screen.getByTestId("transcript");

  const session = await hui.createSession({ title: "Extension question" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  await message.fill("/hui-e2e-question select");
  await screen.getByRole("button", "Send message").tap();
  await expect(card).toBeVisible();
  // The card sits above the composer, titled by the question it asks.
  const frame = (await card.boundingBox())!;
  expect(frame.y + frame.height).toBeLessThanOrEqual((await message.boundingBox())!.y);
  await expect(card.getByText("Question", { exact: true })).toBeVisible();
  await expect(card.getByText("HUI E2E choice", { exact: true })).toBeVisible();
  await expect(card.getByText("First option", { exact: true })).toBeVisible();
  await expect(card.getByText("Second option", { exact: true })).toBeVisible();
  await expect(card.getByPlaceholder("Type your own answer here")).toBeVisible();
  await expect(card.getByRole("button", "Submit")).toBeVisible();
  await expect(card.getByRole("button", "Skip")).toBeVisible();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();

  await card.getByText("First option", { exact: true }).tap();
  await card.getByRole("button", "Submit").tap();
  await expect(card).toBeHidden();
  await expect(screen.getByText("Question answered: First option")).toBeVisible();
  await expect(message).toBeFocused();
  await expect(idle).toBeVisible();
  await expect(message).toBeEnabled();
  // Answering a command adds no message of its own.
  await expect(transcript.getByText("Start a conversation")).toBeVisible();

  await message.fill("/hui-e2e-question");
  await screen.getByRole("button", "Send message").tap();
  await expect(card).toBeVisible();
  await expect(card.getByPlaceholder("Type browser answer")).toBeVisible();
  await card.getByRole("button", "Skip").tap();
  await expect(card).toBeHidden();
  await expect(screen.getByText("Question cancelled")).toBeVisible();
  await expect(message).toBeFocused();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();

  // The composer was never left busy: the next prompt is answered normally.
  await message.fill("A prompt after the question");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
});
