/** A child that finishes while its parent is still running steers the parent through one queued Steer entry, which the parent takes in on its own (AGENT-025). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a child finishing while its parent runs arrives as one Steer entry that the parent takes in", { tags: ["AGENT-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const queue = screen.getByLabel("Queued messages");
  const session = await hui.createSession({ title: "Steered parent" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_SUBAGENTS_STEERING");

  await expect(queue).toBeVisible();
  await expect(queue.getByText("[HUI subagent completion event]", { exact: false })).toBeVisible();
  await expect(queue.getByText("Steer")).toHaveCount(1);
  await expect(queue.getByText("Follow up")).toHaveCount(0);
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(transcript.getByText("Parent incorporated the child result through steering.")).toBeHidden();

  await hui.provider.release();

  await expect(transcript.getByText("Parent incorporated the child result through steering.")).toBeVisible();
  await expect(queue).toBeHidden();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByLabel(/^Subagent finished: /u)).toHaveCount(1);
});
