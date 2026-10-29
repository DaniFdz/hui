/** A goal is one objective a conversation keeps pursuing: /goal starts it, HUI continues it after a clean turn until
 * the goal pauses itself, and the pill pauses and clears it (CHAT-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a goal starts from /goal, continues by itself, and pauses and clears from its pill", { tags: ["CHAT-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");

  // Start a goal whose first turn the provider holds, so the operator can pause it while it runs.
  const paused = await hui.createSession({ title: "Paused goal" });
  await hui.open(`/sessions/${paused.id}`);
  await message.fill("/goal E2E_REPLAY get CI green on PR 1");
  await send.tap();
  await expect(transcript.getByText("E2E_REPLAY get CI green on PR 1")).toBeVisible();
  await expect(screen.getByText("Pursuing goal", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Pause goal")).toBeEnabled();
  await screen.getByRole("button", "Pause goal").tap();
  await hui.provider.release();
  await expect(screen.getByText("Goal paused", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Resume goal")).toBeVisible();
  // A paused goal is not pursued: no continuation turn is queued behind the paused run.
  await expect(transcript.getByText("Continue the goal", { exact: false })).toBeHidden();

  // The pill expands in place: the operator reads the whole objective there and retypes it.
  const goalDetail = screen.getByTestId("goal-detail");
  const status = screen.getByText("Goal paused", { exact: true });
  await expect(goalDetail).toBeHidden();
  await screen.getByRole("button", "Expand goal").tap();
  await expect(goalDetail).toContainText("E2E_REPLAY get CI green on PR 1");
  await status.tap();
  await expect(goalDetail).toBeHidden();
  await status.tap();
  await expect(goalDetail).toContainText("E2E_REPLAY get CI green on PR 1");
  await screen.getByRole("button", "Edit goal objective").tap();
  await screen.getByLabel("Goal objective").fill("E2E_REPLAY get CI green on PR 1 and the nightly job");
  await screen.getByRole("button", "Save goal").tap();
  await expect(goalDetail).toBeHidden();
  await expect(screen.getByText("Pursuing goal", { exact: true })).toBeVisible();
  await expect(transcript.getByText("and the nightly job", { exact: false })).toBeVisible();

  await screen.getByRole("button", "Clear goal").tap();
  await expect(screen.getByText("Goal paused", { exact: true })).toBeHidden();

  // A goal the operator leaves alone keeps working after each clean turn, and stops itself at the cap.
  const running = await hui.createSession({ title: "Running goal" });
  await hui.open(`/sessions/${running.id}`);
  await message.fill("/goal get the tests green");
  await send.tap();
  await expect(transcript.getByText("get the tests green")).toBeVisible();
  await expect(transcript.getByText("Continue the goal", { exact: false }).first()).toBeVisible();
  await expect(screen.getByText("Goal paused", { exact: true })).toBeVisible();
});