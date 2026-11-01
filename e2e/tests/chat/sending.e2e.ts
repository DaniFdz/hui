/** A sent message reads Sending… until the gateway takes the prompt, then settles in the transcript (CHAT-066). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a sent message reads Sending… until the gateway takes the prompt, then settles", { tags: ["CHAT-066"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const sending = transcript.getByText("Sending…");

  const session = await hui.createSession({ title: "Sending" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("Take this one");

  const held = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/prompt$/u);
  await screen.getByRole("button", "Send message").tap();
  await held.arrived();
  await expect(transcript.getByText("Take this one")).toBeVisible();
  await expect(sending).toBeVisible();

  await held.deliver();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(sending).toBeHidden();
  await expect(transcript.getByText("Take this one")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
