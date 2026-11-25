/** Continue without a prompt resumes a session on PI's worker whose branch ends in a failed reply, reading Continuing…
 * while the gateway takes it and adding no user message of its own (CHAT-070). The provider fails the first run only, so
 * the resumed turn is the same request answered; the held `/resume` answer is what lets the label be read in flight. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const RESUME = /\/__hui\/sessions\/[^/]+\/resume$/u;

test("Continue without a prompt reads Continuing… while the gateway takes it, then resumes the failed run with no user message", { tags: ["CHAT-070"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const resume = screen.getByRole("button", "Continue without a prompt");

  const session = await hui.createSession({ title: "Failed run", tool: "pi" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill("E2E_FAIL_ONCE");
  await screen.getByRole("button", "Send message").tap();
  // The first request fails: the branch ends in the failed reply Continue resumes from.
  await expect(screen.getByRole("button", "Copy error")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeHidden();
  await expect(resume).toBeEnabled();

  const held = await hui.intercept("POST", RESUME);
  await resume.tap();
  await held.arrived();
  await expect(resume).toHaveText("Continuing…");
  await held.deliver();

  // The resumed turn is the same request answered, with no user turn added for the operator.
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("E2E_FAIL_ONCE")).toHaveCount(1);
  await expect(resume).toHaveText("Continue");
});
