/** A goal is one objective a conversation keeps pursuing: /goal starts it, HUI continues it after a clean turn until
 * the goal pauses itself, and its Run status popover pauses, edits and clears it (CHAT-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a goal starts from /goal, continues by itself, and pauses, edits and clears from its Run status popover", { tags: ["CHAT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");

  // Start a goal whose first turn the provider holds, so the operator can pause it while it runs.
  const paused = await hui.createSession({ title: "Paused goal" });
  await hui.open(`/sessions/${paused.id}`);
  await message.fill("/goal E2E_REPLAY get CI green on PR 1");
  await send.tap();
  await expect(transcript.getByText("E2E_REPLAY get CI green on PR 1")).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, goal pursuing/u);
  await trigger.tap();
  await expect(popover).toBeVisible();
  await expect(popover.getByText("Pursuing goal", { exact: true }).first()).toBeVisible();
  await expect(popover).toContainText("E2E_REPLAY get CI green on PR 1");
  await popover.getByRole("button", "Pause goal").tap();
  await hui.provider.release();
  await expect(trigger).toHaveAccessibleName(/^Run status: Goal paused/u);
  await expect(popover.getByRole("button", "Resume goal")).toBeVisible();
  // A paused goal is not pursued: no continuation turn is queued behind the paused run.
  await expect(transcript.getByText("Continue the goal", { exact: false })).toBeHidden();

  // The popover reads the whole objective and retypes it in place; saving starts the goal again and sends the new
  // objective as its next turn.
  await popover.getByRole("button", "Edit goal objective").tap();
  await expect(popover.getByLabel("Goal objective")).toHaveValue("E2E_REPLAY get CI green on PR 1");
  await popover.getByLabel("Goal objective").fill("E2E_REPLAY get CI green on PR 1 and the nightly job");
  await popover.getByRole("button", "Save goal").tap();
  await expect(popover.getByLabel("Goal objective")).toBeHidden();
  await expect(trigger).toHaveAccessibleName(/^Run status: Working, goal pursuing/u);
  await expect(transcript.getByText("and the nightly job", { exact: false })).toBeVisible();

  await popover.getByRole("button", "Clear goal").tap();
  await expect(trigger).toBeHidden();

  // A goal the operator leaves alone keeps working after each clean turn, and stops itself at the cap.
  const running = await hui.createSession({ title: "Running goal" });
  await hui.open(`/sessions/${running.id}`);
  await message.fill("/goal get the tests green");
  await send.tap();
  await expect(transcript.getByText("get the tests green")).toBeVisible();
  await expect(transcript.getByText("Continue the goal", { exact: false }).first()).toBeVisible();
  await expect(trigger).toHaveAccessibleName(/^Run status: Goal paused/u);
});
