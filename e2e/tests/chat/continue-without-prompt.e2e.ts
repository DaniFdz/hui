/** Only an SDK-worker session offers Continue without a prompt, and after a finished reply it sends the continuation prompt (CHAT-022). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("only an SDK-worker session offers Continue, and after a finished reply it sends the continuation prompt", { tags: ["CHAT-022"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");
  const transcript = screen.getByTestId("transcript");
  const continueRun = screen.getByRole("button", "Continue without a prompt");

  const durable = await hui.createSession({ title: "Durable continue" });
  await hui.open(`/sessions/${durable.id}`);
  await message.fill("Hello");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(continueRun).toBeHidden();

  const sdk = await hui.createSession({ title: "SDK continue", tool: "pi" });
  await hui.open(`/sessions/${sdk.id}`);
  await expect(idle).toBeVisible();
  await expect(continueRun).toBeDisabled();
  await message.fill("E2E_REPLAY");
  await send.tap();
  await hui.provider.held();
  await expect(continueRun).toBeDisabled();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(idle).toBeVisible();
  await continueRun.tap();
  await expect(transcript.getByText("Continue from where you left off.", { exact: false })).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(continueRun).toBeEnabled();
});
