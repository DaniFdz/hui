/** Compacting through a PI extension's own command: the summary lands as the transcript's divider and every earlier turn
 * stays in sight (CHAT-064). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a plugin action that compacts the session writes the Context compacted divider, keeps every earlier turn and leaves the session ready", { tags: ["CHAT-064"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const idle = screen.getByLabel("Session status: Idle");
  const compacted = screen.getByLabel(/^Context compacted, from \S+ tokens$/u);

  const session = await hui.createSession({ title: "Compacting by command" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // The fixture's summarizer holds only for a conversation that asked for it, so the marker can be caught when it lands.
  await message.fill("FIRST_TURN E2E_SLOW_COMPACT keep this turn");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  // The extension's own command compacts with PI's summarizer, the same one /compact uses.
  await message.fill("/fixture-compact keep the fixture checks");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(compacted).toHaveCount(0);
  await hui.provider.release();
  await expect(compacted).toBeVisible();
  await expect(idle).toBeVisible();
  // Every earlier turn is still in the transcript, and the summary is the divider's own disclosure.
  await expect(transcript.getByText("FIRST_TURN E2E_SLOW_COMPACT keep this turn")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeHidden();
  await transcript.getByText("Show summary").tap();
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeVisible();

  // The next message is answered normally.
  await message.fill("After the summary");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("After the summary")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
});
